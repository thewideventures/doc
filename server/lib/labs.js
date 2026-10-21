// Lab tests + home sample collection. Pricing is computed server-side from the catalogue.
// GST treatment: the test price is collected on behalf of the lab (pass-through; diagnostic services are
// GST-exempt healthcare services), the home-collection fee is FindADoc's own taxable service, and the
// commission FindADoc charges the lab is invoiced to the lab (GST added on top).
import crypto from 'crypto';
import { Lab, LabTest, LabOrder, PaymentOrder, LedgerTransaction, HealthRecord } from '../models/index.js';
import { getSettings } from './settings.js';
import { recordLedgerTransaction, round2, computeGst } from './gst.js';
import { getPaymentProvider, getProviderByName, paymentsNotConfigured } from './payments/index.js';
import { paymentClientPayload, httpError } from './bookings.js';
import { refundPaymentOrder } from './refunds.js';
import { notify } from './notify.js';
import { queueMessage } from './messaging/index.js';
import { todayIST, addDays, isDateStr } from './time.js';
import log from './logger.js';

const rid = p => `${p}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
export const STATUS_FLOW = { Confirmed: ['SampleCollected', 'Cancelled'], SampleCollected: ['Processing', 'ReportReady'], Processing: ['ReportReady'] };
const STATUS_TEXT = { Confirmed: 'confirmed', SampleCollected: 'sample collected', Processing: 'being processed', ReportReady: 'report ready', Cancelled: 'cancelled', Expired: 'expired' };

export function labOrderView(o, { staff = false } = {}) {
  const x = typeof o.toObject === 'function' ? o.toObject() : { ...o };
  delete x._id; delete x.__v;
  if (!staff) { delete x.commission; delete x.commissionGst; delete x.labPayable; delete x.commissionPercent; delete x.commissionInvoiceNumber; }
  return x;
}

export function priceLabOrder(lab, tests, mode, settings) {
  const subtotal = round2(tests.reduce((s, t) => s + (t.price || 0), 0));
  const collectionFee = mode === 'home_collection' ? round2(Math.max(0, settings.labHomeCollectionFee ?? 99)) : 0;
  const commissionPercent = Math.max(0, Math.min(50, lab.commissionPercent ?? settings.labCommissionPercent ?? 15));
  const commission = round2(subtotal * commissionPercent / 100);
  const gst = computeGst({ amount: commission, rate: settings.gstRate ?? 18, inclusive: false, partyStateCode: lab.stateCode || '', businessStateCode: settings.businessStateCode || '' });
  return { subtotal, collectionFee, total: round2(subtotal + collectionFee), commissionPercent, commission, commissionGst: round2(gst.totalTax), labPayable: round2(subtotal - commission - gst.totalTax) };
}

export async function createLabOrder({ user, member = null, labId, testIds, mode, address, slotDate, slotWindow }) {
  const lab = await Lab.findOne({ id: labId, isActive: true }).lean();
  if (!lab) throw httpError(404, 'Lab not found');
  const ids = [...new Set(testIds)];
  const tests = await LabTest.find({ id: { $in: ids }, labId: lab.id, isActive: true }).lean();
  if (!tests.length || tests.length !== ids.length) throw httpError(400, 'One or more tests are not available at this lab', 'BAD_TESTS');
  if (mode === 'home_collection') {
    if (!lab.homeCollection || tests.some(t => t.homeCollection === false)) throw httpError(400, 'Home sample collection is not available for this selection', 'NO_HOME_COLLECTION');
    if (!address?.line1 || !/^\d{6}$/.test(address?.pincode || '')) throw httpError(400, 'Enter the collection address with a 6-digit PIN code');
    if (lab.pincodes?.length && !lab.pincodes.includes(address.pincode)) throw httpError(400, 'This lab does not collect samples at your PIN code yet', 'OUT_OF_AREA');
    if (!lab.collectionWindows.includes(slotWindow)) throw httpError(400, 'Choose a collection time window');
  }
  const today = todayIST();
  if (!isDateStr(slotDate) || slotDate < today || slotDate > addDays(today, 14)) throw httpError(400, 'Choose a date within the next 14 days');
  if (slotDate === today && mode === 'home_collection') {
    const nowH = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }));
    if (Number(slotWindow.slice(0, 2)) <= nowH + 1) throw httpError(400, 'That collection window has passed. Choose a later window or another day.');
  }
  const settings = await getSettings();
  const price = priceLabOrder(lab, tests, mode, settings);
  if (!(price.total > 0)) throw httpError(400, 'Nothing to pay for');
  const provider = getPaymentProvider();
  if (!provider) throw paymentsNotConfigured();
  const order = new LabOrder({
    id: rid('lab'), orderCode: `LAB-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    userId: user.id, memberId: member?.id || '', patientName: member?.name || user.name, patientPhone: user.phone,
    labId: lab.id, labName: lab.name,
    tests: tests.map(t => ({ testId: t.id, name: t.name, price: t.price, preparation: t.preparation || '', tatHours: t.tatHours || 24 })),
    mode, address: mode === 'home_collection' ? address : {}, slotDate, slotWindow: mode === 'home_collection' ? slotWindow : '',
    ...price, status: 'AwaitingPayment', statusHistory: [{ status: 'AwaitingPayment', at: new Date(), by: 'patient' }]
  });
  const po = new PaymentOrder({
    id: rid('pay'), purpose: 'lab_order', refId: order.id, partyType: 'patient', partyId: user.id, amount: price.total, provider: provider.name,
    meta: { platformFee: price.collectionFee, passThrough: price.subtotal, labId: lab.id, orderCode: order.orderCode, patientStateCode: user.stateCode || '' }
  });
  try {
    const p = await provider.createOrder({ amount: price.total, receipt: po.id, notes: { type: 'lab_order', labOrderId: order.id, orderCode: order.orderCode, party: 'patient', partyId: user.id } });
    po.providerOrderId = p.providerOrderId;
  } catch (e) {
    log.error('Lab payment order creation failed', { err: e.message });
    throw httpError(502, 'Could not start the payment right now. Please try again.', 'PAYMENT_INIT_FAILED');
  }
  await po.save();
  order.paymentOrderId = po.id;
  await order.save();
  return { order, payment: paymentClientPayload(po, { description: `Lab tests — ${lab.name}`, prefill: { name: user.name, contact: user.phone } }) };
}

