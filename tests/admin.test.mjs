// Admin auth: bcrypt ADMIN_PASSWORD_HASH, TOTP 2FA with replay protection, lockout, audit log.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { boot, agent } from './helpers.mjs';

const PASSWORD = 'Correct-Horse-Battery-Staple-42';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
let t, M, totpNow;
before(async () => {
  t = await boot({ ADMIN_PASSWORD: '', ADMIN_PASSWORD_HASH: bcrypt.hashSync(PASSWORD, 10), ADMIN_TOTP_SECRET: TOTP_SECRET, ADMIN_MAX_FAILED_LOGINS: '4', ADMIN_LOCK_MINUTES: '15' }, { seed: false });
  M = t.models;
  ({ totpNow } = await import('../server/lib/totp.js'));
});
after(async () => { await t?.close(); });

const login = (a, body) => a.post('/api/admin/login', { username: 'admin@test.local', ...body });

test('bcrypt hash + TOTP: password alone asks for the code; good code logs in; same code cannot be replayed', async () => {
  const a = agent(t.base);
  const noCode = await login(a, { password: PASSWORD });
  assert.equal(noCode.status, 401);
  assert.equal(noCode.body.code, 'TOTP_REQUIRED');
  const wrong = await login(a, { password: PASSWORD, totp: '000000' === totpNow(TOTP_SECRET) ? '111111' : '000000' });
  assert.equal(wrong.body.code, 'TOTP_INVALID');
  const code = totpNow(TOTP_SECRET);
  const ok = await login(a, { password: PASSWORD, totp: code });
  assert.equal(ok.status, 200, ok.text);
  assert.ok(ok.body.adminToken);
  assert.equal(ok.body.adminUser.totp, true);
  a.token = ok.body.adminToken;
  // replay of the very same code (e.g. shoulder-surfed) is refused
  const replay = await login(agent(t.base), { password: PASSWORD, totp: code });
  assert.equal(replay.status, 401);
  assert.equal(replay.body.code, 'TOTP_INVALID');
  // audit log visible to admin, contains login + failures, and never stores the password
  const log = await a.get('/api/admin/audit-log?type=auth');
  assert.equal(log.status, 200);
  const actions = log.body.items.map(i => i.action);
  assert.ok(actions.includes('auth.login') && actions.includes('auth.login.failed'));
  assert.ok(!log.text.includes(PASSWORD));
  // a mutation is audited with secrets redacted
  await a.put('/api/admin/settings', { platformFee: 49, password: 'should-not-be-logged' });
  const changes = await a.get('/api/admin/audit-log?type=changes');
  assert.ok(!changes.text.includes('should-not-be-logged'));
  assert.ok(changes.body.items.some(i => /settings/.test(i.path || i.action)));
  assert.equal((await agent(t.base).get('/api/admin/audit-log')).status, 401);
});

test('plaintext password is not accepted when a hash is configured; lockout after N failures', async () => {
  await M.AdminLoginState.deleteMany({});
  const a = agent(t.base);
  for (let i = 0; i < 3; i++) assert.equal((await login(a, { password: `bad-${i}` })).status, 401);
  const fourth = await login(a, { password: 'bad-3' });
  assert.equal(fourth.status, 401);
  const locked = await login(a, { password: PASSWORD, totp: totpNow(TOTP_SECRET) });
  assert.equal(locked.status, 423);
  assert.equal(locked.body.code, 'ADMIN_LOCKED');
  assert.ok(Number(locked.headers.get('retry-after')) > 0);
  // the lock state does not store the username in clear text
  const st = await M.AdminLoginState.findOne({}).lean();
  assert.ok(!st.username.includes('admin'));
  assert.ok(await M.AdminAuditLog.countDocuments({ action: 'auth.login.locked' }) >= 1);
});
