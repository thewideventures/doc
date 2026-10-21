// Payments: public config, client verification, cancel, Razorpay webhook, dev-only mock checkout; subscription plans & checkout.
import crypto from 'crypto';
import express from 'express';
import { PaymentOrder, WebhookEvent } from '../models/index.js';
import { requireUser } from '../lib/userAuth.js';
import { rateLimit, userKey } from '../lib/rateLimit.js';
import { getProviderByName, getPaymentProvider, paymentsPublicConfig, paymentsNotConfigured } from '../lib/payments/index.js';
import { verifyClientPayment, processWebhookEvent } from '../lib/payments/apply.js';
import { failPaymentOrder, bookingView, httpError } from '../lib/bookings.js';
import { startCheckout } from '../lib/subscriptions.js';
import { getPlans, effectivePlan, planSummary } from '../lib/plans.js';
import { parsePaging } from '../lib/http.js';
import { config } from '../lib/config.js';
import { validate, z, zId } from '../lib/validate.js';
import log from '../lib/logger.js';
import { wrap } from './common.js';

export const paymentsRouter = express.Router();
export const subscriptionsRouter = express.Router();

paymentsRouter.get('/config', (req, res) => res.json(paymentsPublicConfig()));

function ownsOrder(auth, order) {
  if (order.partyType === 'patient') return auth.role === 'patient' && order.partyId === auth.uid;
  if (order.partyType === 'doctor') return auth.role === 'doctor' && order.partyId === auth.doctor.id;
  if (order.partyType === 'clinic') return auth.role === 'clinic' && order.partyId === auth.clinic.id;
  return false;
}

const verifySchema = z.object({
  orderId: zId,
  paymentId: z.string().trim().min(6).max(64).regex(/^[A-Za-z0-9_]+$/, 'Invalid payment id'),
  signature: z.string().trim().max(128).default('')
});

paymentsRouter.post('/verify',
  requireUser(),
  rateLimit({ name: 'pay-verify', windowMs: 60 * 60 * 1000, max: 60, key: userKey }),
  validate({ body: verifySchema }),
  wrap(async (req, res) => {
    const { orderId, paymentId, signature } = req.body;
    const order = await PaymentOrder.findOne({ id: orderId });
    if (!order || !ownsOrder(req.auth, order)) throw httpError(404, 'Payment order not found');
    if (!getPaymentProvider()) throw paymentsNotConfigured();
    const r = await verifyClientPayment(order, { paymentId, signature });
    if (r.alreadyProcessed) return res.json({ success: true, alreadyProcessed: true, message: 'Payment already confirmed.' });
    if (r.booking) {
      const booking = r.booking;
      return res.json({ success: true, booking: bookingView(booking), message: booking.status === 'Pending' ? 'Payment successful — waiting for the doctor to accept your booking.' : 'Payment successful — your appointment is confirmed!' });
    }
    const out = r.subscription;
    res.json({ success: true, message: `${out.plan.name} plan activated. Invoice ${out.invoice.invoiceNumber}.`, invoice: { invoiceNumber: out.invoice.invoiceNumber, totalAmount: out.invoice.totalAmount, cgst: out.invoice.cgst, sgst: out.invoice.sgst, igst: out.invoice.igst, taxableValue: out.invoice.taxableValue } });
  }));

paymentsRouter.post('/fail', requireUser(), validate({ body: z.object({ orderId: zId, reason: z.string().max(200).optional() }) }), wrap(async (req, res) => {
  const order = await PaymentOrder.findOne({ id: req.body.orderId });
  if (!order || !ownsOrder(req.auth, order)) throw httpError(404, 'Payment order not found');
  await failPaymentOrder(order, (req.body.reason || 'Payment cancelled by user').slice(0, 200));
  res.json({ success: true, message: 'Payment cancelled. Your slot hold was released.' });
}));

// DEVELOPMENT ONLY (PAYMENTS_MODE=mock): simulates the hosted checkout and returns a signed test payment.
paymentsRouter.post('/mock/authorize', requireUser(), validate({ body: z.object({ orderId: zId }) }), wrap(async (req, res) => {
  const provider = getPaymentProvider();
  if (config.isProd || provider?.name !== 'mock') throw httpError(404, 'Not found');
  const order = await PaymentOrder.findOne({ id: req.body.orderId });
  if (!order || !ownsOrder(req.auth, order) || order.provider !== 'mock') throw httpError(404, 'Payment order not found');
  res.json({ success: true, ...provider.authorize(order) });
}));

