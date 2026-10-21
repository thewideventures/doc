// Verified-payment application shared by the client verify call and the Razorpay webhook.
// Guarantees: signature checked, payment fetched from the provider and matched (order, amount, currency, status),
// atomic claim of the order (status created|expired|failed -> processing) so a payment is applied exactly once,
// unique index on providerPaymentId (a payment id can never settle two orders).
import { PaymentOrder, WebhookEvent } from '../../models/index.js';
import { getProviderByName, paymentsNotConfigured } from './index.js';
import { toPaise } from './razorpay.js';
import { confirmBookingPayment } from '../bookings.js';
import { activateSubscription } from '../subscriptions.js';
import { confirmLabOrderPayment } from '../labs.js';
import { applyRefundWebhook } from '../refunds.js';
import log from '../logger.js';

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });
const SETTLED = ['paid', 'refunded', 'partially_refunded'];
const CLAIMABLE = ['created', 'expired', 'failed'];
const STALE_CLAIM_MS = 2 * 60 * 1000;

/** Check a provider payment entity against our order. Returns a reason string when it does not match. */
export function mismatch(order, p) {
  if (!p || typeof p !== 'object') return 'payment not found';
  if (p.order_id !== order.providerOrderId) return 'order id mismatch';
  if (Number(p.amount) !== toPaise(order.amount)) return 'amount mismatch';
  if (String(p.currency || '').toUpperCase() !== (order.currency || 'INR')) return 'currency mismatch';
  return '';
}

async function captureIfNeeded(provider, order, p) {
  if (p.status === 'captured') return p;
  if (p.status === 'authorized') {
    const c = await provider.capture(p.id, toPaise(order.amount));
    if (c?.status !== 'captured') throw httpError(402, 'Payment could not be captured', 'PAYMENT_NOT_CAPTURED');
    return c;
  }
  throw httpError(402, p.status === 'failed' ? 'The payment failed. Please try again.' : `Payment is ${p.status || 'not complete'}.`, 'PAYMENT_NOT_CAPTURED');
}

/** Apply a captured, verified provider payment to the order (idempotent). */
export async function applyCapturedPayment(order, p, source) {
  let claimed;
  try {
    claimed = await PaymentOrder.findOneAndUpdate(
      { id: order.id, status: { $in: CLAIMABLE } },
      { $set: { status: 'processing', providerPaymentId: p.id, paymentMethod: String(p.method || '').slice(0, 30), claimedAt: new Date() } },
      { returnDocument: 'after' }
    );
    if (!claimed) {
      // a crashed earlier attempt can leave a stale claim for the same payment — take it over
      claimed = await PaymentOrder.findOneAndUpdate(
        { id: order.id, status: 'processing', providerPaymentId: p.id, claimedAt: { $lt: new Date(Date.now() - STALE_CLAIM_MS) } },
        { $set: { claimedAt: new Date() } }, { returnDocument: 'after' });
    }
  } catch (e) {
    if (e?.code === 11000) {
      log.warn('Payment replay blocked (payment id already used)', { orderId: order.id, source });
      throw httpError(409, 'This payment has already been used.', 'PAYMENT_REPLAYED');
    }
    throw e;
  }
  if (!claimed) {
    const cur = await PaymentOrder.findOne({ id: order.id });
    if (cur && cur.providerPaymentId === p.id && SETTLED.includes(cur.status)) return { order: cur, alreadyProcessed: true };
    if (cur?.status === 'processing') throw httpError(409, 'Your payment is being processed. Please wait a moment.', 'PAYMENT_PROCESSING');
    if (cur && SETTLED.includes(cur.status) && cur.providerPaymentId !== p.id) {
      // second, different payment against an already-paid order: never keep it
      log.warn('Duplicate payment for a settled order — refunding it', { orderId: order.id, source });
      const provider = getProviderByName(cur.provider);
      await provider?.refund({ paymentId: p.id, amount: Number(p.amount) / 100, notes: { reason: 'duplicate payment', orderId: cur.id } }).catch(e => log.error('Duplicate payment refund failed', { err: e.message }));
      throw httpError(409, 'This order was already paid. The duplicate payment is being refunded.', 'DUPLICATE_PAYMENT');
    }
    throw httpError(409, `This payment order is ${cur?.status || 'unavailable'}.`, 'ORDER_NOT_PAYABLE');
  }
  try {
    if (claimed.purpose === 'booking') {
      const booking = await confirmBookingPayment(claimed, { paymentId: p.id });
      return { order: claimed, booking };
    }
    if (claimed.purpose === 'lab_order') {
      const labOrder = await confirmLabOrderPayment(claimed, { paymentId: p.id });
      return { order: claimed, labOrder };
    }
    const sub = await activateSubscription(claimed, { paymentId: p.id });
    return { order: claimed, subscription: sub };
  } catch (e) {
    if (e?.code !== 'HOLD_EXPIRED') {
      // release the claim so a retry (client or webhook) can complete it
      await PaymentOrder.updateOne({ id: claimed.id, status: 'processing' }, { $set: { status: order.status === 'processing' ? 'created' : CLAIMABLE.includes(order.status) ? order.status : 'created', providerPaymentId: '' } });
      log.error('Applying payment failed', { orderId: claimed.id, source, err: e.message });
    }
    throw e;
  }
}

