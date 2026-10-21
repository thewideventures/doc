import crypto from 'crypto';

// DEVELOPMENT-ONLY test provider: no money moves. Enabled only when NODE_ENV !== 'production' AND PAYMENTS_MODE=mock.
// It mirrors the Razorpay flow (order -> signature -> fetch -> apply) so the same verification code path runs.
const MOCK_SECRET = crypto.randomBytes(32); // per process; signatures are issued by /api/payments/mock/authorize
const toPaise = inr => Math.round(Number(inr) * 100);
const sig = (orderId, paymentId) => crypto.createHmac('sha256', MOCK_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
const payments = new Map(); // paymentId -> { order_id, amount }

export const mockProvider = {
  name: 'mock',
  isConfigured: () => true,
  publicConfig: () => ({ provider: 'mock', testMode: true }),
  async createOrder({ amount, receipt }) {
    return { providerOrderId: `mock_order_${crypto.randomBytes(8).toString('hex')}`, amount, currency: 'INR', receipt };
  },
  /** Simulates the checkout: returns { paymentId, signature } for an order (server-side, dev only). */
  authorize(order) {
    const paymentId = `mock_pay_${crypto.randomBytes(8).toString('hex')}`;
    payments.set(paymentId, { order_id: order.providerOrderId, amount: toPaise(order.amount) });
    return { paymentId, signature: sig(order.providerOrderId, paymentId) };
  },
  verifySignature({ providerOrderId, paymentId, signature }) {
    if (!/^mock_pay_[a-f0-9]{16}$/.test(paymentId || '') || typeof signature !== 'string') return false;
    const a = Buffer.from(sig(providerOrderId, paymentId)); const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },
  async fetchPayment(paymentId) {
    const p = payments.get(paymentId);
    if (!p) throw new Error('Unknown mock payment');
    return { id: paymentId, entity: 'payment', order_id: p.order_id, amount: p.amount, currency: 'INR', status: 'captured', method: 'test' };
  },
  async capture(paymentId) { return this.fetchPayment(paymentId); },
  async refund({ paymentId, amount }) {
    return { providerRefundId: `mock_rfnd_${crypto.randomBytes(6).toString('hex')}`, status: 'processed', amount, paymentId };
  }
};