/** Verified payment => confirm the order and write the ledger (patient invoice + commission invoice to the lab). */
export async function confirmLabOrderPayment(po, { paymentId }) {
  const o = await LabOrder.findOne({ id: po.refId });
  if (!o) throw httpError(404, 'Lab order not found');
  if (!['AwaitingPayment', 'Expired'].includes(o.status)) {
    // paid after cancellation: refund in full automatically
    po.status = 'paid'; po.providerPaymentId = paymentId; po.paidAt = new Date(); await po.save();
    await getProviderByName(po.provider)?.refund({ paymentId, amount: po.amount, notes: { reason: 'lab order no longer active', orderId: po.id } }).catch(e => log.error('Late lab payment refund failed', { err: e.message }));
    po.status = 'refunded'; po.refundedAmount = po.amount; await po.save();
    throw httpError(409, 'This lab order is no longer active, so the payment is being refunded.', 'HOLD_EXPIRED');
  }
  const settings = await getSettings();
  const lab = await Lab.findOne({ id: o.labId }).lean();
  const inv = await LedgerTransaction.findOne({ paymentOrderId: po.id, type: 'lab_order' }) || await recordLedgerTransaction({
    type: 'lab_order', category: 'lab_test', partyType: 'patient', partyId: o.userId, partyName: o.patientName, partyPhone: o.patientPhone,
    partyStateCode: po.meta?.patientStateCode || '', amount: o.collectionFee, passThroughAmount: o.subtotal, labOrderId: o.id,
    payeeType: 'lab', payeeId: o.labId, paymentOrderId: po.id, paymentReference: paymentId, paymentMethod: po.paymentMethod ? `online:${po.paymentMethod}` : 'online',
    razorpayOrderId: po.provider === 'razorpay' ? po.providerOrderId : '', razorpayPaymentId: po.provider === 'razorpay' ? paymentId : '',
    description: `Lab order ${o.orderCode} • ${o.labName} • ${o.tests.map(t => t.name).join(', ')}`.slice(0, 300) + (o.collectionFee ? ' (home collection fee taxable; test charges collected on behalf of the lab)' : ' (test charges collected on behalf of the lab)')
  }, settings);
  let commInv = null;
  if (o.commission > 0) {
    commInv = await LedgerTransaction.findOne({ labOrderId: o.id, type: 'lab_commission', documentType: 'invoice' }) || await recordLedgerTransaction({
      type: 'lab_commission', category: 'lab_commission', partyType: 'lab', partyId: o.labId, partyName: lab?.name || o.labName, partyPhone: lab?.phone || '',
      partyGstin: lab?.gstin || '', partyStateCode: lab?.stateCode || '', amount: o.commission, inclusive: false, labOrderId: o.id, status: 'paid',
      paymentMethod: 'deducted_from_settlement', description: `Commission ${o.commissionPercent}% on lab order ${o.orderCode}`
    }, settings);
  }
  po.ledgerInvoiceNumber = inv.invoiceNumber; po.status = 'paid'; po.providerPaymentId = paymentId; po.paidAt = po.paidAt || new Date();
  await po.save();
  o.status = 'Confirmed'; o.invoiceNumber = inv.invoiceNumber; o.commissionInvoiceNumber = commInv?.invoiceNumber || '';
  o.statusHistory.push({ status: 'Confirmed', at: new Date(), by: 'payment', note: `Paid ₹${po.amount}` });
  await o.save();
  await notify({ type: 'admin', id: 'admin' }, { type: 'lab_order', title: 'New lab order', body: `${o.orderCode} • ${o.labName} • ${o.mode === 'home_collection' ? `Home collection ${o.slotDate} ${o.slotWindow}` : `Lab visit ${o.slotDate}`}`, data: { labOrderId: o.id } });
  await queueMessage({ kind: 'lab_status', userId: o.userId, refId: o.id, params: { code: o.orderCode, status: STATUS_TEXT.Confirmed }, dedupeKey: `lab_status:${o.id}:Confirmed` });
  return o;
}

