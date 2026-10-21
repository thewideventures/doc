// Sessions: short access JWT + rotating hashed refresh cookie, reuse detection, logout, CSRF / Origin, token forgery, cross-role.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { boot, agent, login, adminLogin } from './helpers.mjs';

let t, M;
before(async () => { t = await boot(); M = t.models; });
after(async () => { await t?.close(); });

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const refresh = (a, role = 'patient', o = {}) => a.post('/api/auth/refresh', { role }, { headers: a.csrf(), token: '', ...o });

test('login sets httpOnly SameSite=Strict refresh cookie scoped to /api/auth and a 15-min access token', async () => {
  const a = agent(t.base);
  const r1 = await a.post('/api/auth/send-otp', { phone: '9000030101', role: 'patient' });
  assert.equal(r1.status, 200);
  const r = await a.post('/api/auth/verify-otp', { phone: '9000030101', otp: '123456', role: 'patient', name: 'A' });
  assert.equal(r.status, 200);
  const sc = r.headers.getSetCookie().join('\n');
  assert.match(sc, /fad_rt_patient=[^;]+;.*Path=\/api\/auth/i);
  assert.match(sc, /fad_rt_patient=[^\n]*HttpOnly/i);
  assert.match(sc, /fad_rt_patient=[^\n]*SameSite=Strict/i);
  assert.match(sc, /fad_csrf=/);
  assert.doesNotMatch(sc, /fad_csrf=[^\n]*HttpOnly/i);
  const payload = JSON.parse(Buffer.from(r.body.token.split('.')[1], 'base64url'));
  assert.equal(payload.exp - payload.iat, 15 * 60);
  assert.equal(payload.typ, 'access');
  // refresh token is stored hashed only
  const raw = a.cookie('fad_rt_patient');
  const row = await M.AuthSession.findOne({ id: raw.split('.')[0] }).lean();
  assert.ok(row && row.tokenHash !== raw && !JSON.stringify(row).includes(raw.split('.')[1]));
});

test('refresh rotates the cookie; reusing an old refresh token (after grace) revokes the whole family', async () => {
  const a = agent(t.base); await login(a, '9000030102', 'patient', 'B');
  const old = a.cookie('fad_rt_patient');
  const r = await refresh(a);
  assert.equal(r.status, 200, r.text);
  assert.ok(r.body.token);
  const fresh = a.cookie('fad_rt_patient');
  assert.notEqual(fresh, old);
  // within grace: concurrent tab gets 409 retry, not a revocation
  const tab = agent(t.base); tab.jar.set('fad_rt_patient', old); tab.jar.set('fad_csrf', a.cookie('fad_csrf'));
  assert.equal((await refresh(tab)).status, 409);
  // simulate the grace window passing, then replay the stolen old token
  await M.AuthSession.collection.updateOne({ id: old.split('.')[0] }, { $set: { rotatedAt: new Date(Date.now() - 60000) } });
  const replay = await refresh(tab);
  assert.equal(replay.status, 401);
  assert.equal(replay.body.code, 'SESSION_REVOKED');
  // legit user's newer token and access token are dead too
  assert.equal((await refresh(a)).status, 401);
  assert.equal((await a.get('/api/auth/session', { token: r.body.token })).status, 401);
});

test('refresh requires the CSRF header and an allowed Origin', async () => {
  const a = agent(t.base); await login(a, '9000030103', 'patient', 'C');
  assert.equal((await a.post('/api/auth/refresh', { role: 'patient' }, { token: '' })).body.code, 'CSRF_TOKEN');
  assert.equal((await a.post('/api/auth/refresh', { role: 'patient' }, { token: '', headers: { 'X-CSRF-Token': 'wrong' } })).status, 403);
  assert.equal((await refresh(a, 'patient', { origin: 'https://evil.example' })).body.code, 'CSRF_ORIGIN');
  assert.equal((await refresh(a, 'patient', { origin: 'null' })).status, 403);
  assert.equal((await refresh(a)).status, 200);
});

