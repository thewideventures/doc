// Razorpay integration: orders, signature + fetch verification, tampering, replay, idempotency, webhooks, refunds.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, agent, login, adminLogin, pickSlot, rzpMock, webhook, sign, rzpPaymentId, RZP, until } from './helpers.mjs';

let t, rzp, M, patient, patient2, admin;
const used = new Set();

before(async () => {
  t = await boot();
  rzp = rzpMock(t.nock);
  M = t.models;
  patient = agent(t.base); await login(patient, '9000030001', 'patient');
  patient2 = agent(t.base); await login(patient2, '9000030002', 'patient');
  admin = agent(t.base); assert.equal((await adminLogin(admin)).status, 200);
});
after(async () => { await t?.close(); });

let phoneSeq = 0;
async function freshPatient() {
  const a = agent(t.base);
  await login(a, `98${String(Date.now() % 100000).padStart(5, '0')}${String(phoneSeq++).padStart(3, '0')}`, 'patient', 'Fresh Patient');
  return a;
}
async function startPaidBooking(a, locationId = 'demo-loc-1-o', orderCheck) {
  a = a || await freshPatient();
  const slot = await pickSlot(a, 'demo-doc-1', locationId, used);
  const o = rzp.order(orderCheck);
  const r = await a.post('/api/bookings', { doctorId: 'demo-doc-1', locationId, ...slot, patientName: 'Test Patient' });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.body.payment, 'payment expected');
  return { ...r.body, rzpOrder: o, a };
}

test('PAID booking creates a server-priced Razorpay order (paise, INR, receipt = internal id, notes)', async () => {
  const b = await startPaidBooking();
  const p = b.payment;
  assert.equal(p.provider, 'razorpay');
  assert.equal(p.providerOrderId, b.rzpOrder.id);
  assert.equal(p.keyId, RZP.keyId);
  assert.ok(!JSON.stringify(b).includes(RZP.keySecret), 'secret never sent to client');
  assert.equal(b.rzpOrder.seen.amount, Math.round(b.quote.payNow * 100));
  assert.equal(b.rzpOrder.seen.currency, 'INR');
  assert.equal(b.rzpOrder.seen.receipt, p.orderId);
  assert.equal(b.rzpOrder.seen.notes.type, 'booking');
  assert.ok(p.holdExpiresAt && new Date(p.holdExpiresAt) - Date.now() <= 10 * 60000 + 2000, 'hold ~10 min');
  assert.equal(b.booking.status, 'AwaitingPayment');
  assert.equal(await M.LedgerTransaction.countDocuments({ paymentOrderId: p.orderId }), 0, 'no ledger before verified payment');
});

test('client-sent amounts are ignored (price computed server-side)', async () => {
  const slot = await pickSlot(patient, 'demo-doc-1', 'demo-loc-1-o', used);
  const o = rzp.order();
  const r = await (await freshPatient()).post('/api/bookings', { doctorId: 'demo-doc-1', locationId: 'demo-loc-1-o', ...slot, amount: 1, payNow: 1, fee: 1 });
  assert.equal(r.status, 200);
  assert.ok(o.seen.amount > 100, `order amount ${o.seen.amount} must be the server price`);
});

test('valid signature + fetched captured payment confirms the booking and writes ONE ledger row with Razorpay ids', async () => {
  const b = await startPaidBooking();
  const pid = rzpPaymentId();
  rzp.payment(pid, { order_id: b.payment.providerOrderId, amount: Math.round(b.payment.amount * 100) });
  const sig = sign(`${b.payment.providerOrderId}|${pid}`, RZP.keySecret);
  const v = await b.a.post('/api/payments/verify', { orderId: b.payment.orderId, paymentId: pid, signature: sig });
  assert.equal(v.status, 200, v.text);
  assert.ok(['Confirmed', 'Pending'].includes(v.body.booking.status));
  const rows = await M.LedgerTransaction.find({ paymentOrderId: b.payment.orderId }).lean();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].razorpayOrderId, b.payment.providerOrderId);
  assert.equal(rows[0].razorpayPaymentId, pid);
  // idempotent: same verify again
  const again = await b.a.post('/api/payments/verify', { orderId: b.payment.orderId, paymentId: pid, signature: sig });
  assert.equal(again.status, 200);
  assert.equal(again.body.alreadyProcessed, true);
  assert.equal(await M.LedgerTransaction.countDocuments({ paymentOrderId: b.payment.orderId }), 1);
});