export async function failLabPayment(po) {
  await LabOrder.updateOne({ id: po.refId, status: 'AwaitingPayment' }, { $set: { status: 'Expired' }, $push: { statusHistory: { status: 'Expired', at: new Date(), by: 'patient', note: 'Payment cancelled' } } });
}

export async function expireLabHolds() {
  const settings = await getSettings();
  const cutoff = new Date(Date.now() - Math.max(10, (settings.paymentHoldMinutes || 10) * 3) * 60000);
  const stale = await LabOrder.find({ status: 'AwaitingPayment', createdAt: { $lt: cutoff } }).select('id paymentOrderId').lean();
  if (!stale.length) return 0;
  await LabOrder.updateMany({ id: { $in: stale.map(s => s.id) } }, { $set: { status: 'Expired' }, $push: { statusHistory: { status: 'Expired', at: new Date(), by: 'system', note: 'Payment not completed' } } });
  await PaymentOrder.updateMany({ id: { $in: stale.map(s => s.paymentOrderId) }, status: 'created' }, { $set: { status: 'expired' } });
  return stale.length;
}

/** Cancel before sample collection: full refund + commission credit note to the lab. */
export async function cancelLabOrder(o, { by, reason = '' }) {
  if (o.status === 'AwaitingPayment') {
    o.status = 'Cancelled'; o.cancelReason = reason; o.statusHistory.push({ status: 'Cancelled', at: new Date(), by, note: reason });
    await o.save();
    await PaymentOrder.updateOne({ id: o.paymentOrderId, status: 'created' }, { $set: { status: 'failed', failureReason: 'Lab order cancelled' } });
    return { order: o, refund: { amount: 0, status: 'none' } };
  }
  if (o.status !== 'Confirmed') throw httpError(400, 'This lab order can no longer be cancelled (sample already collected)', 'NOT_CANCELLABLE');
  const po = await PaymentOrder.findOne({ id: o.paymentOrderId });
  let refund = { amount: 0, status: 'none' };
  if (po && ['paid', 'partially_refunded'].includes(po.status)) {
    const out = await refundPaymentOrder(po, { split: { platform: o.collectionFee, pass: o.subtotal }, reason: `Lab order cancelled by ${by}${reason ? `: ${reason}` : ''}`, by });
    refund = { amount: out.refund.amount, status: 'processed', reference: out.txn.invoiceNumber };
    o.refundAmount = out.refund.amount;
  }
  if (o.commissionInvoiceNumber) {
    const settings = await getSettings();
    const lab = await Lab.findOne({ id: o.labId }).lean();
    await recordLedgerTransaction({
      type: 'refund', category: 'lab_refund', series: 'credit', partyType: 'lab', partyId: o.labId, partyName: lab?.name || o.labName, partyGstin: lab?.gstin || '',
      partyStateCode: lab?.stateCode || '', amount: -o.commission, inclusive: false, labOrderId: o.id, originalInvoiceNumber: o.commissionInvoiceNumber,
      paymentMethod: 'settlement_adjustment', description: `Commission reversal — lab order ${o.orderCode} cancelled`
    }, settings);
  }
  o.status = 'Cancelled'; o.cancelReason = String(reason).slice(0, 300);
  o.statusHistory.push({ status: 'Cancelled', at: new Date(), by, note: o.cancelReason });
  await o.save();
  await queueMessage({ kind: 'lab_status', userId: o.userId, refId: o.id, params: { code: o.orderCode, status: STATUS_TEXT.Cancelled }, dedupeKey: `lab_status:${o.id}:Cancelled` });
  return { order: o, refund };
}

