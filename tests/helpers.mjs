// Test harness: throwaway in-memory MongoDB + the real Express app in-process + a cookie-aware HTTP client.
// Never touches .env (dotenv is not loaded) and never talks to a real Razorpay / SMS endpoint (nock blocks the network).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const RZP = { keyId: 'rzp_test_TESTKEY000001', keySecret: 'test_key_secret_0123456789abcdef', webhookSecret: 'whsec_test_0123456789abcdefABCDEF' };

export function baseEnv(extra = {}) {
  return {
    NODE_ENV: 'test',
    USER_JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    ADMIN_JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    ADMIN_USERNAME: 'admin@test.local',
    ADMIN_PASSWORD: 'Test-Admin-Password-123',
    OTP_DEMO_MODE: 'true',
    PAYMENTS_MODE: 'razorpay',
    RAZORPAY_KEY_ID: RZP.keyId,
    RAZORPAY_KEY_SECRET: RZP.keySecret,
    RAZORPAY_WEBHOOK_SECRET: RZP.webhookSecret,
    TRUST_PROXY: '1',
    UPLOAD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fad-uploads-')),
    ...extra
  };
}

let mongod;
export async function boot(extraEnv = {}, { seed = true } = {}) {
  Object.assign(process.env, baseEnv(extraEnv));
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('findadoc_test');
  const nock = (await import('nock')).default;
  nock.disableNetConnect();
  nock.enableNetConnect(h => /^(127\.0\.0\.1|localhost)/.test(h));
  const { connectDB } = await import(path.join(ROOT, 'server/db.js'));
  await connectDB();
  if (seed) execFileSync(process.execPath, [path.join(ROOT, 'server/seed-admin-demo.js')], { env: { ...process.env }, stdio: 'pipe' });
  const { createApp } = await import(path.join(ROOT, 'server/app.js'));
  const app = createApp();
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const models = await import(path.join(ROOT, 'server/models/index.js'));
  return {
    base, models, nock,
    async close() {
      server.close();
      const mongoose = (await import('mongoose')).default;
      await mongoose.disconnect();
      await mongod.stop();
      nock.cleanAll(); nock.enableNetConnect();
      fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
    }
  };
}

let ipSeq = 1;
/** HTTP client with its own cookie jar and client IP (X-Forwarded-For, TRUST_PROXY=1). */
export function agent(base, { ip } = {}) {
  const jar = new Map();
  const myIp = ip || `10.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}.${Math.floor(Math.random() * 250) + 1}`;
  const a = {
    ip: myIp, jar, token: '',
    cookie: name => jar.get(name),
    async req(method, p, { body, token, headers = {}, raw, origin = 'http://localhost:3000', form } = {}) {
      const h = { 'X-Forwarded-For': myIp, ...headers };
      if (origin) h.Origin = origin;
      const t = token === undefined ? a.token : token;
      if (t) h.Authorization = `Bearer ${t}`;
      if (jar.size) h.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      let payload;
      if (form) payload = form;
      else if (raw !== undefined) payload = raw;
      else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
      const res = await fetch(base + p, { method, headers: h, body: payload, redirect: 'manual' });
      for (const sc of res.headers.getSetCookie?.() || []) {
        const [pair] = sc.split(';');
        const i = pair.indexOf('=');
        const k = pair.slice(0, i).trim(); const v = pair.slice(i + 1).trim();
        if (!v || /expires=Thu, 01 Jan 1970/i.test(sc) || /max-age=0/i.test(sc)) jar.delete(k); else jar.set(k, v);
      }
      const text = await res.text();
      let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
      return { status: res.status, body: json, text, headers: res.headers };
    },
    get: (p, o) => a.req('GET', p, o),
    post: (p, body, o = {}) => a.req('POST', p, { ...o, body }),
    put: (p, body, o = {}) => a.req('PUT', p, { ...o, body }),
    del: (p, o) => a.req('DELETE', p, o),
    csrf: () => ({ 'X-CSRF-Token': jar.get('fad_csrf') || '' })
  };
  return a;
}