test('invalid signature is rejected and nothing is recorded', async () => {
  const b = await startPaidBooking();
  const pid = rzpPaymentId();
  const v = await b.a.post('/api/payments/verify', { orderId: b.payment.orderId, paymentId: pid, signature: sign(`${b.payment.providerOrderId}|${pid}`, 'wrong-secret') });
  assert.equal(v.status, 400);
  assert.equal(v.body.code, 'PAYMENT_VERIFICATION_FAILED');
  const bad2 = await b.a.post('/api/payments/verify', { orderId: b.payment.orderId, paymentId: pid, signature: 'zz' });
  assert.equal(bad2.status, 400);
  const order = await M.PaymentOrder.findOne({ id: b.payment.orderId }).lean();
  assert.equal(order.status, 'created');
  assert.equal(await M.LedgerTransaction.countDocuments({ paymentOrderId: b.payment.orderId }), 0);
});

test('tampered amount (payment amount differs from order) is rejected', async () => {
  const b = await startPaidBooking();
  const pid = rzpPaymentId();
  rzp.payment(pid, { order_id: b.payment.providerOrderId, amount: 100 }); // ₹1 instead of the order amount
  const v = await b.a.post('/api/payments/verify', { orderId: b.payment.orderId, paymentId: pid, signature: sign(`${b.payment.providerOrderId}|${pid}`, RZP.keySecret) });
  assert.equal(v.status, 400);
  assert.equal(v.body.code, 'PAYMENT_MISMATCH');
  assert.equal((await M.PaymentOrder.findOne({ id: b.payment.orderId }).lean()).status, 'created');
  assert.equal(await M.LedgerTransaction.countDocuments({ paymentOrderId: b.payment.orderId }), 0);
});

test('payment belonging to a different order is rejected (order mismatch)', async () => {
  const b = await startPaidBooking();
  const pid = rzpPaymentId();
  rzp.payment(pid, { order_id: 'order_SOMEOTHERORDER1', amount: Math.round(b.payment.amount * 100) });
  const v = await b.a.post('/api/payments/verify', { orderId: b.payment.orderId, paymentId: pid, signature: sign(`${b.payment.providerOrderId}|${pid}`, RZP.keySecret) });
  assert.equal(v.status, 400);
  assert.equal(v.body.code, 'PAYMENT_MISMATCH');
});

test('replayed payment id cannot settle a second order (unique providerPaymentId)', async () => {
  const b1 = await startPaidBooking();
  const pid = rzpPaymentId();
  rzp.payment(pid, { order_id: b1.payment.providerOrderId, amount: Math.round(b1.payment.amount * 100) });
  assert.equal((await b1.a.post('/api/payments/verify', { orderId: b1.payment.orderId, paymentId: pid, signature: sign(`${b1.payment.providerOrderId}|${pid}`, RZP.keySecret) })).status, 200);
  // direct DB-level replay attempt: the unique index refuses a second order with the same payment id
  const b2 = await startPaidBooking();
  await assert.rejects(M.PaymentOrder.updateOne({ id: b2.payment.orderId }, { $set: { providerPaymentId: pid } }), e => e.code === 11000);
  // API-level replay: the attacker re-signs nothing they can't — a captured payment for order 1 never matches order 2
  rzp.payment(pid, { order_id: b1.payment.providerOrderId, amount: Math.round(b1.payment.amount * 100) });
  const v = await b2.a.post('/api/payments/verify', { orderId: b2.payment.orderId, paymentId: pid, signature: sign(`${b2.payment.providerOrderId}|${pid}`, RZP.keySecret) });
  assert.equal(v.status, 400);
  assert.equal((await M.PaymentOrder.findOne({ id: b2.payment.orderId }).lean()).status, 'created');
});