export async function updateLabOrderStatus(o, status, { by, note = '' }) {
  const allowed = STATUS_FLOW[o.status] || [];
  if (!allowed.includes(status) || status === 'Cancelled') throw httpError(400, `Cannot move a ${o.status} order to ${status}`, 'BAD_TRANSITION');
  if (status === 'ReportReady' && !o.reportRecordIds.length) throw httpError(400, 'Upload the report first', 'NO_REPORT');
  o.status = status;
  o.statusHistory.push({ status, at: new Date(), by, note: String(note).slice(0, 200) });
  await o.save();
  await queueMessage({ kind: 'lab_status', userId: o.userId, refId: o.id, params: { code: o.orderCode, status: STATUS_TEXT[status] }, dedupeKey: `lab_status:${o.id}:${status}` });
  return o;
}

/** Report file (already stored privately) -> patient's health record; order -> ReportReady. */
export async function attachLabReport(o, file, { by, title = '' }) {
  if (!['Confirmed', 'SampleCollected', 'Processing', 'ReportReady'].includes(o.status)) throw httpError(400, `Cannot attach a report to a ${o.status} order`);
  if (o.reportRecordIds.length >= 10) throw httpError(400, 'Too many reports on this order');
  const rec = await HealthRecord.create({
    id: rid('rec'), userId: o.userId, memberId: o.memberId || '', type: 'lab_report', title: String(title || `Lab report — ${o.tests.map(t => t.name).join(', ')}`).slice(0, 160),
    date: todayIST(), source: 'lab', labOrderId: o.id, labName: o.labName, file
  });
  o.reportRecordIds.push(rec.id);
  if (o.status !== 'ReportReady') { o.status = 'ReportReady'; o.statusHistory.push({ status: 'ReportReady', at: new Date(), by, note: 'Report uploaded' }); }
  await o.save();
  await queueMessage({ kind: 'lab_status', userId: o.userId, refId: o.id, params: { code: o.orderCode, status: STATUS_TEXT.ReportReady }, dedupeKey: `lab_status:${o.id}:ReportReady:${rec.id}` });
  return rec;
}

export const hashPartnerKey = k => crypto.createHash('sha256').update(`lab-partner:${k}`).digest('hex');