test('cross-site Origin is refused for every state-changing API call', async () => {
  const a = agent(t.base); await login(a, '9000030104', 'patient', 'D');
  const r = await a.post('/api/reviews', { doctorId: 'demo-doc-1', rating: 5, text: 'x' }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const s = await a.req('POST', '/api/auth/send-otp', { body: { phone: '9000030199', role: 'patient' }, origin: '', headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(s.status, 403);
});

test('logout revokes the refresh family and the current access token', async () => {
  const a = agent(t.base); await login(a, '9000030105', 'patient', 'E');
  const tok = a.token;
  assert.equal((await a.get('/api/auth/session')).status, 200);
  const r = await a.post('/api/auth/logout', { role: 'patient' }, { headers: a.csrf() });
  assert.equal(r.status, 200);
  assert.equal(a.cookie('fad_rt_patient'), undefined);
  assert.equal((await a.get('/api/auth/session', { token: tok })).status, 401);
  const b = agent(t.base); b.jar.set('fad_rt_patient', 'x.y'); b.jar.set('fad_csrf', 'c');
  assert.equal((await refresh(b)).status, 401);
});

test('logout-all signs out every device', async () => {
  const a1 = agent(t.base); await login(a1, '9000030106', 'patient', 'F');
  const a2 = agent(t.base); await login(a2, '9000030106', 'patient', 'F');
  assert.equal((await a1.post('/api/auth/logout-all', {})).status, 200);
  assert.equal((await a2.get('/api/auth/session')).status, 401);
  assert.equal((await refresh(a2)).status, 401);
});

test('forged / tampered / alg:none / legacy tokens are rejected', async () => {
  const a = agent(t.base); await login(a, '9000030107', 'patient', 'G');
  const [h, p, s] = a.token.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url'));
  const tampered = `${h}.${b64({ ...claims, role: 'doctor', did: 'demo-doc-1' })}.${s}`;
  const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ ...claims })}.`;
  const wrongKey = (() => { const hh = b64({ alg: 'HS256', typ: 'JWT' }); const pp = b64(claims); return `${hh}.${pp}.${crypto.createHmac('sha256', 'guess').update(`${hh}.${pp}`).digest('base64url')}`; })();
  for (const tok of [tampered, none, wrongKey, 'usr.abc.def', 'garbage', `${h}.${p}`]) {
    assert.equal((await a.get('/api/auth/session', { token: tok })).status, 401, tok.slice(0, 20));
  }
  // token in query string / cookie is not accepted (Authorization header only)
  assert.equal((await a.get(`/api/auth/session?token=${a.token}`, { token: '' })).status, 401);
});

test('user tokens cannot be used as admin tokens and vice versa; roles are enforced', async () => {
  const p = agent(t.base); await login(p, '9000030108', 'patient', 'H');
  assert.equal((await p.get('/api/admin/dashboard')).status, 401);
  assert.equal((await p.get('/api/doctor-portal/profile')).status, 403);
  const ad = agent(t.base); assert.equal((await adminLogin(ad)).status, 200);
  assert.equal((await p.get('/api/auth/session', { token: ad.token })).status, 401);
  assert.equal((await ad.get('/api/admin/dashboard')).status, 200);
  // admin refresh is a separate cookie, scoped to /api/admin/auth
  const raw = ad.cookie('fad_rt_admin');
  assert.ok(raw);
  const r = await ad.post('/api/admin/auth/refresh', {}, { headers: ad.csrf(), token: '' });
  assert.equal(r.status, 200, r.text);
  const claims = JSON.parse(Buffer.from(r.body.adminToken.split('.')[1], 'base64url'));
  assert.ok(claims.exp - claims.iat <= 10 * 60, 'admin access token is short lived');
  // admin logout kills the admin session
  ad.token = r.body.adminToken;
  assert.equal((await ad.post('/api/admin/auth/logout', {}, { headers: ad.csrf() })).status, 200);
  assert.equal((await ad.get('/api/admin/dashboard')).status, 401);
});

test('suspended user loses access on next request and on refresh', async () => {
  const a = agent(t.base); const out = await login(a, '9000030109', 'patient', 'I');
  await M.User.updateOne({ id: out.user.id }, { $set: { status: 'suspended', isSuspended: true } });
  assert.notEqual((await a.get('/api/auth/session')).status, 200);
  assert.notEqual((await refresh(a)).status, 200);
});
