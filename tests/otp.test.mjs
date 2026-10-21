// OTP: delivered through the SMS provider (MSG91 mocked with nock), hashed at rest, 5 attempts then lock,
// resend cooldown, expiry, single use, per-phone limits. No demo code when a provider is configured.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, agent } from './helpers.mjs';

let t, M;
const sent = [];
before(async () => {
  t = await boot({ OTP_DEMO_MODE: 'false', SMS_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'test-msg91-key', MSG91_TEMPLATE_ID: 'tmpl_otp' }, { seed: false });
  M = t.models;
  t.nock('https://control.msg91.com').persist().post('/api/v5/flow', b => { sent.push(b); return true; }).matchHeader('authkey', 'test-msg91-key').reply(200, { type: 'success' });
});
after(async () => { await t?.close(); });

const codeFor = digits => [...sent].reverse().find(b => b.recipients[0].mobiles === `91${digits}`)?.recipients[0].otp;
const send = (a, phone) => a.post('/api/auth/send-otp', { phone, role: 'patient' });
const verify = (a, phone, otp) => a.post('/api/auth/verify-otp', { phone, otp, role: 'patient', name: 'Otp User' });
const age = (phone, ms) => M.OtpChallenge.collection.updateOne({ phone }, { $set: { lastSentAt: new Date(Date.now() - ms) } });

test('code is sent via MSG91, never returned to the client, stored only as a hash; demo code rejected', async () => {
  const a = agent(t.base);
  const r = await send(a, '9811100001');
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.testOtp, undefined);
  assert.equal(r.body.demo, undefined);
  const code = codeFor('9811100001');
  assert.match(code, /^\d{6}$/);
  assert.equal(sent.at(-1).template_id, 'tmpl_otp');
  assert.ok(!r.text.includes(code));
  const row = await M.OtpChallenge.findOne({ phone: '9811100001' }).lean();
  assert.ok(row.codeHash && !JSON.stringify(row).includes(code));
  if (code !== '123456') assert.equal((await verify(a, '9811100001', '123456')).status, 400);
  const ok = await verify(a, '9811100001', code);
  assert.equal(ok.status, 200, ok.text);
  // single use
  const again = await verify(agent(t.base), '9811100001', code);
  assert.equal(again.status, 400);
  assert.equal(again.body.code, 'OTP_EXPIRED');
});

test('5 wrong attempts lock the number (even the right code is refused afterwards)', async () => {
  const a = agent(t.base);
  assert.equal((await send(a, '9811100002')).status, 200);
  const code = codeFor('9811100002');
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) { const r = await verify(a, '9811100002', wrong); assert.equal(r.status, 400); assert.equal(r.body.code, 'OTP_INVALID'); }
  const fifth = await verify(a, '9811100002', wrong);
  assert.equal(fifth.status, 429);
  assert.equal(fifth.body.code, 'OTP_LOCKED');
  assert.equal((await verify(a, '9811100002', code)).body.code, 'OTP_LOCKED');
  assert.equal((await send(a, '9811100002')).body.code, 'OTP_LOCKED');
});

test('parallel guesses cannot exceed the attempt limit', async () => {
  const a = agent(t.base);
  await send(a, '9811100003');
  const code = codeFor('9811100003');
  const guesses = Array.from({ length: 12 }, (_, i) => String((Number(code) + i + 1) % 1000000).padStart(6, '0'));
  const rs = await Promise.all(guesses.map(g => verify(agent(t.base), '9811100003', g)));
  assert.ok(rs.every(r => r.status !== 200));
  assert.equal((await verify(a, '9811100003', code)).status, 429);
});

test('resend cooldown and hourly per-phone quota', async () => {
  const a = agent(t.base);
  assert.equal((await send(a, '9811100004')).status, 200);
  const r = await send(a, '9811100004');
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'OTP_COOLDOWN');
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  // after cooldown a new code is sent and the old one stops working
  const first = codeFor('9811100004');
  await age('9811100004', 31000);
  assert.equal((await send(a, '9811100004')).status, 200);
  const second = codeFor('9811100004');
  if (first !== second) assert.equal((await verify(a, '9811100004', first)).status, 400);
  // per-phone limiter (5 sends / 10 min at the HTTP layer, 6/hour in the store)
  let last;
  for (let i = 0; i < 6; i++) { await age('9811100004', 31000); last = await send(agent(t.base), '9811100004'); }
  assert.equal(last.status, 429);
});

test('expired code is refused', async () => {
  const a = agent(t.base);
  await send(a, '9811100005');
  const code = codeFor('9811100005');
  await M.OtpChallenge.collection.updateOne({ phone: '9811100005' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const r = await verify(a, '9811100005', code);
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'OTP_EXPIRED');
});

test('per-IP send limit across many numbers', async () => {
  const a = agent(t.base, { ip: '10.250.250.250' });
  let last;
  for (let i = 0; i < 31; i++) last = await send(a, `98222${String(i).padStart(5, '0')}`);
  assert.equal(last.status, 429);
});

test('SMS provider failure returns 502 without leaking details and does not burn the cooldown', async () => {
  t.nock.cleanAll();
  t.nock('https://control.msg91.com').post('/api/v5/flow').reply(500, 'internal provider error with authkey=test-msg91-key');
  const a = agent(t.base);
  const r = await send(a, '9811100006');
  assert.equal(r.status, 502);
  assert.equal(r.body.code, 'SMS_FAILED');
  assert.ok(!r.text.includes('test-msg91-key'));
  t.nock('https://control.msg91.com').post('/api/v5/flow', b => { sent.push(b); return true; }).reply(200, {});
  assert.equal((await send(a, '9811100006')).status, 200);
});

test('invalid phone / malformed OTP are validation errors', async () => {
  const a = agent(t.base);
  assert.equal((await send(a, '12345')).status, 400);
  assert.equal((await a.post('/api/auth/send-otp', { phone: { $gt: '' }, role: 'patient' })).status, 400);
  assert.equal((await verify(a, '9811100007', 'abcdef')).status, 400);
  assert.equal((await a.post('/api/auth/verify-otp', { phone: '9811100007', otp: { $ne: '1' } })).status, 400);
});
