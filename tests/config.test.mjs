// Production fail-fast: refuses to start with missing / weak secrets, demo OTP, mock payments, or console SMS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strong = n => 'f'.repeat(0) + Array.from({ length: n }, (_, i) => 'a1B2c3D4e5F6g7H8'[i % 16]).join('') + 'Zq9';
const good = {
  NODE_ENV: 'production', PATH: process.env.PATH, HOME: process.env.HOME,
  MONGODB_URI: 'mongodb://127.0.0.1:1/never_connects',
  USER_JWT_SECRET: '3f9c1a7e5b2d8046c1e9a3f7b5d2086e4c1a9f3e7b5d2c8a0f6e4d2b9c7a5e3f',
  ADMIN_JWT_SECRET: '8b1d4f7a2c5e9036b8d1f4a7c2e5b9036d8f1a4c7e2b5d9f3a6c8e1b4d7f2a5c',
  ADMIN_USERNAME: 'ops@findadoc.in',
  ADMIN_PASSWORD_HASH: '$2b$12$C6UzMDM.H6dfI/f/IKcEeO1Xh1qI0VNm7gC6kq7ZbDqP7d8ytV7tG',
  SMS_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'k'.repeat(30), MSG91_TEMPLATE_ID: 'tmpl1',
  PAYMENTS_MODE: 'razorpay', RAZORPAY_KEY_ID: 'rzp_live_ABCDEFGHIJ1234', RAZORPAY_KEY_SECRET: 's'.repeat(24) + 'X1y2', RAZORPAY_WEBHOOK_SECRET: 'w'.repeat(20) + 'Q7r8',
  CORS_ORIGINS: 'https://findadoc.in', SERVE_DIST: 'false', DOTENV_CONFIG_PATH: '/nonexistent/.env'
};
void strong;

function start(env) {
  // the server must exit before it connects anywhere; run from an empty cwd so no .env is picked up
  const r = spawnSync(process.execPath, [path.join(ROOT, 'server/index.js')], { env, cwd: '/tmp', timeout: 8000, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const cases = [
  ['missing USER_JWT_SECRET', { USER_JWT_SECRET: '' }, /USER_JWT_SECRET/],
  ['weak USER_JWT_SECRET', { USER_JWT_SECRET: 'changeme' }, /USER_JWT_SECRET/],
  ['same user/admin secret', { ADMIN_JWT_SECRET: good.USER_JWT_SECRET }, /differ/i],
  ['missing ADMIN_JWT_SECRET', { ADMIN_JWT_SECRET: '' }, /ADMIN_JWT_SECRET/],
  ['demo OTP in production', { OTP_DEMO_MODE: 'true' }, /OTP_DEMO_MODE/],
  ['no SMS provider', { SMS_PROVIDER: '' }, /SMS_PROVIDER/],
  ['console SMS', { SMS_PROVIDER: 'console' }, /SMS_PROVIDER/],
  ['mock payments', { PAYMENTS_MODE: 'mock' }, /PAYMENTS_MODE/],
  ['missing CORS_ORIGINS', { CORS_ORIGINS: '' }, /CORS_ORIGINS/],
  ['wildcard CORS', { CORS_ORIGINS: '*' }, /CORS/],
  ['no admin password', { ADMIN_PASSWORD_HASH: '' }, /ADMIN_PASSWORD/]
];
for (const [name, patch, re] of cases) {
  test(`production refuses to start: ${name}`, () => {
    const r = start({ ...good, ...patch });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, re);
    assert.match(r.out, /openssl rand -hex 32|refus|invalid|missing|not allowed/i);
    for (const v of [good.USER_JWT_SECRET, good.RAZORPAY_KEY_SECRET, good.MSG91_AUTH_KEY]) assert.ok(!r.out.includes(v), 'secret leaked in output');
  });
}

test('development start-up with the legacy 5-key .env shape works (derived dev secrets, loud warnings, no secret output)', async () => {
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const mongod = await MongoMemoryServer.create();
  const { spawn } = await import('node:child_process');
  const port = 40000 + Math.floor(Math.random() * 20000);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, DOTENV_CONFIG_PATH: '/nonexistent/.env', PORT: String(port), MONGODB_URI: mongod.getUri('findadoc_devstart'), ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'legacy-plain-pass', ADMIN_SECRET_KEY: 'legacy-admin-secret-key-value' };
  const child = spawn(process.execPath, [path.join(ROOT, 'server/index.js')], { env, cwd: '/tmp' });
  let out = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  try {
    const end = Date.now() + 60000;
    while (!/listening on port/.test(out) && Date.now() < end && child.exitCode === null) await new Promise(r => setTimeout(r, 200));
    assert.match(out, /listening on port/, out);
    assert.match(out, /DEMO OTP/);
    assert.match(out, /Payments mode: disabled/);
    assert.match(out, /USER_JWT_SECRET/);
    for (const v of ['legacy-plain-pass', 'legacy-admin-secret-key-value']) assert.ok(!out.includes(v), 'secret printed');
    const h = await fetch(`http://127.0.0.1:${port}/api/doctors`);
    assert.equal(h.status, 200);
    const l = await fetch(`http://127.0.0.1:${port}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' }, body: JSON.stringify({ username: 'admin', password: 'legacy-plain-pass' }) });
    assert.equal(l.status, 200);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.exitCode !== null ? r() : child.on('exit', r));
    await mongod.stop();
  }
});