test('another patient cannot verify / cancel my payment order (IDOR)', async () => {
  const b = await startPaidBooking();
  const v = await patient2.post('/api/payments/verify', { orderId: b.payment.orderId, paymentId: rzpPaymentId(), signature: 'a'.repeat(64) });
  assert.equal(v.status, 404);
  const f = await patient2.post('/api/payments/fail', { orderId: b.payment.orderId });
  assert.equal(f.status, 404);
});

test('authorized (not auto-captured) payment is captured server-side', async () => {
  const b = await startPaidBooking();
  const pid = rzpPaymentId();
  const amt = Math.round(b.payment.amount * 100);
  rzp.payment(pid, { order_id: b.payment.providerOrderId, amount: amt, status: 'authorized' });
  rzp.capture(pid, { order_id: b.payment.providerOrderId, amount: amt });
  const v = await b.a.post('/api/payments/verify', { orderId: b.payment.orderId, paymentId: pid, signature: sign(`${b.payment.providerOrderId}|${pid}`, RZP.keySecret) });
  assert.equal(v.status, 200, v.text);
});

test('BOOKING-AMOUNT (token) mode charges platform fee + token only', async () => {
  const b = await startPaidBooking(null, 'demo-loc-1-t');
  assert.equal(b.quote.mode, 'token');
  assert.equal(b.quote.payNow, b.quote.platformFee + b.quote.tokenAmount);
  assert.equal(b.rzpOrder.seen.amount, Math.round(b.quote.payNow * 100));
  assert.ok(b.booking.amountDueAtClinic > 0);
});

test('webhook: invalid signature rejected, valid payment.captured applied, replayed event ignored', async () => {
  const b = await startPaidBooking();
  const pid = rzpPaymentId();
  const payment = { id: pid, entity: 'payment', order_id: b.payment.providerOrderId, amount: Math.round(b.payment.amount * 100), currency: 'INR', status: 'captured', method: 'card' };
  const bad = await webhook(agent(t.base), 'payment.captured', { payment: { entity: payment } }, { secret: 'not-the-secret' });
  assert.equal(bad.status, 400);
  const noSig = await webhook(agent(t.base), 'payment.captured', { payment: { entity: payment } }, { signature: '' });
  assert.equal(noSig.status, 400);
  assert.equal((await M.PaymentOrder.findOne({ id: b.payment.orderId }).lean()).status, 'created');

  const eventId = 'evt_replay_test_1';
  const ok = await webhook(agent(t.base), 'payment.captured', { payment: { entity: payment } }, { eventId });
  assert.equal(ok.status, 200);
  const order = await until(async () => { const o = await M.PaymentOrder.findOne({ id: b.payment.orderId }).lean(); return o.status === 'paid' && o; });
  assert.equal(order.providerPaymentId, pid);
  const dup = await webhook(agent(t.base), 'payment.captured', { payment: { entity: payment } }, { eventId });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.duplicate, true);
  await new Promise(r => setTimeout(r, 200));
  assert.equal(await M.LedgerTransaction.countDocuments({ paymentOrderId: b.payment.orderId }), 1);
  // order.paid for the same payment (different event id) is idempotent too
  const op = await webhook(agent(t.base), 'order.paid', { payment: { entity: payment }, order: { entity: { id: b.payment.providerOrderId } } });
  assert.equal(op.status, 200);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(await M.LedgerTransaction.countDocuments({ paymentOrderId: b.payment.orderId }), 1);
  // client verify after webhook -> alreadyProcessed
  const v = await b.a.post('/api/payments/verify', { orderId: b.payment.orderId, paymentId: pid, signature: sign(`${b.payment.providerOrderId}|${pid}`, RZP.keySecret) });
  assert.equal(v.status, 200);
  assert.equal(v.body.alreadyProcessed, true);
});

test('webhook with a tampered amount is ignored', async () => {
  const b = await startPaidBooking();
  const payment = { id: rzpPaymentId(), order_id: b.payment.providerOrderId, amount: 100, currency: 'INR', status: 'captured' };
  const r = await webhook(agent(t.base), 'payment.captured', { payment: { entity: payment } });
  assert.equal(r.status, 200);
  await new Promise(r2 => setTimeout(r2, 300));
  assert.equal((await M.PaymentOrder.findOne({ id: b.payment.orderId }).lean()).status, 'created');
});

