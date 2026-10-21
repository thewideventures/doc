// Razorpay adapter using the official SDK (https://github.com/razorpay/razorpay-node).
// Amounts are integers in paise. Secrets are read from config and never logged or sent to clients.
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { config } from '../config.js';

let client = null;
function rzp() {
  if (!client) client = new Razorpay({ key_id: config.payments.keyId, key_secret: config.payments.keySecret });
  return client;
}

export const toPaise = inr => Math.round(Number(inr) * 100);
export const fromPaise = p => Math.round(Number(p)) / 100;

function hmacEqual(secret, data, signature) {
  if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', secret).update(data).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(expected, given);
}

function rzpError(e, fallback) {
  const desc = e?.error?.description || e?.description || e?.message || fallback;
  return Object.assign(new Error(desc), { providerStatus: e?.statusCode, providerCode: e?.error?.code });
}

export const razorpayProvider = {
  name: 'razorpay',
  isConfigured: () => Boolean(config.payments.keyId && config.payments.keySecret),
  publicConfig: () => ({ provider: 'razorpay', keyId: config.payments.keyId, testMode: config.payments.keyId.startsWith('rzp_test_') }),

  async createOrder({ amount, receipt, notes }) {
    try {
      const o = await rzp().orders.create({ amount: toPaise(amount), currency: 'INR', receipt: String(receipt).slice(0, 40), notes, payment_capture: true });
      if (o.amount !== toPaise(amount) || o.currency !== 'INR') throw new Error('Razorpay order amount mismatch');
      return { providerOrderId: o.id, amount: fromPaise(o.amount), currency: o.currency, receipt: o.receipt };
    } catch (e) { throw rzpError(e, 'Could not create Razorpay order'); }
  },

  /** Checkout signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret) */
  verifySignature({ providerOrderId, paymentId, signature }) {
    if (!providerOrderId || !/^pay_[A-Za-z0-9]{6,40}$/.test(paymentId || '')) return false;
    return hmacEqual(config.payments.keySecret, `${providerOrderId}|${paymentId}`, signature);
  },

  /** Webhook signature: HMAC_SHA256(raw body, webhook secret) */
  verifyWebhookSignature(rawBody, signature) {
    return hmacEqual(config.payments.webhookSecret, rawBody, signature);
  },

  async fetchPayment(paymentId) {
    try { return await rzp().payments.fetch(paymentId); } catch (e) { throw rzpError(e, 'Could not fetch payment from Razorpay'); }
  },

  async capture(paymentId, amountPaise) {
    try { return await rzp().payments.capture(paymentId, amountPaise, 'INR'); } catch (e) { throw rzpError(e, 'Could not capture payment'); }
  },

  async refund({ paymentId, amount, notes, receipt }) {
    try {
      const r = await rzp().payments.refund(paymentId, { amount: toPaise(amount), speed: 'normal', notes, receipt: receipt ? String(receipt).slice(0, 40) : undefined });
      return { providerRefundId: r.id, status: r.status === 'processed' ? 'processed' : r.status === 'failed' ? 'failed' : 'pending', amount: fromPaise(r.amount), paymentId };
    } catch (e) { throw rzpError(e, 'Razorpay refund failed'); }
  }
};
