// Refunds (full / partial) through the payment provider + GST credit note / refund voucher in the ledger.
// Used by booking cancellation rules, admin refunds (Ledger / Bookings) and Razorpay refund webhooks.
import crypto from 'crypto';
import { Booking, Doctor, Clinic, PaymentOrder, LedgerTransaction } from '../models/index.js';
import { getSettings } from './settings.js';
import { recordLedgerTransaction, round2 } from './gst.js';
import { getProviderByName, paymentsNotConfigured } from './payments/index.js';
import { notify } from './notify.js';
import log from './logger.js';

const rid = p => `${p}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });

export function refundedSoFar(order) {
  const fromList = round2((order.refunds || []).filter(r => r.status !== 'failed').reduce((s, r) => s + (r.amount || 0), 0));
  return Math.max(round2(order.refundedAmount || 0), fromList);
}
export const refundableAmount = order => (['paid', 'partially_refunded'].includes(order.status) ? Math.max(0, round2(order.amount - refundedSoFar(order))) : 0);

function parts(order) {
  if (order.purpose !== 'booking' && order.purpose !== 'lab_order') return { platform: round2(order.amount), pass: 0 };
  const platform = round2(order.meta?.platformFee ?? 0);
  const pass = round2(order.meta?.passThrough ?? Math.max(0, order.amount - platform));
  return { platform, pass };
}
function refundedParts(order) {
  const done = refundedSoFar(order);
  const rp = round2(order.meta?.refundedPlatform || 0);
  const rpass = round2(order.meta?.refundedPass ?? Math.max(0, done - rp));
  return { platform: rp, pass: rpass };
}

/**
 * Refund (part of) a paid order.
 * opts: { amount?, split?: { platform, pass }, reason, by, booking?, providerRefund?: { providerRefundId, status } }
 * - amount defaults to everything still refundable
 * - without split, a booking refund is allocated to the pass-through (doctor fee) first, then the platform fee
 * Returns { refund, txn, order }.
 */
export async function refundPaymentOrder(order, { amount, split, reason = 'Refund', by = 'admin', booking = null, providerRefund = null } = {}) {
  if (!['paid', 'partially_refunded'].includes(order.status)) throw httpError(400, `This payment is ${order.status} and cannot be refunded`, 'NOT_REFUNDABLE');
  if (!order.providerPaymentId) throw httpError(400, 'No captured payment on this order', 'NOT_REFUNDABLE');
  const remaining = refundableAmount(order);
  const total = parts(order);
  const doneParts = refundedParts(order);
  const leftPlatform = Math.max(0, round2(total.platform - doneParts.platform));
  const leftPass = Math.max(0, round2(total.pass - doneParts.pass));
  let platformPart, passPart;
  if (split) {
    platformPart = Math.min(round2(split.platform || 0), leftPlatform);
    passPart = Math.min(round2(split.pass || 0), leftPass);
  } else {
    const amt = round2(amount ?? remaining);
    if (!(amt > 0)) throw httpError(400, 'Refund amount must be greater than zero', 'BAD_AMOUNT');
    if (amt > remaining + 0.001) throw httpError(400, `At most ₹${remaining} can still be refunded on this payment`, 'BAD_AMOUNT');
    passPart = Math.min(amt, leftPass);
    platformPart = round2(Math.min(amt - passPart, leftPlatform));
    if (round2(passPart + platformPart) < amt) passPart = round2(amt - platformPart); // rounding slack
  }
  const refundAmt = round2(platformPart + passPart);
  if (!(refundAmt > 0)) throw httpError(400, 'Nothing left to refund on this payment', 'BAD_AMOUNT');

  const refundId = rid('rf');
  let r = providerRefund;
  if (!r) {
    const provider = getProviderByName(order.provider);
    if (!provider) throw paymentsNotConfigured();
    try {
      r = await provider.refund({ paymentId: order.providerPaymentId, amount: refundAmt, notes: { orderId: order.id, reason: String(reason).slice(0, 200), by }, receipt: refundId });
    } catch (e) {
      log.error('Refund failed at provider', { orderId: order.id, err: e.message });
      order.refunds.push({ id: refundId, amount: refundAmt, status: 'failed', providerRefundId: '', at: new Date(), reason: `${reason} — ${e.message}`.slice(0, 300), by });
      await order.save();
      throw httpError(502, `Refund failed: ${e.message}`, 'REFUND_FAILED');
    }
  }
  if (r.status === 'failed') {
    order.refunds.push({ id: refundId, amount: refundAmt, status: 'failed', providerRefundId: r.providerRefundId || '', at: new Date(), reason, by });
    await order.save();
    throw httpError(502, 'Refund failed at the payment provider', 'REFUND_FAILED');
  }

  // ---- ledger: credit note when GST-bearing platform fee is refunded, refund voucher otherwise
  const settings = await getSettings();
  const orig = order.ledgerInvoiceNumber ? await LedgerTransaction.findOne({ invoiceNumber: order.ledgerInvoiceNumber }) : null;
  const isBooking = order.purpose === 'booking';
  const isLab = order.purpose === 'lab_order';
  const b = isBooking ? booking || await Booking.findOne({ id: order.refId }) : null;
  const txn = await recordLedgerTransaction({
    type: 'refund', category: isBooking ? 'booking_refund' : isLab ? 'lab_refund' : 'subscription_refund', series: platformPart > 0 ? 'credit' : 'refund',
    labOrderId: isLab ? order.refId : '',
    partyType: order.partyType, partyId: orig?.partyId || order.partyId, partyName: orig?.partyName || b?.patientName || order.meta?.partyName || '',
    partyPhone: orig?.partyPhone || b?.patientPhone || '', partyGstin: orig?.partyGstin || '', partyStateCode: orig?.partyStateCode || '',
    amount: -platformPart, passThroughAmount: -passPart, plan: orig?.plan || '',
    bookingId: b?.id || '', doctorId: b?.doctorId || '', bookingMode: b?.bookingMode || '',
    payeeType: b?.payeeType || '', payeeId: b?.payeeId || '', paymentOrderId: order.id,
    originalInvoiceNumber: order.ledgerInvoiceNumber || '', paymentReference: r.providerRefundId || '',
    razorpayOrderId: order.provider === 'razorpay' ? order.providerOrderId : '', razorpayPaymentId: order.provider === 'razorpay' ? order.providerPaymentId : '',
    razorpayRefundId: order.provider === 'razorpay' ? r.providerRefundId || '' : '',
    description: `${isBooking ? `Refund for booking ${b?.bookingCode || order.refId}` : isLab ? `Refund for lab order ${order.meta?.orderCode || order.refId}` : `Refund for ${order.meta?.planName || 'subscription'}`} — ${reason}`.slice(0, 300)
  }, settings);
  if (orig) {
    orig.refundedAmount = round2((orig.refundedAmount || 0) + refundAmt);
    orig.refundStatus = orig.refundedAmount >= orig.totalAmount - 0.001 ? 'full' : 'partial';
    await orig.save();
  }
  if (b && passPart > 0 && b.payeeId) {
    const Model = b.payeeType === 'clinic' ? Clinic : Doctor;
    await Model.updateOne({ id: b.payeeId }, { $inc: { claimPendingFee: -passPart } });
  }

  const entry = { id: refundId, amount: refundAmt, status: r.status === 'processed' ? 'processed' : 'pending', providerRefundId: r.providerRefundId || '', at: new Date(), reason: String(reason).slice(0, 300), by, creditNoteNumber: txn.invoiceNumber };
  order.refunds.push(entry);
  order.refundedAmount = round2(refundedSoFar(order));
  order.meta = { ...(order.meta || {}), refundedPlatform: round2(doneParts.platform + platformPart), refundedPass: round2(doneParts.pass + passPart) };
  order.markModified('meta');
  order.status = order.refundedAmount >= order.amount - 0.001 ? 'refunded' : 'partially_refunded';
  await order.save();

  if (b) {
    b.refundAmount = round2((b.refundAmount || 0) + refundAmt);
    b.refundStatus = entry.status === 'processed' ? 'processed' : 'pending';
    b.refundReference = entry.providerRefundId;
    b.refundLedgerNumber = txn.invoiceNumber;
    b.paymentStatus = order.status === 'refunded' ? 'refunded' : 'partially_refunded';
    if (!booking) await b.save();
  }
  return { refund: entry, txn, order };
}

/** Razorpay refund.processed / refund.failed webhook handling. */
export async function applyRefundWebhook(refundEntity, eventName) {
  const order = await PaymentOrder.findOne({ providerPaymentId: refundEntity.payment_id });
  if (!order) return 'ignored';
  const entry = order.refunds.find(r => r.providerRefundId === refundEntity.id);
  if (eventName === 'refund.processed') {
    if (!entry) {
      // refund initiated outside the app (Razorpay dashboard): mirror it in the ledger
      if (refundableAmount(order) <= 0) return 'ignored';
      await refundPaymentOrder(order, { amount: Math.round(refundEntity.amount) / 100, reason: 'Refund issued from Razorpay dashboard', by: 'razorpay', providerRefund: { providerRefundId: refundEntity.id, status: 'processed' } });
      return 'processed';
    }
    if (entry.status === 'processed') return 'ignored';
    entry.status = 'processed';
    order.markModified('refunds');
    await order.save();
    if (order.purpose === 'booking') await Booking.updateOne({ id: order.refId, refundReference: refundEntity.id }, { $set: { refundStatus: 'processed' } });
    return 'processed';
  }
  if (eventName === 'refund.failed') {
    if (!entry || entry.status === 'failed') return 'ignored';
    entry.status = 'failed';
    order.markModified('refunds');
    // reverse the accounting for the failed refund
    if (entry.creditNoteNumber) await LedgerTransaction.updateOne({ invoiceNumber: entry.creditNoteNumber }, { $set: { status: 'failed' } });
    if (order.ledgerInvoiceNumber) {
      const orig = await LedgerTransaction.findOne({ invoiceNumber: order.ledgerInvoiceNumber });
      if (orig) { orig.refundedAmount = Math.max(0, round2((orig.refundedAmount || 0) - entry.amount)); orig.refundStatus = orig.refundedAmount <= 0 ? 'none' : 'partial'; await orig.save(); }
    }
    const t = parts(order);
    const prevPass = round2(order.meta?.refundedPass || 0);
    const passBack = Math.min(prevPass, entry.amount);
    order.meta = { ...(order.meta || {}), refundedPass: round2(prevPass - passBack), refundedPlatform: Math.max(0, round2((order.meta?.refundedPlatform || 0) - (entry.amount - passBack))) };
    order.markModified('meta');
    order.refundedAmount = Math.max(0, round2((order.refundedAmount || 0) - entry.amount));
    order.status = order.refundedAmount <= 0 ? 'paid' : order.refundedAmount >= order.amount ? 'refunded' : 'partially_refunded';
    await order.save();
    if (order.purpose === 'booking') {
      const b = await Booking.findOne({ id: order.refId });
      if (b) {
        if (passBack > 0 && b.payeeId && t.pass > 0) await (b.payeeType === 'clinic' ? Clinic : Doctor).updateOne({ id: b.payeeId }, { $inc: { claimPendingFee: passBack } });
        b.refundStatus = 'failed'; b.refundAmount = Math.max(0, round2((b.refundAmount || 0) - entry.amount));
        b.paymentStatus = order.status === 'paid' ? 'paid' : order.status;
        await b.save();
      }
    }
    await notify({ type: 'admin', id: 'admin' }, { type: 'payment', title: 'Refund failed', body: `Refund ${refundEntity.id} of ₹${entry.amount} on payment order ${order.id} failed at Razorpay. Retry it from Ledger / Bookings.`, data: { orderId: order.id } }).catch(() => {});
    log.warn('Refund failed (webhook)', { orderId: order.id, refundId: refundEntity.id });
    return 'processed';
  }
  return 'ignored';
}