/** Client-side verification after checkout: signature -> fetch -> match -> capture -> apply. */
export async function verifyClientPayment(order, { paymentId, signature }) {
  if (SETTLED.includes(order.status) && order.providerPaymentId === paymentId) return { order, alreadyProcessed: true };
  const provider = getProviderByName(order.provider);
  if (!provider) throw paymentsNotConfigured();
  if (!provider.verifySignature({ providerOrderId: order.providerOrderId, paymentId, signature })) {
    await PaymentOrder.updateOne({ id: order.id }, { $inc: { failedAttempts: 1 } });
    log.warn('Payment signature verification failed', { orderId: order.id });
    throw httpError(400, 'Payment verification failed. If money was debited it will be refunded automatically.', 'PAYMENT_VERIFICATION_FAILED');
  }
  let p = await provider.fetchPayment(paymentId);
  const why = mismatch(order, p);
  if (why) {
    log.warn('Payment does not match order', { orderId: order.id, reason: why });
    await PaymentOrder.updateOne({ id: order.id }, { $inc: { failedAttempts: 1 }, $set: { failureReason: `Verification mismatch: ${why}` } });
    throw httpError(400, 'Payment details do not match this order.', 'PAYMENT_MISMATCH');
  }
  p = await captureIfNeeded(provider, order, p);
  return applyCapturedPayment(order, p, 'client');
}

// ------------------------------------------------------------------ webhooks
export async function processWebhookEvent(eventId) {
  const ev = await WebhookEvent.findOneAndUpdate({ eventId, status: { $in: ['received', 'failed'] }, attempts: { $lt: 6 } }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
  if (!ev) return null;
  let result = 'ignored';
  try {
    result = await handleRazorpayEvent(ev.event, ev.payload || {});
    await WebhookEvent.updateOne({ eventId }, { $set: { status: result === 'processed' ? 'processed' : 'ignored', processedAt: new Date(), error: '' } });
  } catch (e) {
    const benign = ['HOLD_EXPIRED', 'DUPLICATE_PAYMENT', 'ORDER_NOT_PAYABLE', 'PAYMENT_REPLAYED'].includes(e?.code);
    await WebhookEvent.updateOne({ eventId }, { $set: { status: benign ? 'processed' : 'failed', error: String(e?.message || e).slice(0, 300), processedAt: benign ? new Date() : null } });
    if (!benign) log.error('Webhook processing failed', { eventId, event: ev.event, err: e?.message });
    result = benign ? 'processed' : 'failed';
  }
  return result;
}

async function orderForPayment(p) {
  if (!p?.order_id) return null;
  return PaymentOrder.findOne({ provider: 'razorpay', providerOrderId: p.order_id });
}

async function handleRazorpayEvent(event, payload) {
  const p = payload.payment?.entity;
  switch (event) {
    case 'payment.captured':
    case 'order.paid':
    case 'payment.authorized': {
      const order = await orderForPayment(p);
      if (!order) return 'ignored';
      const why = mismatch(order, p);
      if (why) { log.warn('Webhook payment does not match order', { orderId: order.id, reason: why }); return 'ignored'; }
      let payment = p;
      if (p.status === 'authorized') {
        const provider = getProviderByName('razorpay');
        if (!provider) throw paymentsNotConfigured();
        payment = await captureIfNeeded(provider, order, p);
      }
      if (payment.status !== 'captured') return 'ignored';
      const r = await applyCapturedPayment(order, payment, 'webhook');
      return r.alreadyProcessed ? 'ignored' : 'processed';
    }
    case 'payment.failed': {
      const order = await orderForPayment(p);
      if (!order || order.status !== 'created') return 'ignored';
      // the customer may retry inside the same checkout, so the slot stays held until the hold window ends
      await PaymentOrder.updateOne({ id: order.id, status: 'created' }, { $inc: { failedAttempts: 1 }, $set: { failureReason: String(p.error_description || p.error_reason || 'Payment failed').slice(0, 200) } });
      return 'processed';
    }
    case 'refund.processed':
    case 'refund.failed':
      return applyRefundWebhook(payload.refund?.entity || {}, event);
    default:
      return 'ignored';
  }
}

/** Retry webhook events that failed or were never processed (crash between 200 and processing). */
export async function retryPendingWebhooks() {
  const stale = await WebhookEvent.find({ status: { $in: ['received', 'failed'] }, attempts: { $lt: 6 }, updatedAt: { $lt: new Date(Date.now() - 60 * 1000) } }).select('eventId').limit(50).lean();
  for (const e of stale) await processWebhookEvent(e.eventId);
  return stale.length;
}