test('payment.failed webhook records the failure; abandoning releases the hold', async () => {
  const b = await startPaidBooking();
  const payment = { id: rzpPaymentId(), order_id: b.payment.providerOrderId, amount: Math.round(b.payment.amount * 100), currency: 'INR', status: 'failed', error_description: 'Card declined' };
  await webhook(agent(t.base), 'payment.failed', { payment: { entity: payment } });
  const o = await until(async () => { const x = await M.PaymentOrder.findOne({ id: b.payment.orderId }).lean(); return x.failedAttempts > 0 && x; });
  assert.equal(o.failureReason, 'Card declined');
  const f = await b.a.post('/api/payments/fail', { orderId: b.payment.orderId, reason: 'User closed checkout' });
  assert.equal(f.status, 200);
  const bk = await M.Booking.findOne({ id: b.booking.id }).lean();
  assert.equal(bk.status, 'Expired');
  assert.equal(bk.slotLock, undefined);
});

test('expired hold: sweep releases the slot; a late payment re-takes the free slot', async () => {
  const b = await startPaidBooking();
  await M.Booking.collection.updateOne({ id: b.booking.id }, { $set: { createdAt: new Date(Date.now() - 11 * 60000) } });
  const { releaseExpiredHolds } = await import('../server/lib/bookings.js');
  assert.ok(await releaseExpiredHolds() >= 1);
  assert.equal((await M.Booking.findOne({ id: b.booking.id }).lean()).status, 'Expired');
  assert.equal((await M.PaymentOrder.findOne({ id: b.payment.orderId }).lean()).status, 'expired');
  const pid = rzpPaymentId();
  rzp.payment(pid, { order_id: b.payment.providerOrderId, amount: Math.round(b.payment.amount * 100) });
  const v = await b.a.post('/api/payments/verify', { orderId: b.payment.orderId, paymentId: pid, signature: sign(`${b.payment.providerOrderId}|${pid}`, RZP.keySecret) });
  assert.equal(v.status, 200, v.text);
});

test('late payment when the slot was taken by someone else is refunded automatically', async () => {
  const b = await startPaidBooking();
  await M.Booking.collection.updateOne({ id: b.booking.id }, { $set: { createdAt: new Date(Date.now() - 11 * 60000) } });
  const { releaseExpiredHolds } = await import('../server/lib/bookings.js');
  await releaseExpiredHolds();
  // someone else books the same slot
  const o2 = rzp.order();
  const other = await (await freshPatient()).post('/api/bookings', { doctorId: 'demo-doc-1', locationId: 'demo-loc-1-o', date: b.booking.date, time: b.booking.timeSlot });
  assert.equal(other.status, 200, other.text);
  assert.ok(o2.id);
  const pid = rzpPaymentId();
  rzp.payment(pid, { order_id: b.payment.providerOrderId, amount: Math.round(b.payment.amount * 100) });
  const rf = rzp.refund(pid);
  const v = await b.a.post('/api/payments/verify', { orderId: b.payment.orderId, paymentId: pid, signature: sign(`${b.payment.providerOrderId}|${pid}`, RZP.keySecret) });
  assert.equal(v.status, 409);
  assert.equal(v.body.code, 'HOLD_EXPIRED');
  assert.equal(rf.seen.amount, Math.round(b.payment.amount * 100));
  assert.equal((await M.PaymentOrder.findOne({ id: b.payment.orderId }).lean()).status, 'refunded');
  assert.equal(await M.LedgerTransaction.countDocuments({ paymentOrderId: b.payment.orderId }), 0);
});

async function paidBooking() {
  const b = await startPaidBooking();
  const pid = rzpPaymentId();
  rzp.payment(pid, { order_id: b.payment.providerOrderId, amount: Math.round(b.payment.amount * 100) });
  const v = await b.a.post('/api/payments/verify', { orderId: b.payment.orderId, paymentId: pid, signature: sign(`${b.payment.providerOrderId}|${pid}`, RZP.keySecret) });
  assert.equal(v.status, 200, v.text);
  return { ...b, pid };
}