/**
 * Razorpay webhook (mounted in app.js with express.raw BEFORE the JSON parser).
 * Verifies X-Razorpay-Signature over the raw body, stores the event id (idempotency), answers 200 immediately
 * and processes asynchronously (failed events are retried by a background sweep).
 */
export async function razorpayWebhook(req, res) {
  const provider = getProviderByName('razorpay');
  if (!provider || !config.payments.webhookSecret) return res.status(503).json({ error: 'Payments not configured', code: 'PAYMENTS_NOT_CONFIGURED' });
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const sig = String(req.headers['x-razorpay-signature'] || '');
  if (!raw.length || !provider.verifyWebhookSignature(raw, sig)) {
    log.warn('Rejected webhook with invalid signature', { ip: req.ip });
    return res.status(400).json({ error: 'Invalid signature' });
  }
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Invalid JSON' }); }
  const eventId = String(req.headers['x-razorpay-event-id'] || '').slice(0, 100) || `sha256:${crypto.createHash('sha256').update(raw).digest('hex')}`;
  try {
    await WebhookEvent.create({ eventId, provider: 'razorpay', event: String(body.event || '').slice(0, 60), payload: body.payload || {}, status: 'received' });
  } catch (e) {
    if (e?.code === 11000) return res.status(200).json({ ok: true, duplicate: true });
    log.error('Webhook store failed', { err: e.message });
    return res.status(500).json({ error: 'Temporary error' }); // Razorpay retries
  }
  res.status(200).json({ ok: true });
  setImmediate(() => { processWebhookEvent(eventId).catch(err => log.error('Webhook processing crashed', { err: err.message })); });
}

// -------- Subscriptions --------
const audienceOf = auth => (auth.role === 'doctor' ? 'doctor' : auth.role === 'clinic' ? 'clinic' : null);
const entityOf = auth => auth.doctor || auth.clinic;

subscriptionsRouter.get('/plans', wrap(async (req, res) => {
  const audience = req.query.audience === 'clinic' ? 'clinic' : 'doctor';
  const plans = (await getPlans()).filter(p => p.audience === audience && p.isActive !== false)
    .map(({ _id, __v, ...p }) => p);
  res.json({ plans, payments: paymentsPublicConfig() });
}));

subscriptionsRouter.get('/me', requireUser('doctor', 'clinic'), wrap(async (req, res) => {
  const audience = audienceOf(req.auth);
  const entity = entityOf(req.auth);
  const ep = await effectivePlan(entity, audience);
  const paging = parsePaging(req.query, { defaultLimit: 10 });
  const filter = { purpose: 'subscription', partyType: audience, partyId: entity.id, status: { $in: ['paid', 'refunded', 'partially_refunded'] } };
  const [items, total] = await Promise.all([
    PaymentOrder.find(filter).sort({ createdAt: -1 }).skip(paging.skip).limit(paging.limit).select('id amount status provider paidAt meta ledgerInvoiceNumber createdAt').lean(),
    PaymentOrder.countDocuments(filter)
  ]);
  res.json({ current: planSummary(ep), subscription: entity.subscription || {}, history: { items, total, page: paging.page, limit: paging.limit, pages: Math.max(1, Math.ceil(total / paging.limit)) } });
}));

subscriptionsRouter.post('/checkout', requireUser('doctor', 'clinic'),
  rateLimit({ name: 'sub-checkout', windowMs: 60 * 60 * 1000, max: 30, key: userKey }),
  wrap(async (req, res) => {
    const audience = audienceOf(req.auth);
    const entity = entityOf(req.auth);
    if (entity.status !== 'active' && entity.status !== 'pending') throw httpError(403, 'Subscriptions are not available for this account status');
    const planCode = String(req.body?.planCode || '').trim();
    if (!/^[a-z0-9_-]{2,30}$/.test(planCode)) throw httpError(400, 'Choose a plan');
    const out = await startCheckout({ audience, entity, planCode });
    if (out.activated) {
      const ep = await effectivePlan(out.entity, audience);
      return res.json({ success: true, activated: true, current: planSummary(ep), message: `Switched to ${out.plan.name}.` });
    }
    res.json({ success: true, activated: false, payment: out.payment, plan: { id: out.plan.id, name: out.plan.name, price: out.plan.price, durationDays: out.plan.durationDays } });
  }));