/** Sign in with the demo OTP; sets a.token. */
export async function login(a, phone, role = 'patient', name) {
  const s = await a.post('/api/auth/send-otp', { phone, role });
  if (s.status !== 200) throw new Error(`send-otp ${s.status} ${s.text}`);
  const v = await a.post('/api/auth/verify-otp', { phone, otp: '123456', role, ...(name ? { name } : {}) });
  if (v.status !== 200) throw new Error(`verify-otp ${v.status} ${v.text}`);
  a.token = v.body.token;
  return v.body;
}

export async function adminLogin(a, extra = {}) {
  const r = await a.post('/api/admin/login', { username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD, ...extra });
  if (r.status === 200) a.token = r.body.adminToken;
  return r;
}

export const sign = (data, secret) => crypto.createHmac('sha256', secret).update(data).digest('hex');
export const rzpPaymentId = () => `pay_${crypto.randomBytes(7).toString('hex').slice(0, 14)}`;

/** First available slot for a doctor location (optionally skipping some). */
export async function pickSlot(a, doctorId, locationId, skip = new Set()) {
  const r = await a.get(`/api/doctors/${doctorId}/availability?locationId=${locationId}`);
  for (const d of r.body.dates || []) {
    const day = await a.get(`/api/doctors/${doctorId}/availability?locationId=${locationId}&date=${d}`);
    const s = (day.body.slots || []).find(x => x.available && !skip.has(`${d} ${x.time}`));
    if (s) { skip.add(`${d} ${s.time}`); return { date: d, time: s.time }; }
  }
  throw new Error('no slot');
}

/** nock helpers for the Razorpay REST API used by the SDK */
export function rzpMock(nock) {
  const scope = () => nock('https://api.razorpay.com').matchHeader('authorization', `Basic ${Buffer.from(`${RZP.keyId}:${RZP.keySecret}`).toString('base64')}`);
  return {
    order(check) {
      const id = `order_${crypto.randomBytes(7).toString('hex').slice(0, 14)}`;
      const seen = {};
      scope().post('/v1/orders', b => { Object.assign(seen, b); return check ? check(b) : true; }).reply(200, (u, b) => ({ id, entity: 'order', amount: b.amount, currency: b.currency, receipt: b.receipt, status: 'created', notes: b.notes }));
      return { id, seen };
    },
    payment(id, entity, times = 1) { scope().get(`/v1/payments/${id}`).times(times).reply(200, { id, entity: 'payment', currency: 'INR', status: 'captured', method: 'upi', ...entity }); },
    capture(id, entity) { scope().post(`/v1/payments/${id}/capture`).reply(200, { id, entity: 'payment', currency: 'INR', status: 'captured', ...entity }); },
    refund(paymentId, { status = 'processed', check } = {}) {
      const id = `rfnd_${crypto.randomBytes(7).toString('hex').slice(0, 14)}`;
      const seen = {};
      scope().post(`/v1/payments/${paymentId}/refund`, b => { Object.assign(seen, b); return check ? check(b) : true; }).reply(200, (u, b) => ({ id, entity: 'refund', amount: b.amount, payment_id: paymentId, status }));
      return { id, seen };
    },
    refundFail(paymentId) { scope().post(`/v1/payments/${paymentId}/refund`).reply(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'The refund amount provided is greater than amount captured' } }); }
  };
}

export async function webhook(a, event, payload, { eventId = `evt_${crypto.randomBytes(6).toString('hex')}`, secret = RZP.webhookSecret, signature } = {}) {
  const raw = JSON.stringify({ entity: 'event', event, payload, created_at: Math.floor(Date.now() / 1000) });
  const sig = signature ?? sign(raw, secret);
  return a.req('POST', '/api/payments/razorpay/webhook', { raw, origin: null, headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sig, 'X-Razorpay-Event-Id': eventId } });
}

export const until = async (fn, ms = 4000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 50)); } return v; };