test('admin partial then full refund via Refunds API with GST credit note; over-refund refused', async () => {
  const b = await paidBooking();
  const total = b.payment.amount;
  const rf1 = rzp.refund(b.pid);
  const r1 = await admin.post(`/api/admin/bookings/${b.booking.id}/refund`, { amount: 100, reason: 'Goodwill partial refund' });
  assert.equal(r1.status, 200, r1.text);
  assert.equal(rf1.seen.amount, 10000);
  assert.equal(r1.body.paymentOrder.refundedAmount, 100);
  const over = await admin.post(`/api/admin/bookings/${b.booking.id}/refund`, { amount: total, reason: 'too much' });
  assert.equal(over.status, 400);
  // rest via ledger endpoint (defaults to everything left)
  const inv = await M.LedgerTransaction.findOne({ paymentOrderId: b.payment.orderId, documentType: 'invoice' }).lean();
  const rf2 = rzp.refund(b.pid);
  const r2 = await admin.post(`/api/admin/ledger/transactions/${inv.id}/refund`, { amount: total - 100, reason: 'Full refund remainder' });
  assert.equal(r2.status, 200, r2.text);
  assert.equal(rf2.seen.amount, Math.round((total - 100) * 100));
  assert.equal(r2.body.creditNote.documentType, 'credit_note', 'platform fee part -> GST credit note');
  const order = await M.PaymentOrder.findOne({ id: b.payment.orderId }).lean();
  assert.equal(order.status, 'refunded');
  const notes = await M.LedgerTransaction.find({ paymentOrderId: b.payment.orderId, type: 'refund' }).lean();
  assert.equal(notes.length, 2);
  assert.ok(notes.every(n => n.razorpayRefundId.startsWith('rfnd_')));
  const orig = await M.LedgerTransaction.findOne({ id: inv.id }).lean();
  assert.equal(orig.refundStatus, 'full');
  // patient / doctor cannot call admin refunds
  assert.equal((await b.a.post(`/api/admin/bookings/${b.booking.id}/refund`, { amount: 1, reason: 'hack' })).status, 401);
  // audit trail
  assert.ok(await M.AdminAuditLog.countDocuments({ action: /refund/ }) >= 2);
});

test('refund failure at Razorpay is reported and nothing is booked to the ledger', async () => {
  const b = await paidBooking();
  rzp.refundFail(b.pid);
  const r = await admin.post(`/api/admin/bookings/${b.booking.id}/refund`, { amount: 50, reason: 'try refund' });
  assert.equal(r.status, 502);
  assert.equal(await M.LedgerTransaction.countDocuments({ paymentOrderId: b.payment.orderId, type: 'refund' }), 0);
});

test('refund webhooks: refund.processed updates status; refund.failed reverses the credit note', async () => {
  const b = await paidBooking();
  const rf = rzp.refund(b.pid, { status: 'pending' });
  const r = await admin.post(`/api/admin/bookings/${b.booking.id}/refund`, { amount: 60, reason: 'pending refund' });
  assert.equal(r.status, 200);
  assert.equal(r.body.refund.status, 'pending');
  await webhook(agent(t.base), 'refund.processed', { refund: { entity: { id: rf.id, payment_id: b.pid, amount: 6000, status: 'processed' } } });
  await until(async () => (await M.PaymentOrder.findOne({ id: b.payment.orderId }).lean()).refunds.some(x => x.providerRefundId === rf.id && x.status === 'processed'));

  const rf2 = rzp.refund(b.pid, { status: 'pending' });
  const r2 = await admin.post(`/api/admin/bookings/${b.booking.id}/refund`, { amount: 40, reason: 'second refund' });
  assert.equal(r2.status, 200);
  await webhook(agent(t.base), 'refund.failed', { refund: { entity: { id: rf2.id, payment_id: b.pid, amount: 4000, status: 'failed' } } });
  const o = await until(async () => { const x = await M.PaymentOrder.findOne({ id: b.payment.orderId }).lean(); return x.refunds.some(y => y.providerRefundId === rf2.id && y.status === 'failed') && x; });
  assert.equal(o.refundedAmount, 60);
  const cn = await M.LedgerTransaction.findOne({ invoiceNumber: r2.body.creditNote.invoiceNumber }).lean();
  assert.equal(cn.status, 'failed');
});

