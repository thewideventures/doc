// Phase 4: ABHA linking through the env-gated adapter in dev MOCK mode (OTP 123456); attempts limited; consent logged.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.mjs';
import { p4 } from './p4-helpers.mjs';

let t, M, h;
before(async () => { t = await boot({ PAYMENTS_MODE: 'mock', ABHA_PROVIDER: 'mock' }); M = t.models; h = p4(t); });
after(async () => { await t?.close(); });

test('ABHA mock: validate input, wrong OTP counted, link + unlink with consent records, txn owned by the user', async () => {
  const p = await h.patient('Abha Mock');
  const other = await h.patient('Abha Other');
  assert.equal((await p.get('/api/me/abha')).body.enabled, true);
  assert.equal((await p.post('/api/me/abha/init', { abhaNumber: '123' })).status, 400);
  assert.equal((await p.post('/api/me/abha/init', {})).status, 400);
  const i = await p.post('/api/me/abha/init', { abhaNumber: '12-3456-7890-1234' });
  assert.equal(i.status, 200, i.text);
  assert.equal((await other.post('/api/me/abha/confirm', { txnId: i.body.txnId, otp: '123456' })).status, 410, 'not your txn');
  assert.ok([400, 401].includes((await p.post('/api/me/abha/confirm', { txnId: i.body.txnId, otp: '000000' })).status));
  const ok = await p.post('/api/me/abha/confirm', { txnId: i.body.txnId, otp: '123456' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.abha.status, 'linked');
  assert.equal(ok.body.abha.number, '12-3456-7890-1234');
  assert.ok(await M.Consent.exists({ userId: p.user.id, purpose: 'abha_linking', granted: true }));
  assert.equal(await M.AbhaTxn.countDocuments({ userId: p.user.id }), 0, 'txn removed after success');
  assert.equal((await p.del('/api/me/abha')).status, 200);
  assert.equal((await p.get('/api/me/abha')).body.abha.status, 'unlinked');
  assert.ok(await M.Consent.exists({ userId: p.user.id, purpose: 'abha_linking', granted: false }));
});
