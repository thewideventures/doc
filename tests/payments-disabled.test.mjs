// With no Razorpay keys and no PAYMENTS_MODE, every paid flow answers 503 "Payments not configured".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, agent, login, pickSlot } from './helpers.mjs';

let t;
before(async () => { t = await boot({ PAYMENTS_MODE: '', RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', RAZORPAY_WEBHOOK_SECRET: '' }); });
after(async () => { await t?.close(); });

test('config endpoint reports disabled; booking + subscription return 503', async () => {
  const a = agent(t.base); await login(a, '9000030201', 'patient', 'P');
  const c = await a.get('/api/payments/config');
  assert.equal(c.status, 200);
  assert.equal(c.body.enabled, false);
  const slot = await pickSlot(a, 'demo-doc-1', 'demo-loc-1-o');
  const b = await a.post('/api/bookings', { doctorId: 'demo-doc-1', locationId: 'demo-loc-1-o', ...slot });
  assert.equal(b.status, 503);
  assert.equal(b.body.code, 'PAYMENTS_NOT_CONFIGURED');
  const d = agent(t.base); await login(d, '9000020021', 'doctor');
  const s = await d.post('/api/subscriptions/checkout', { planCode: 'pro' });
  assert.equal(s.status, 503);
  // mock endpoint is not available unless PAYMENTS_MODE=mock
  assert.equal((await a.post('/api/payments/mock/authorize', { orderId: 'x' })).status, 404);
  // webhook refuses (no secret)
  const w = await a.req('POST', '/api/payments/razorpay/webhook', { raw: '{}', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': 'x' } });
  assert.ok([400, 503].includes(w.status));
});