test('doctor cancellation refunds the full online amount (credit note for the platform fee)', async () => {
  const b = await paidBooking();
  const doc = agent(t.base); await login(doc, '9000020000', 'doctor');
  const rf = rzp.refund(b.pid);
  const bk = await M.Booking.findOne({ id: b.booking.id }).lean();
  if (bk.status === 'Pending') assert.equal((await doc.post(`/api/doctor-portal/bookings/${b.booking.id}/accept`, {})).status, 200);
  const c = await doc.post(`/api/doctor-portal/bookings/${b.booking.id}/cancel`, { reason: 'Doctor unavailable' });
  assert.equal(c.status, 200, c.text);
  assert.equal(rf.seen.amount, Math.round(b.payment.amount * 100));
  assert.equal(c.body.refund.status, 'processed');
  const cn = await M.LedgerTransaction.findOne({ paymentOrderId: b.payment.orderId, type: 'refund' }).lean();
  assert.equal(cn.documentType, 'credit_note');
});

test('subscription purchase (upgrade) + renewal through Razorpay', async () => {
  const doc = agent(t.base); await login(doc, '9000020021', 'doctor'); // Basic doctor
  const o = rzp.order();
  const c = await doc.post('/api/subscriptions/checkout', { planCode: 'pro', price: 1 });
  assert.equal(c.status, 200, c.text);
  const plan = (await doc.get('/api/subscriptions/plans?audience=doctor')).body.plans.find(p => p.code === 'pro');
  assert.equal(o.seen.amount, Math.round(plan.price * 100), 'plan price from server');
  assert.equal(o.seen.notes.type, 'subscription');
  const pid = rzpPaymentId();
  rzp.payment(pid, { order_id: c.body.payment.providerOrderId, amount: o.seen.amount });
  const v = await doc.post('/api/payments/verify', { orderId: c.body.payment.orderId, paymentId: pid, signature: sign(`${c.body.payment.providerOrderId}|${pid}`, RZP.keySecret) });
  assert.equal(v.status, 200, v.text);
  const me1 = (await doc.get('/api/subscriptions/me')).body;
  assert.equal(me1.current.code, 'pro');
  const exp1 = new Date(me1.subscription.expiresAt).getTime();
  // renewal extends from the current expiry
  const o2 = rzp.order();
  const c2 = await doc.post('/api/subscriptions/checkout', { planCode: 'pro' });
  const pid2 = rzpPaymentId();
  rzp.payment(pid2, { order_id: c2.body.payment.providerOrderId, amount: o2.seen.amount });
  assert.equal((await doc.post('/api/payments/verify', { orderId: c2.body.payment.orderId, paymentId: pid2, signature: sign(`${c2.body.payment.providerOrderId}|${pid2}`, RZP.keySecret) })).status, 200);
  const me2 = (await doc.get('/api/subscriptions/me')).body;
  assert.ok(new Date(me2.subscription.expiresAt).getTime() - exp1 > 25 * 86400000);
  const inv = await M.LedgerTransaction.find({ type: 'subscription', partyId: 'demo-doc-22' }).lean();
  assert.ok(inv.length >= 2 && inv.every(i => i.razorpayPaymentId.startsWith('pay_')));
  // subscription refund (admin) -> credit note
  const rf = rzp.refund(pid2);
  const r = await admin.post(`/api/admin/payments/${c2.body.payment.orderId}/refund`, { reason: 'Customer requested' });
  assert.equal(r.status, 200, r.text);
  assert.equal(rf.seen.amount, o2.seen.amount);
  assert.equal(r.body.creditNote.documentType, 'credit_note');
});

test('mock payment endpoint does not exist in Razorpay mode', async () => {
  const b = await startPaidBooking();
  const r = await b.a.post('/api/payments/mock/authorize', { orderId: b.payment.orderId });
  assert.equal(r.status, 404);
});
