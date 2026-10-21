import express from 'express';
import {
  Clinic, Doctor, User, Booking, Review, SpecialityRequest,
  PayoutRequest, LedgerTransaction, Settings, PUBLIC_REVIEW_FILTER, ACCOUNT_STATUSES,
  SubscriptionPlan, PaymentOrder
} from '../models/index.js';
import { notify } from '../lib/notify.js';
import { getStorage, sendPrivateFile } from '../lib/storage/index.js';
import { getPlans, invalidatePlans, effectivePlan, planSummary } from '../lib/plans.js';
import { invalidateInactiveClinics } from '../lib/profiles.js';
import { bookingView, cancelBooking, bookingScopeFilter } from '../lib/bookings.js';
import { requireAdminAuth } from '../lib/adminAuth.js';
import { parsePaging, dateRange, searchFilter, paginate, sortSpec, toCsv, escapeRegex } from '../lib/http.js';
import { getSettings, invalidateSettings } from '../lib/settings.js';
import { STATE_CODES, round2, gstr1Section, isValidGstin } from '../lib/gst.js';
import { DEFAULT_BAD_WORDS } from '../config/profanity.js';
import { getEffectiveWordList, screenReviewText } from '../lib/moderation.js';
import { recalcDoctorRating, rescanReviews } from '../lib/reviews.js';
import { refundPaymentOrder, refundableAmount } from '../lib/refunds.js';
import { AdminAuditLog } from '../models/index.js';
import { validate, z } from '../lib/validate.js';
import { rateLimit } from '../lib/rateLimit.js';
import { wrap } from './common.js';

const router = express.Router();
router.use(requireAdminAuth);


// -----------------------------------------------------------------------------
// Entities: doctors / clinics / patients
// -----------------------------------------------------------------------------
const ENTITY = {
  doctors: { Model: Doctor, kind: 'doctor', search: ['name', 'email', 'phone', 'id', 'qualifications'], base: {} },
  clinics: { Model: Clinic, kind: 'clinic', search: ['name', 'email', 'phone', 'id', 'city', 'address'], base: {} },
  patients: { Model: User, kind: 'patient', search: ['name', 'email', 'phone', 'id'], base: { role: 'patient' } }
};

function entityConfig(req, res) {
  const cfg = ENTITY[req.params.entity];
  if (!cfg) { res.status(404).json({ error: 'Unknown entity type' }); return null; }
  return cfg;
}

function statusFilter(status) {
  if (!status || status === 'all') return { status: { $ne: 'deleted' } };
  if (status === 'all_including_deleted') return {};
  const list = String(status).split(',').filter(s => ACCOUNT_STATUSES.includes(s));
  return list.length ? { status: { $in: list } } : { status: { $ne: 'deleted' } };
}

const ENTITY_SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  name: { name: 1 },
  name_desc: { name: -1 },
  rating: { rating: -1, createdAt: -1 }
};

router.get('/:entity(doctors|clinics|patients)', wrap(async (req, res) => {
  const cfg = entityConfig(req, res); if (!cfg) return;
  const q = req.query;
  const filter = {
    ...cfg.base,
    ...statusFilter(q.status),
    ...dateRange(q, 'createdAt'),
    ...searchFilter(q.search, cfg.search)
  };
  if (q.premium === 'true') filter.isPremium = true;
  if (q.premium === 'false') filter.isPremium = { $ne: true };
  const result = await paginate(cfg.Model, filter, parsePaging(q), sortSpec(q.sort, ENTITY_SORTS));
  res.json(result);
}));

router.get('/:entity(doctors|clinics|patients)/:id', wrap(async (req, res) => {
  const cfg = entityConfig(req, res); if (!cfg) return;
  const item = await cfg.Model.findOne({ id: req.params.id, ...cfg.base }).lean();
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (item.documents) item.documents = item.documents.map(({ key, ...d }) => d);
  const related = {};
  if (cfg.kind !== 'patient') related.plan = planSummary(await effectivePlan(item, cfg.kind));
  if (cfg.kind === 'doctor') {
    const [bookings, reviews, transactions, payouts, linkedUser] = await Promise.all([
      Booking.find({ doctorId: item.id }).sort({ createdAt: -1 }).limit(10).lean(),
      Review.find({ doctorId: item.id }).sort({ createdAt: -1 }).limit(10).lean(),
      LedgerTransaction.find({ $or: [{ partyType: 'doctor', partyId: item.id }, { doctorId: item.id }] }).sort({ txnDate: -1 }).limit(10).lean(),
      PayoutRequest.find({ entityType: 'doctor', entityId: item.id }).sort({ createdAt: -1 }).limit(10).lean(),
      User.findOne({ $or: [{ doctorId: item.id }, { phone: item.phone }] }).lean()
    ]);
    Object.assign(related, { bookings, reviews, transactions, payouts, linkedUser,
      bookingCount: await Booking.countDocuments({ doctorId: item.id }) });
  } else if (cfg.kind === 'clinic') {
    const [doctors, transactions, payouts] = await Promise.all([
      Doctor.find({ $or: [{ id: { $in: item.doctorIds || [] } }, { 'clinics.clinicId': item.id }] }).select('id name status specialities').lean(),
      LedgerTransaction.find({ partyType: 'clinic', partyId: item.id }).sort({ txnDate: -1 }).limit(10).lean(),
      PayoutRequest.find({ entityType: 'clinic', entityId: item.id }).sort({ createdAt: -1 }).limit(10).lean()
    ]);
    Object.assign(related, { doctors, transactions, payouts });
  } else {
    const [bookings, reviews, transactions] = await Promise.all([
      Booking.find({ $or: [{ patientUserId: item.id }, { patientPhone: item.phone }] }).sort({ createdAt: -1 }).limit(10).lean(),
      Review.find({ userPhone: item.phone }).sort({ createdAt: -1 }).limit(10).lean(),
      LedgerTransaction.find({ partyType: 'patient', partyPhone: item.phone }).sort({ txnDate: -1 }).limit(10).lean()
    ]);
    Object.assign(related, { bookings, reviews, transactions,
      bookingCount: await Booking.countDocuments({ $or: [{ patientUserId: item.id }, { patientPhone: item.phone }] }) });
  }
  res.json({ item, related });
}));

async function loadForAction(req, res) {
  const cfg = entityConfig(req, res); if (!cfg) return {};
  const doc = await cfg.Model.findOne({ id: req.params.id, ...cfg.base });
  if (!doc) { res.status(404).json({ error: 'Not found' }); return {}; }
  return { cfg, doc };
}

function setStatus(doc, status, reason = '') {
  invalidateInactiveClinics(); // clinic visibility cache (cheap; doctors share the call)
  doc.status = status;
  doc.statusReason = reason;
  doc.statusUpdatedAt = new Date();
}

const STATUS_TEXT = {
  active: ['Your account is approved', 'Your profile is verified and now visible to patients.'],
  rejected: ['Verification rejected', 'Your profile verification was rejected'],
  suspended: ['Account suspended', 'Your account has been suspended'],
  pending: ['Account reinstated', 'Your account was reinstated and is pending verification.'],
  deleted: ['Account removed', 'Your account was removed by FindADoc administrators.']
};
async function notifyStatus(cfg, doc, reason = '') {
  const t = STATUS_TEXT[doc.status];
  if (!t) return;
  await notify({ type: cfg.kind, id: doc.id }, { type: 'account', title: t[0], body: reason ? `${t[1]}: ${reason}` : t[1] });
}

// Approve (pending/rejected -> active)
router.post('/:entity(doctors|clinics|patients)/:id/approve', wrap(async (req, res) => {
  const { cfg, doc } = await loadForAction(req, res); if (!doc) return;
  if (doc.status === 'deleted') return res.status(400).json({ error: 'Restore the account before approving it' });
  if (doc.status === 'suspended') return res.status(400).json({ error: 'Account is suspended — use Unsuspend instead' });
  setStatus(doc, 'active');
  doc.isVerified = true;
  doc.approvedAt = new Date();
  await doc.save();
  await notifyStatus(cfg, doc, doc.statusReason);
  res.json({ success: true, message: `${doc.name} approved and now active`, item: doc });
}));

router.post('/:entity(doctors|clinics|patients)/:id/reject', wrap(async (req, res) => {
  const { cfg, doc } = await loadForAction(req, res); if (!doc) return;
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A rejection reason is required' });
  if (doc.status === 'deleted') return res.status(400).json({ error: 'Account is deleted' });
  setStatus(doc, 'rejected', reason);
  doc.isVerified = false;
  await doc.save();
  await notifyStatus(cfg, doc, doc.statusReason);
  res.json({ success: true, message: `${doc.name} rejected`, item: doc });
}));

router.post('/:entity(doctors|clinics|patients)/:id/suspend', wrap(async (req, res) => {
  const { cfg, doc } = await loadForAction(req, res); if (!doc) return;
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'A suspension reason is required (shown to the user)' });
  if (doc.status === 'deleted') return res.status(400).json({ error: 'Account is deleted' });
  if (doc.status !== 'suspended') doc.statusBeforeSuspension = doc.status || 'active';
  setStatus(doc, 'suspended', reason.slice(0, 500));
  await doc.save();
  await notifyStatus(cfg, doc, doc.statusReason);
  res.json({ success: true, message: `${doc.name} suspended`, item: doc });
}));

router.post('/:entity(doctors|clinics|patients)/:id/unsuspend', wrap(async (req, res) => {
  const { cfg, doc } = await loadForAction(req, res); if (!doc) return;
  if (doc.status !== 'suspended') return res.status(400).json({ error: 'Account is not suspended' });
  const back = doc.statusBeforeSuspension && doc.statusBeforeSuspension !== 'suspended' ? doc.statusBeforeSuspension : (doc.isVerified ? 'active' : 'pending');
  setStatus(doc, back);
  doc.statusBeforeSuspension = '';
  await doc.save();
  await notifyStatus(cfg, doc, doc.statusReason);
  res.json({ success: true, message: `${doc.name} reinstated (${back})`, item: doc });
}));

// Soft delete: hidden everywhere, login blocked, ledger history kept
router.delete('/:entity(doctors|clinics|patients)/:id', wrap(async (req, res) => {
  const { cfg, doc } = await loadForAction(req, res); if (!doc) return;
  doc.statusBeforeSuspension = doc.status === 'deleted' ? doc.statusBeforeSuspension : (doc.status || '');
  setStatus(doc, 'deleted', String(req.body?.reason || '').trim());
  doc.deletedAt = new Date();
  if ('bookingEnabled' in doc) doc.bookingEnabled = false;
  await doc.save();
  await notifyStatus(cfg, doc, doc.statusReason);
  res.json({ success: true, message: `${doc.name} deleted (soft-delete; history retained)`, item: doc });
}));

router.post('/:entity(doctors|clinics|patients)/:id/restore', wrap(async (req, res) => {
  const { cfg, doc } = await loadForAction(req, res); if (!doc) return;
  if (doc.status !== 'deleted') return res.status(400).json({ error: 'Account is not deleted' });
  const back = ['active', 'pending', 'rejected'].includes(doc.statusBeforeSuspension) ? doc.statusBeforeSuspension : (doc.isVerified ? 'active' : 'pending');
  setStatus(doc, back);
  doc.deletedAt = null;
  doc.statusBeforeSuspension = '';
  if ('bookingEnabled' in doc) doc.bookingEnabled = true;
  await doc.save();
  await notifyStatus(cfg, doc, doc.statusReason);
  res.json({ success: true, message: `${doc.name} restored (${back})`, item: doc });
}));

// Doctor verification documents (private files, streamed to admins only)
router.get('/doctors/:id/documents/:docId/file', wrap(async (req, res) => {
  const d = await Doctor.findOne({ id: req.params.id }).lean();
  const doc = d?.documents?.find(x => x.id === req.params.docId);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!sendPrivateFile(res, doc)) return res.status(404).json({ error: 'File is missing from storage' });
}));

router.post('/doctors/:id/documents/:docId/:action(verify|reject)', wrap(async (req, res) => {
  const d = await Doctor.findOne({ id: req.params.id });
  const doc = d?.documents?.find(x => x.id === req.params.docId);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  doc.status = req.params.action === 'verify' ? 'verified' : 'rejected';
  d.markModified('documents');
  await d.save();
  await notify({ type: 'doctor', id: d.id }, { type: 'account', title: `Document ${doc.status}`, body: `${doc.label || doc.docType} was ${doc.status} by FindADoc.${req.body?.reason ? ` ${String(req.body.reason).slice(0, 200)}` : ''}` });
  res.json({ success: true, message: `Document marked ${doc.status}` });
}));

// Grant / change a plan manually (e.g. offline payment, complimentary upgrade)
router.post('/:entity(doctors|clinics)/:id/plan', wrap(async (req, res) => {
  const { cfg, doc } = await loadForAction(req, res); if (!doc) return;
  const code = String(req.body?.planCode || '');
  const plans = (await getPlans()).filter(p => p.audience === cfg.kind);
  const plan = plans.find(p => p.code === code);
  if (!plan) return res.status(400).json({ error: 'Unknown plan' });
  const days = Math.min(3650, Math.max(1, parseInt(req.body?.days, 10) || plan.durationDays || 30));
  doc.subscription = plan.code === 'basic'
    ? { planCode: 'basic', planName: plan.name, startedAt: new Date(), expiresAt: null, source: 'admin' }
    : { planCode: plan.code, planName: plan.name, startedAt: new Date(), expiresAt: new Date(Date.now() + days * 86400000), source: 'admin' };
  doc.isPremium = plan.tier > 0;
  await doc.save();
  await notify({ type: cfg.kind, id: doc.id }, { type: 'subscription', title: `${plan.name} plan activated`, body: plan.code === 'basic' ? 'Your account was moved to the Basic plan.' : `Granted by FindADoc for ${days} days.` });
  res.json({ success: true, message: `${doc.name} is now on ${plan.name}`, plan: planSummary(await effectivePlan(doc, cfg.kind)) });
}));

// Pending approvals (doctors + clinics), newest first
router.get('/approvals', wrap(async (req, res) => {
  const q = req.query;
  const paging = parsePaging(q);
  const type = q.type === 'clinics' ? 'clinics' : 'doctors';
  const cfg = ENTITY[type];
  const filter = { status: 'pending', ...searchFilter(q.search, cfg.search), ...dateRange(q) };
  const result = await paginate(cfg.Model, filter, paging, sortSpec(q.sort, ENTITY_SORTS));
  result.items = result.items.map(it => ({ ...it, documents: (it.documents || []).map(({ key, ...d }) => d) }));
  const [pendingDoctors, pendingClinics] = await Promise.all([
    Doctor.countDocuments({ status: 'pending' }), Clinic.countDocuments({ status: 'pending' })
  ]);
  res.json({ ...result, counts: { doctors: pendingDoctors, clinics: pendingClinics } });
}));

// -----------------------------------------------------------------------------
// Reviews moderation
// -----------------------------------------------------------------------------
function reviewTabFilter(tab) {
  const clean = { $or: [{ badWordsFound: { $exists: false } }, { badWordsFound: { $size: 0 } }] };
  switch (tab) {
    case 'good': return { moderationStatus: 'visible', rating: { $gte: 4 }, ...clean };
    case 'flagged': return { moderationStatus: 'flagged' };
    case 'other': return { moderationStatus: { $in: ['visible', 'approved'] }, $nor: [{ moderationStatus: 'visible', rating: { $gte: 4 }, ...clean }] };
    case 'deleted': return { moderationStatus: 'deleted' };
    default: return { moderationStatus: { $ne: 'deleted' } };
  }
}

const REVIEW_SORTS = {
  newest: { createdAt: -1 },
  oldest: { createdAt: 1 },
  rating_desc: { rating: -1, createdAt: -1 },
  rating_asc: { rating: 1, createdAt: -1 }
};

router.get('/reviews', wrap(async (req, res) => {
  const q = req.query;
  const filter = { ...reviewTabFilter(q.tab), ...dateRange(q) };
  if (q.rating) filter.rating = Number(q.rating);
  if (q.doctorId) filter.doctorId = q.doctorId;
  const and = [];
  if (q.search) and.push(searchFilter(q.search, ['comment', 'userName', 'userPhone', 'doctorId']));
  const finalFilter = and.length ? { $and: [filter, ...and] } : filter;
  const result = await paginate(Review, finalFilter, parsePaging(q), sortSpec(q.sort, REVIEW_SORTS));
  const doctorIds = [...new Set(result.items.map(r => r.doctorId))];
  const docs = await Doctor.find({ id: { $in: doctorIds } }).select('id name').lean();
  const names = Object.fromEntries(docs.map(d => [d.id, d.name]));
  result.items = result.items.map(r => ({ ...r, doctorName: names[r.doctorId] || r.doctorId }));
  const [good, flagged, other, all] = await Promise.all(['good', 'flagged', 'other', 'all'].map(t => Review.countDocuments(reviewTabFilter(t))));
  res.json({ ...result, counts: { good, flagged, other, all } });
}));

router.post('/reviews/:id/approve', wrap(async (req, res) => {
  const r = await Review.findOne({ id: req.params.id });
  if (!r) return res.status(404).json({ error: 'Review not found' });
  r.moderationStatus = 'approved';
  r.moderatedAt = new Date();
  r.moderationNote = String(req.body?.note || 'Approved by admin');
  await r.save();
  await recalcDoctorRating(r.doctorId);
  res.json({ success: true, message: 'Review approved and published', item: r });
}));

router.post('/reviews/:id/hide', wrap(async (req, res) => {
  const r = await Review.findOne({ id: req.params.id });
  if (!r) return res.status(404).json({ error: 'Review not found' });
  r.moderationStatus = 'flagged';
  r.isFlagged = true;
  r.flagReason = r.flagReason || String(req.body?.reason || 'Hidden by admin');
  r.moderatedAt = new Date();
  await r.save();
  await recalcDoctorRating(r.doctorId);
  res.json({ success: true, message: 'Review hidden from public', item: r });
}));

router.delete('/reviews/:id', wrap(async (req, res) => {
  const r = await Review.findOne({ id: req.params.id });
  if (!r) return res.status(404).json({ error: 'Review not found' });
  r.moderationStatus = 'deleted';
  r.deletedAt = new Date();
  r.moderatedAt = new Date();
  await r.save();
  await recalcDoctorRating(r.doctorId);
  res.json({ success: true, message: 'Review deleted' });
}));

// Re-scan all non-deleted, non-approved reviews against the current word list.
router.post('/reviews/rescan', wrap(async (req, res) => {
  const result = await rescanReviews();
  res.json({ success: true, ...result, message: `Re-scanned ${result.scanned} reviews: ${result.newlyFlagged} newly flagged, ${result.unflagged} restored` });
}));

// -----------------------------------------------------------------------------
// Ledger: subscriptions & patient fees
// -----------------------------------------------------------------------------
const TXN_SORTS = { newest: { txnDate: -1 }, oldest: { txnDate: 1 }, amount_desc: { totalAmount: -1 }, amount_asc: { totalAmount: 1 } };

function ledgerFilter(q) {
  const filter = { ...dateRange(q, 'txnDate') };
  const types = String(q.type || '').split(',').filter(t => ['subscription', 'patient_fee', 'refund'].includes(t));
  if (types.length) filter.type = types.length === 1 ? types[0] : { $in: types };
  if (q.documentType && ['invoice', 'credit_note', 'refund_voucher'].includes(q.documentType)) filter.documentType = q.documentType;
  if (q.refundStatus && ['partial', 'full'].includes(q.refundStatus)) filter.refundStatus = q.refundStatus;
  if (q.partyType && ['doctor', 'clinic', 'patient'].includes(q.partyType)) filter.partyType = q.partyType;
  if (q.status && q.status !== 'all') filter.status = q.status;
  Object.assign(filter, searchFilter(q.search, ['invoiceNumber', 'originalInvoiceNumber', 'partyName', 'partyPhone', 'partyId', 'partyGstin', 'bookingId', 'paymentReference']));
  return filter;
}

router.get('/ledger/transactions', wrap(async (req, res) => {
  const filter = ledgerFilter(req.query);
  const result = await paginate(LedgerTransaction, filter, parsePaging(req.query), sortSpec(req.query.sort, TXN_SORTS, { txnDate: -1 }));
  const [totals] = await LedgerTransaction.aggregate([
    { $match: { ...filter, status: filter.status || 'paid' } },
    { $group: { _id: null, taxableValue: { $sum: '$taxableValue' }, totalTax: { $sum: '$totalTax' }, totalAmount: { $sum: '$totalAmount' }, passThrough: { $sum: '$passThroughAmount' }, count: { $sum: 1 } } }
  ]);
  res.json({ ...result, totals: totals ? { ...totals, _id: undefined } : { taxableValue: 0, totalTax: 0, totalAmount: 0, passThrough: 0, count: 0 } });
}));

router.get('/ledger/transactions/:id', wrap(async (req, res) => {
  const t = await LedgerTransaction.findOne({ $or: [{ id: req.params.id }, { invoiceNumber: req.params.id }] }).lean();
  if (!t) return res.status(404).json({ error: 'Transaction not found' });
  res.json({ item: t });
}));

// -----------------------------------------------------------------------------
// Payout requests
// -----------------------------------------------------------------------------
const PAYOUT_SORTS = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, amount_desc: { amount: -1 } };

router.get('/payouts', wrap(async (req, res) => {
  const q = req.query;
  const filter = { ...dateRange(q), ...searchFilter(q.search, ['entityName', 'entityId', 'referenceCode', 'paymentReference', 'entityPhone']) };
  if (q.status && q.status !== 'all') filter.status = q.status;
  if (q.entityType && ['doctor', 'clinic'].includes(q.entityType)) filter.entityType = q.entityType;
  const result = await paginate(PayoutRequest, filter, parsePaging(q), sortSpec(q.sort, PAYOUT_SORTS));
  const agg = await PayoutRequest.aggregate([{ $group: { _id: '$status', amount: { $sum: '$amount' }, count: { $sum: 1 } } }]);
  res.json({ ...result, summary: Object.fromEntries(agg.map(a => [a._id, { amount: a.amount, count: a.count }])) });
}));

async function payoutEntity(p) {
  return p.entityType === 'doctor' ? Doctor.findOne({ id: p.entityId }) : Clinic.findOne({ id: p.entityId });
}

router.post('/payouts/:id/approve', wrap(async (req, res) => {
  const p = await PayoutRequest.findOne({ id: req.params.id });
  if (!p) return res.status(404).json({ error: 'Payout request not found' });
  if (p.status !== 'Pending') return res.status(400).json({ error: `Cannot approve a ${p.status} request` });
  p.status = 'Approved';
  p.approvedAt = new Date();
  p.adminNote = String(req.body?.note || p.adminNote || '');
  await p.save();
  res.json({ success: true, message: 'Payout approved — mark as paid once transferred', item: p });
}));

router.post('/payouts/:id/mark-paid', wrap(async (req, res) => {
  const p = await PayoutRequest.findOne({ id: req.params.id });
  if (!p) return res.status(404).json({ error: 'Payout request not found' });
  if (!['Pending', 'Approved'].includes(p.status)) return res.status(400).json({ error: `Cannot mark a ${p.status} request as paid` });
  const reference = String(req.body?.reference || '').trim();
  if (!reference) return res.status(400).json({ error: 'Payment reference / UTR number is required' });
  p.status = 'Paid';
  p.paymentReference = reference;
  p.paidAt = new Date();
  if (!p.approvedAt) p.approvedAt = p.paidAt;
  p.processedAt = p.paidAt.toISOString().split('T')[0];
  p.adminNote = String(req.body?.note || p.adminNote || '');
  await p.save();
  const ent = await payoutEntity(p);
  if (ent) {
    ent.payoutPendingFee = Math.max(0, round2((ent.payoutPendingFee || 0) - p.amount));
    ent.claimedFee = round2((ent.claimedFee || 0) + p.amount);
    await ent.save();
    if (p.entityType === 'doctor') {
      await Booking.updateMany({ doctorId: ent.id, claimStatus: 'Pending', createdAt: { $lte: p.requestedAt || p.createdAt } }, { claimStatus: 'Claimed' });
    }
  }
  res.json({ success: true, message: `Payout marked paid (ref ${reference})`, item: p });
}));

router.post('/payouts/:id/reject', wrap(async (req, res) => {
  const p = await PayoutRequest.findOne({ id: req.params.id });
  if (!p) return res.status(404).json({ error: 'Payout request not found' });
  if (!['Pending', 'Approved'].includes(p.status)) return res.status(400).json({ error: `Cannot reject a ${p.status} request` });
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'A rejection reason is required' });
  p.status = 'Rejected';
  p.rejectionReason = reason;
  p.rejectedAt = new Date();
  if (req.body?.reference) p.paymentReference = String(req.body.reference);
  await p.save();
  const ent = await payoutEntity(p);
  if (ent) { // return funds to available balance
    ent.payoutPendingFee = Math.max(0, round2((ent.payoutPendingFee || 0) - p.amount));
    ent.claimPendingFee = round2((ent.claimPendingFee || 0) + p.amount);
    await ent.save();
  }
  res.json({ success: true, message: 'Payout rejected; amount returned to available balance', item: p });
}));

// -----------------------------------------------------------------------------
// GST report & CSV export
// -----------------------------------------------------------------------------
function gstFilter(q) {
  const f = { status: 'paid', ...dateRange(q, 'txnDate') };
  if (q.type && ['subscription', 'patient_fee', 'refund'].includes(q.type)) f.type = q.type;
  return f;
}

router.get('/gst/report', wrap(async (req, res) => {
  const filter = gstFilter(req.query);
  const sum = {
    count: { $sum: 1 }, taxableValue: { $sum: '$taxableValue' }, cgst: { $sum: '$cgst' }, sgst: { $sum: '$sgst' },
    igst: { $sum: '$igst' }, totalTax: { $sum: '$totalTax' }, invoiceValue: { $sum: '$invoiceValue' }, totalAmount: { $sum: '$totalAmount' }
  };
  const [totals] = await LedgerTransaction.aggregate([{ $match: filter }, { $group: { _id: null, ...sum } }]);
  const byCategory = await LedgerTransaction.aggregate([{ $match: filter }, { $group: { _id: '$category', ...sum } }, { $sort: { _id: 1 } }]);
  const byRate = await LedgerTransaction.aggregate([{ $match: filter }, { $group: { _id: { rate: '$gstRate', supplyType: '$supplyType' }, ...sum } }, { $sort: { '_id.rate': 1 } }]);
  const bySac = await LedgerTransaction.aggregate([{ $match: filter }, { $group: { _id: { sac: '$sacCode', rate: '$gstRate' }, ...sum } }]);
  const byMonth = await LedgerTransaction.aggregate([
    { $match: filter },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$txnDate', timezone: '+05:30' } }, ...sum } },
    { $sort: { _id: 1 } }
  ]);
  const all = await LedgerTransaction.find(filter).select('partyGstin supplyType invoiceValue taxableValue totalTax').lean();
  const bySection = {};
  for (const t of all) {
    const s = gstr1Section(t);
    bySection[s] = bySection[s] || { count: 0, taxableValue: 0, totalTax: 0, invoiceValue: 0 };
    bySection[s].count++; bySection[s].taxableValue += t.taxableValue; bySection[s].totalTax += t.totalTax; bySection[s].invoiceValue += t.invoiceValue;
  }
  const r2 = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, typeof v === 'number' ? round2(v) : v]));
  const settings = await getSettings();
  res.json({
    filter: { from: req.query.from || null, to: req.query.to || null, month: req.query.month || null, type: req.query.type || 'all' },
    business: { name: settings.businessName, gstin: settings.businessGstin, stateCode: settings.businessStateCode, state: settings.businessState },
    totals: r2(totals ? { ...totals, _id: undefined } : { count: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, totalTax: 0, invoiceValue: 0, totalAmount: 0 }),
    byCategory: byCategory.map(r2),
    byRate: byRate.map(r => ({ ...r2(r), _id: undefined, rate: r._id.rate, supplyType: r._id.supplyType })),
    bySac: bySac.map(r => ({ ...r2(r), _id: undefined, sac: r._id.sac, rate: r._id.rate })),
    byMonth: byMonth.map(r2),
    bySection: Object.fromEntries(Object.entries(bySection).map(([k, v]) => [k, r2(v)]))
  });
}));

const fmtDate = d => {
  // GST portal format dd-mmm-yyyy, in IST
  const x = new Date(new Date(d).getTime() + 5.5 * 3600 * 1000);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getUTCMonth()];
  return `${String(x.getUTCDate()).padStart(2, '0')}-${mon}-${x.getUTCFullYear()}`;
};
const pos = t => t.placeOfSupply || '';
const n2 = v => round2(v || 0).toFixed(2);

router.get('/gst/export.csv', wrap(async (req, res) => {
  const section = String(req.query.section || 'register').toLowerCase();
  const filter = gstFilter(req.query);
  const txns = await LedgerTransaction.find(filter).sort({ txnDate: 1, invoiceSeq: 1 }).lean();
  let headers, rows;

  if (section === 'b2b') {
    headers = ['GSTIN/UIN of Recipient', 'Receiver Name', 'Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Reverse Charge', 'Applicable % of Tax Rate', 'Invoice Type', 'E-Commerce GSTIN', 'Rate', 'Taxable Value', 'Cess Amount'];
    rows = txns.filter(t => gstr1Section(t) === 'B2B').map(t => [t.partyGstin, t.partyName, t.invoiceNumber, fmtDate(t.txnDate), n2(t.invoiceValue), pos(t), 'N', '', 'Regular B2B', '', t.gstRate, n2(t.taxableValue), '0.00']);
  } else if (section === 'b2cl') {
    headers = ['Invoice Number', 'Invoice date', 'Invoice Value', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'];
    rows = txns.filter(t => gstr1Section(t) === 'B2CL').map(t => [t.invoiceNumber, fmtDate(t.txnDate), n2(t.invoiceValue), pos(t), '', t.gstRate, n2(t.taxableValue), '0.00', '']);
  } else if (section === 'b2cs') {
    headers = ['Type', 'Place Of Supply', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount', 'E-Commerce GSTIN'];
    const groups = {};
    for (const t of txns.filter(x => gstr1Section(x) === 'B2CS')) {
      const k = `${pos(t)}|${t.gstRate}`;
      groups[k] = groups[k] || { pos: pos(t), rate: t.gstRate, taxable: 0 };
      groups[k].taxable += t.taxableValue;
    }
    rows = Object.values(groups).map(g => ['OE', g.pos, '', g.rate, n2(g.taxable), '0.00', '']);
  } else if (section === 'cdnr' || section === 'credit_notes') {
    headers = ['GSTIN/UIN of Recipient', 'Receiver Name', 'Note Number', 'Note Date', 'Note Type', 'Original Invoice Number', 'Place Of Supply', 'Reverse Charge', 'Note Supply Type', 'Note Value', 'Applicable % of Tax Rate', 'Rate', 'Taxable Value', 'Cess Amount'];
    rows = txns.filter(t => t.documentType === 'credit_note' && (section === 'credit_notes' || t.partyGstin)).map(t => [t.partyGstin, t.partyName, t.invoiceNumber, fmtDate(t.txnDate), 'C', t.originalInvoiceNumber, pos(t), 'N', 'Regular B2B', n2(Math.abs(t.invoiceValue)), '', t.gstRate, n2(Math.abs(t.taxableValue)), '0.00']);
  } else if (section === 'hsn') {
    headers = ['HSN', 'Description', 'UQC', 'Total Quantity', 'Total Value', 'Rate', 'Taxable Value', 'Integrated Tax Amount', 'Central Tax Amount', 'State/UT Tax Amount', 'Cess Amount'];
    const groups = {};
    for (const t of txns) {
      const k = `${t.sacCode}|${t.gstRate}`;
      groups[k] = groups[k] || { sac: t.sacCode, rate: t.gstRate, qty: 0, value: 0, taxable: 0, igst: 0, cgst: 0, sgst: 0 };
      const g = groups[k];
      g.qty++; g.value += t.invoiceValue; g.taxable += t.taxableValue; g.igst += t.igst; g.cgst += t.cgst; g.sgst += t.sgst;
    }
    rows = Object.values(groups).map(g => [g.sac, 'Online platform / subscription services', 'NA', g.qty, n2(g.value), g.rate, n2(g.taxable), n2(g.igst), n2(g.cgst), n2(g.sgst), '0.00']);
  } else {
    headers = ['Document Number', 'Document Type', 'Original Invoice', 'Invoice Date', 'GSTR-1 Section', 'Category', 'Party Type', 'Party Name', 'Party Phone', 'GSTIN/UIN of Recipient', 'Place Of Supply', 'Supply Type', 'Reverse Charge', 'SAC', 'Rate', 'Taxable Value', 'CGST Rate', 'CGST Amount', 'SGST Rate', 'SGST Amount', 'IGST Rate', 'IGST Amount', 'Cess Amount', 'Total Tax', 'Invoice Value', 'Pass-through (non-taxable)', 'Total Collected', 'Payment Reference'];
    rows = txns.map(t => [t.invoiceNumber, t.documentType || 'invoice', t.originalInvoiceNumber || '', fmtDate(t.txnDate), gstr1Section(t), t.category, t.partyType, t.partyName, t.partyPhone, t.partyGstin, pos(t), t.supplyType === 'intra' ? 'Intra-State' : 'Inter-State', 'N', t.sacCode, t.gstRate, n2(t.taxableValue), t.cgstRate, n2(t.cgst), t.sgstRate, n2(t.sgst), t.igstRate, n2(t.igst), '0.00', n2(t.totalTax), n2(t.invoiceValue), n2(t.passThroughAmount), n2(t.totalAmount), t.paymentReference]);
  }

  const label = req.query.month || [req.query.from, req.query.to].filter(Boolean).join('_to_') || 'all';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="gst-${section}-${label}.csv"`);
  res.send('\uFEFF' + toCsv(headers, rows));
}));

// -----------------------------------------------------------------------------
// Dashboard
// -----------------------------------------------------------------------------
router.get('/dashboard', wrap(async (req, res) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const notDeleted = { status: { $ne: 'deleted' } };

  const [
    patients, doctors, clinics, pendingDoctors, pendingClinics,
    suspendedDoctors, suspendedClinics, suspendedPatients, flaggedReviews,
    revenueByType, pendingPayouts, gstMonth, monthlySeries, signupsDoctors, signupsClinics, signupsPatients,
    recentDoctors, recentClinics, recentPatients, recentReviews, recentTxns, recentPayouts, bookingsThisMonth, pendingSpecialities
  ] = await Promise.all([
    User.countDocuments({ role: 'patient', ...notDeleted }),
    Doctor.countDocuments(notDeleted),
    Clinic.countDocuments(notDeleted),
    Doctor.countDocuments({ status: 'pending' }),
    Clinic.countDocuments({ status: 'pending' }),
    Doctor.countDocuments({ status: 'suspended' }),
    Clinic.countDocuments({ status: 'suspended' }),
    User.countDocuments({ role: 'patient', status: 'suspended' }),
    Review.countDocuments({ moderationStatus: 'flagged' }),
    LedgerTransaction.aggregate([{ $match: { status: 'paid', txnDate: { $gte: monthStart } } }, { $group: { _id: '$category', invoiceValue: { $sum: '$invoiceValue' }, totalAmount: { $sum: '$totalAmount' }, taxableValue: { $sum: '$taxableValue' }, count: { $sum: 1 } } }]),
    PayoutRequest.aggregate([{ $match: { status: { $in: ['Pending', 'Approved'] } } }, { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    LedgerTransaction.aggregate([{ $match: { status: 'paid', txnDate: { $gte: monthStart } } }, { $group: { _id: null, cgst: { $sum: '$cgst' }, sgst: { $sum: '$sgst' }, igst: { $sum: '$igst' }, totalTax: { $sum: '$totalTax' } } }]),
    LedgerTransaction.aggregate([
      { $match: { status: 'paid', txnDate: { $gte: sixMonthsAgo } } },
      { $group: { _id: { m: { $dateToString: { format: '%Y-%m', date: '$txnDate', timezone: '+05:30' } }, type: '$type' }, value: { $sum: '$invoiceValue' } } }
    ]),
    Doctor.aggregate([{ $match: { createdAt: { $gte: sixMonthsAgo } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: '+05:30' } }, n: { $sum: 1 } } }]),
    Clinic.aggregate([{ $match: { createdAt: { $gte: sixMonthsAgo } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: '+05:30' } }, n: { $sum: 1 } } }]),
    User.aggregate([{ $match: { role: 'patient', createdAt: { $gte: sixMonthsAgo } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: '+05:30' } }, n: { $sum: 1 } } }]),
    Doctor.find().sort({ createdAt: -1 }).limit(5).select('id name status createdAt').lean(),
    Clinic.find().sort({ createdAt: -1 }).limit(5).select('id name status createdAt').lean(),
    User.find({ role: 'patient' }).sort({ createdAt: -1 }).limit(5).select('id name status createdAt').lean(),
    Review.find().sort({ createdAt: -1 }).limit(5).select('id userName rating moderationStatus createdAt doctorId').lean(),
    LedgerTransaction.find().sort({ txnDate: -1 }).limit(5).select('id invoiceNumber partyName category totalAmount txnDate').lean(),
    PayoutRequest.find().sort({ updatedAt: -1 }).limit(5).select('id entityName entityType amount status updatedAt createdAt').lean(),
    Booking.countDocuments({ createdAt: { $gte: monthStart }, status: { $nin: ['Expired', 'AwaitingPayment'] } }),
    SpecialityRequest.countDocuments({ status: 'pending' })
  ]);
  const todayStr = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const [bookingStatus, bookingsToday, refundsMonth, activeSubs] = await Promise.all([
    Booking.aggregate([{ $match: { createdAt: { $gte: monthStart } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Booking.countDocuments({ date: todayStr, status: { $in: ['Pending', 'Confirmed', 'Completed', 'NoShow'] } }),
    LedgerTransaction.aggregate([{ $match: { type: 'refund', txnDate: { $gte: monthStart } } }, { $group: { _id: null, amount: { $sum: '$totalAmount' }, count: { $sum: 1 } } }]),
    Promise.all([Doctor, Clinic].map(M => M.aggregate([
      { $match: { status: { $ne: 'deleted' }, 'subscription.planCode': { $in: ['pro', 'premium'] }, $or: [{ 'subscription.expiresAt': null }, { 'subscription.expiresAt': { $gt: now } }] } },
      { $group: { _id: '$subscription.planCode', n: { $sum: 1 } } }
    ])))
  ]);

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const revenueSeries = months.map(m => ({
    month: m,
    subscription: round2(monthlySeries.find(x => x._id.m === m && x._id.type === 'subscription')?.value || 0),
    patient_fee: round2((monthlySeries.find(x => x._id.m === m && x._id.type === 'patient_fee')?.value || 0) + (monthlySeries.find(x => x._id.m === m && x._id.type === 'refund')?.value || 0))
  }));
  const pick = (arr, m) => arr.find(x => x._id === m)?.n || 0;
  const signupSeries = months.map(m => ({ month: m, doctors: pick(signupsDoctors, m), clinics: pick(signupsClinics, m), patients: pick(signupsPatients, m) }));
  const rev = Object.fromEntries(revenueByType.map(r => [r._id, { invoiceValue: round2(r.invoiceValue), taxableValue: round2(r.taxableValue), totalAmount: round2(r.totalAmount), count: r.count }]));

  const activity = [
    ...recentDoctors.map(d => ({ kind: 'doctor', id: d.id, text: `Doctor ${d.name} registered`, status: d.status, at: d.createdAt })),
    ...recentClinics.map(d => ({ kind: 'clinic', id: d.id, text: `Clinic ${d.name} registered`, status: d.status, at: d.createdAt })),
    ...recentPatients.map(d => ({ kind: 'patient', id: d.id, text: `Patient ${d.name} signed up`, status: d.status, at: d.createdAt })),
    ...recentReviews.map(r => ({ kind: 'review', id: r.id, text: `${r.userName} left a ${r.rating}★ review`, status: r.moderationStatus, at: r.createdAt })),
    ...recentTxns.map(t => ({ kind: 'transaction', id: t.id, text: `${t.invoiceNumber} • ${t.partyName} paid ₹${t.totalAmount} (${t.category.replace('_', ' ')})`, at: t.txnDate })),
    ...recentPayouts.map(p => ({ kind: 'payout', id: p.id, text: `Payout ₹${p.amount} for ${p.entityName} — ${p.status}`, status: p.status, at: p.updatedAt || p.createdAt }))
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 15);

  const g = gstMonth[0] || { cgst: 0, sgst: 0, igst: 0, totalTax: 0 };
  res.json({
    kpis: {
      patients, doctors, clinics,
      pendingApprovals: pendingDoctors + pendingClinics, pendingDoctors, pendingClinics,
      suspended: suspendedDoctors + suspendedClinics + suspendedPatients, suspendedDoctors, suspendedClinics, suspendedPatients,
      flaggedReviews,
      revenueThisMonth: {
        doctor_subscription: rev.doctor_subscription || { invoiceValue: 0, totalAmount: 0, count: 0 },
        clinic_subscription: rev.clinic_subscription || { invoiceValue: 0, totalAmount: 0, count: 0 },
        booking_fee: rev.booking_fee || { invoiceValue: 0, totalAmount: 0, count: 0 },
        total: round2(Object.values(rev).reduce((s, r) => s + r.invoiceValue, 0))
      },
      pendingPayouts: { amount: round2(pendingPayouts[0]?.amount || 0), count: pendingPayouts[0]?.count || 0 },
      gstThisMonth: { cgst: round2(g.cgst), sgst: round2(g.sgst), igst: round2(g.igst), total: round2(g.totalTax) },
      bookingsThisMonth, pendingSpecialities, bookingsToday,
      bookingStatusThisMonth: Object.fromEntries(bookingStatus.map(x => [x._id, x.n])),
      refundsThisMonth: { amount: round2(Math.abs(refundsMonth[0]?.amount || 0)), count: refundsMonth[0]?.count || 0 },
      activeSubscriptions: {
        doctor: Object.fromEntries(activeSubs[0].map(x => [x._id, x.n])),
        clinic: Object.fromEntries(activeSubs[1].map(x => [x._id, x.n]))
      }
    },
    revenueSeries, signupSeries, activity
  });
}));

// -----------------------------------------------------------------------------
// Settings (GST config + bad-word list)
// -----------------------------------------------------------------------------
router.get('/settings', wrap(async (req, res) => {
  const s = await getSettings({ fresh: true });
  res.json({
    settings: s,
    states: STATE_CODES,
    defaultBadWords: DEFAULT_BAD_WORDS,
    effectiveBadWordCount: getEffectiveWordList(s).length
  });
}));

router.put('/settings', wrap(async (req, res) => {
  const b = req.body || {};
  const update = {};
  if (b.businessName !== undefined) update.businessName = String(b.businessName).trim().slice(0, 120);
  if (b.businessGstin !== undefined) {
    const g = String(b.businessGstin).trim().toUpperCase();
    if (g && !isValidGstin(g)) return res.status(400).json({ error: 'Business GSTIN format is invalid' });
    update.businessGstin = g;
    if (g && !b.businessStateCode) update.businessStateCode = g.slice(0, 2);
  }
  if (b.businessStateCode !== undefined) {
    const c = String(b.businessStateCode).padStart(2, '0');
    if (!STATE_CODES[c]) return res.status(400).json({ error: 'Unknown GST state code' });
    update.businessStateCode = c;
  }
  if (update.businessStateCode) update.businessState = STATE_CODES[update.businessStateCode];
  if (update.businessGstin && update.businessStateCode && update.businessGstin.slice(0, 2) !== update.businessStateCode) {
    return res.status(400).json({ error: 'GSTIN state code does not match the selected business state' });
  }
  if (b.gstRate !== undefined) {
    const r = Number(b.gstRate);
    if (!(r >= 0 && r <= 28)) return res.status(400).json({ error: 'GST rate must be between 0 and 28' });
    update.gstRate = r;
  }
  for (const k of ['sacCode', 'subscriptionSacCode', 'bookingFeeSacCode']) {
    if (b[k] !== undefined) {
      const v = String(b[k]).trim();
      if (v && !/^\d{4,8}$/.test(v)) return res.status(400).json({ error: `${k} must be a 4–8 digit SAC/HSN code` });
      update[k] = v;
    }
  }
  if (b.invoicePrefix !== undefined) update.invoicePrefix = String(b.invoicePrefix).replace(/[^A-Za-z0-9-]/g, '').slice(0, 4) || 'FAD';
  if (b.pricesInclusiveOfGst !== undefined) update.pricesInclusiveOfGst = Boolean(b.pricesInclusiveOfGst);
  if (b.bookingPlatformFee !== undefined) {
    const f = Number(b.bookingPlatformFee);
    if (!(f >= 0 && f <= 10000)) return res.status(400).json({ error: 'Invalid platform fee' });
    update.bookingPlatformFee = f;
  }
  const numField = (k, min, max, label) => {
    if (b[k] === undefined) return null;
    const v = Number(b[k]);
    if (!(v >= min && v <= max)) return `${label} must be between ${min} and ${max}`;
    update[k] = v;
    return null;
  };
  const numErr = numField('freeBookingPlatformFee', 0, 10000, 'Free-booking platform fee') || numField('cancellationWindowHours', 0, 168, 'Cancellation window (hours)') || numField('paymentHoldMinutes', 5, 60, 'Payment hold (minutes)');
  if (numErr) return res.status(400).json({ error: numErr });
  const cleanList = l => [...new Set((Array.isArray(l) ? l : String(l || '').split(/[\n,]/)).map(w => String(w).toLowerCase().trim()).filter(w => w && w.length <= 60))].slice(0, 2000);
  if (b.extraBadWords !== undefined) update.extraBadWords = cleanList(b.extraBadWords);
  if (b.disabledBadWords !== undefined) update.disabledBadWords = cleanList(b.disabledBadWords);

  await Settings.updateOne({ key: 'global' }, { $set: update }, { upsert: true });
  invalidateSettings();
  let rescan = null;
  if (b.extraBadWords !== undefined || b.disabledBadWords !== undefined) rescan = await rescanReviews();
  const s = await getSettings({ fresh: true });
  res.json({ success: true, message: 'Settings saved', settings: s, rescan, effectiveBadWordCount: getEffectiveWordList(s).length });
}));

// Test a piece of text against the current word list
router.post('/moderation/test', wrap(async (req, res) => {
  const s = await getSettings();
  res.json(screenReviewText(String(req.body?.text || ''), s));
}));

// -----------------------------------------------------------------------------
// Bookings (all), with filters + pagination
// -----------------------------------------------------------------------------
const BOOKING_SORTS = { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, slot_asc: { date: 1, timeSlot: 1 }, slot_desc: { date: -1, timeSlot: -1 }, amount_desc: { amountPaidOnline: -1 } };
const BOOKING_STATUSES_ALL = ['AwaitingPayment', 'Pending', 'Confirmed', 'Completed', 'Cancelled', 'NoShow', 'Expired'];

function bookingFilter(q) {
  const and = [];
  if (q.scope && q.scope !== 'all') and.push(bookingScopeFilter(q.scope));
  const statuses = String(q.status || '').split(',').filter(x => BOOKING_STATUSES_ALL.includes(x));
  if (statuses.length) and.push({ status: { $in: statuses } });
  const modes = String(q.mode || '').split(',').filter(x => ['free', 'paid', 'token', 'offline', 'legacy'].includes(x));
  if (modes.length) and.push({ bookingMode: { $in: modes } });
  if (q.locationKind) and.push({ locationKind: String(q.locationKind) });
  if (q.doctorId) and.push({ doctorId: String(q.doctorId) });
  if (q.clinicId) and.push({ clinicId: String(q.clinicId) });
  if (q.patientId) and.push({ patientUserId: String(q.patientId) });
  if (q.refundStatus && ['processed', 'failed', 'not_eligible'].includes(q.refundStatus)) and.push({ refundStatus: q.refundStatus });
  if (q.paymentStatus) and.push({ paymentStatus: String(q.paymentStatus) });
  if (q.slotFrom || q.slotTo) and.push({ date: { ...(q.slotFrom ? { $gte: String(q.slotFrom) } : {}), ...(q.slotTo ? { $lte: String(q.slotTo) } : {}) } });
  const dr = dateRange(q, 'createdAt');
  if (Object.keys(dr).length) and.push(dr);
  const s = searchFilter(q.search, ['bookingCode', 'patientName', 'patientPhone', 'doctorName', 'clinicName', 'locationName', 'invoiceNumber', 'id']);
  if (s.$or) and.push(s);
  return and.length ? { $and: and } : {};
}

router.get('/bookings', wrap(async (req, res) => {
  const filter = bookingFilter(req.query);
  const result = await paginate(Booking, filter, parsePaging(req.query), sortSpec(req.query.sort, BOOKING_SORTS));
  result.items = result.items.map(bookingView);
  const [byStatus, money] = await Promise.all([
    Booking.aggregate([{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Booking.aggregate([{ $match: filter }, { $group: { _id: null, online: { $sum: '$amountPaidOnline' }, refunds: { $sum: '$refundAmount' }, dueAtClinic: { $sum: '$amountDueAtClinic' } } }])
  ]);
  res.json({ ...result, counts: Object.fromEntries(byStatus.map(x => [x._id, x.n])), totals: { online: round2(money[0]?.online || 0), refunds: round2(money[0]?.refunds || 0), dueAtClinic: round2(money[0]?.dueAtClinic || 0) } });
}));

router.get('/bookings/:id', wrap(async (req, res) => {
  const b = await Booking.findOne({ $or: [{ id: req.params.id }, { bookingCode: req.params.id }] }).lean();
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  const [ledger, order] = await Promise.all([
    LedgerTransaction.find({ bookingId: b.id }).sort({ txnDate: 1 }).lean(),
    b.paymentOrderId ? PaymentOrder.findOne({ id: b.paymentOrderId }).select('-_id -__v').lean() : null
  ]);
  res.json({ item: bookingView(b), ledger, paymentOrder: orderSummary(order) });
}));

router.post('/bookings/:id/cancel', wrap(async (req, res) => {
  const b = await Booking.findOne({ id: req.params.id });
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'A cancellation reason is required (sent to the patient and doctor)' });
  const out = await cancelBooking(b, { by: 'admin', reason });
  res.json({ success: true, message: `Booking cancelled${out.refund.amount ? ` — ₹${out.refund.amount} refunded (${out.refund.reference || out.refund.status})` : ''}`, item: bookingView(out.booking), refund: out.refund });
}));

// -----------------------------------------------------------------------------
// Subscription plans + subscription payments
// -----------------------------------------------------------------------------
router.get('/plans', wrap(async (req, res) => {
  const plans = (await getPlans()).map(({ _id, __v, ...p }) => p);
  const counts = {};
  for (const [M, audience] of [[Doctor, 'doctor'], [Clinic, 'clinic']]) {
    const rows = await M.aggregate([
      { $match: { status: { $ne: 'deleted' } } },
      { $project: { code: { $cond: [{ $and: [{ $in: ['$subscription.planCode', ['pro', 'premium']] }, { $or: [{ $eq: ['$subscription.expiresAt', null] }, { $gt: ['$subscription.expiresAt', new Date()] }] }] }, '$subscription.planCode', 'basic'] } } },
      { $group: { _id: '$code', n: { $sum: 1 } } }
    ]);
    counts[audience] = Object.fromEntries(rows.map(r => [r._id, r.n]));
  }
  res.json({ items: plans, counts });
}));

const LIMIT_KEYS = ['maxLocations', 'maxSpecialities', 'maxDoctors', 'maxGalleryImages', 'listingPriority'];
const FLAG_KEYS = ['onlinePayments', 'analytics', 'verifiedBadge', 'featuredInAi'];

router.put('/plans/:id', wrap(async (req, res) => {
  const plan = await SubscriptionPlan.findOne({ id: req.params.id });
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  const b = req.body || {};
  if (b.name !== undefined) { const n = String(b.name).trim().slice(0, 60); if (n.length < 2) return res.status(400).json({ error: 'Plan name is required' }); plan.name = n; }
  if (b.description !== undefined) plan.description = String(b.description).trim().slice(0, 300);
  if (b.price !== undefined) {
    const p = Number(b.price);
    if (!(p >= 0 && p <= 1000000)) return res.status(400).json({ error: 'Price must be between ₹0 and ₹10,00,000' });
    if (plan.code === 'basic' && p !== 0) return res.status(400).json({ error: 'The Basic plan must stay free' });
    plan.price = round2(p);
  }
  if (b.durationDays !== undefined) {
    const d = parseInt(b.durationDays, 10);
    if (!(d >= 1 && d <= 3650)) return res.status(400).json({ error: 'Duration must be 1–3650 days' });
    plan.durationDays = d;
  }
  if (b.features !== undefined) plan.features = (Array.isArray(b.features) ? b.features : String(b.features).split('\n')).map(f => String(f).trim()).filter(Boolean).slice(0, 15).map(f => f.slice(0, 120));
  if (b.isActive !== undefined) {
    if (plan.code === 'basic' && !b.isActive) return res.status(400).json({ error: 'The Basic plan cannot be disabled' });
    plan.isActive = Boolean(b.isActive);
  }
  if (b.highlight !== undefined) plan.highlight = Boolean(b.highlight);
  if (b.limits && typeof b.limits === 'object') {
    for (const k of LIMIT_KEYS) {
      if (b.limits[k] === undefined) continue;
      const v = parseInt(b.limits[k], 10);
      if (!(v === -1 || (v >= 0 && v <= 1000))) return res.status(400).json({ error: `${k}: use -1 for unlimited or 0–1000` });
      plan.limits[k] = v;
    }
    for (const k of FLAG_KEYS) if (b.limits[k] !== undefined) plan.limits[k] = Boolean(b.limits[k]);
    plan.markModified('limits');
  }
  await plan.save();
  invalidatePlans();
  res.json({ success: true, message: `${plan.name} saved`, item: plan });
}));

router.get('/subscriptions', wrap(async (req, res) => {
  const q = req.query;
  const filter = { purpose: 'subscription', ...dateRange(q) };
  if (q.status && q.status !== 'all') filter.status = String(q.status);
  else filter.status = { $ne: 'created' };
  if (q.partyType && ['doctor', 'clinic'].includes(q.partyType)) filter.partyType = q.partyType;
  if (q.planCode) filter['meta.planCode'] = String(q.planCode);
  Object.assign(filter, searchFilter(q.search, ['id', 'partyId', 'meta.partyName', 'ledgerInvoiceNumber', 'providerPaymentId']));
  const result = await paginate(PaymentOrder, filter, parsePaging(q), sortSpec(q.sort, { newest: { createdAt: -1 }, oldest: { createdAt: 1 }, amount_desc: { amount: -1 } }));
  const [sum] = await PaymentOrder.aggregate([{ $match: { ...filter, status: 'paid' } }, { $group: { _id: null, amount: { $sum: '$amount' }, count: { $sum: 1 } } }]);
  res.json({ ...result, totals: { amount: round2(sum?.amount || 0), count: sum?.count || 0 } });
}));

router.get('/me', (req, res) => res.json({ admin: { username: req.admin.username, role: req.admin.role } }));

// -----------------------------------------------------------------------------
// Refunds (Razorpay Refunds API) — full or partial, with GST credit note / refund voucher
// -----------------------------------------------------------------------------
const refundSchema = z.object({
  amount: z.coerce.number().positive('Refund amount must be greater than zero').max(10000000).optional(),
  reason: z.string().trim().min(3, 'A refund reason is required').max(300)
});
const refundLimit = rateLimit({ name: 'admin-refund', windowMs: 60 * 60 * 1000, max: 60 });

function orderSummary(o) {
  if (!o) return null;
  return { id: o.id, purpose: o.purpose, refId: o.refId, amount: o.amount, status: o.status, provider: o.provider, providerOrderId: o.providerOrderId, providerPaymentId: o.providerPaymentId, refundedAmount: o.refundedAmount || 0, refundable: refundableAmount(o), refunds: o.refunds || [], paidAt: o.paidAt, ledgerInvoiceNumber: o.ledgerInvoiceNumber };
}

async function doRefund(req, res, order) {
  if (!order) return res.status(404).json({ error: 'No online payment found for this record' });
  const out = await refundPaymentOrder(order, { amount: req.body.amount, reason: req.body.reason, by: `admin:${req.admin.username}` });
  res.json({ success: true, message: `₹${out.refund.amount} refund ${out.refund.status === 'processed' ? 'processed' : 'initiated'} — ${out.txn.documentType === 'credit_note' ? 'credit note' : 'refund voucher'} ${out.txn.invoiceNumber}`, refund: out.refund, creditNote: { id: out.txn.id, invoiceNumber: out.txn.invoiceNumber, documentType: out.txn.documentType }, paymentOrder: orderSummary(out.order) });
}

router.get('/payments/:orderId', wrap(async (req, res) => {
  const o = await PaymentOrder.findOne({ id: req.params.orderId });
  if (!o) return res.status(404).json({ error: 'Payment order not found' });
  res.json({ item: orderSummary(o) });
}));
router.post('/payments/:orderId/refund', refundLimit, validate({ body: refundSchema }), wrap(async (req, res) => doRefund(req, res, await PaymentOrder.findOne({ id: req.params.orderId }))));
router.post('/bookings/:id/refund', refundLimit, validate({ body: refundSchema }), wrap(async (req, res) => {
  const b = await Booking.findOne({ id: req.params.id }).lean();
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  return doRefund(req, res, b.paymentOrderId ? await PaymentOrder.findOne({ id: b.paymentOrderId }) : null);
}));
router.post('/ledger/transactions/:id/refund', refundLimit, validate({ body: refundSchema }), wrap(async (req, res) => {
  const t = await LedgerTransaction.findOne({ id: req.params.id }).lean();
  if (!t) return res.status(404).json({ error: 'Transaction not found' });
  if (t.documentType !== 'invoice') return res.status(400).json({ error: 'Refunds are issued against the original invoice' });
  return doRefund(req, res, t.paymentOrderId ? await PaymentOrder.findOne({ id: t.paymentOrderId }) : null);
}));

// -----------------------------------------------------------------------------
// Audit log
// -----------------------------------------------------------------------------
router.get('/audit-log', wrap(async (req, res) => {
  const q = req.query;
  const filter = { ...dateRange(q, 'at') };
  if (q.actor) filter.actor = String(q.actor).slice(0, 120);
  if (q.type === 'auth') filter.action = { $regex: '^auth\\.' };
  else if (q.type === 'changes') filter.action = { $not: /^auth\./ };
  if (q.search) {
    const rx = new RegExp(escapeRegex(String(q.search).slice(0, 80)), 'i');
    filter.$or = [{ action: rx }, { path: rx }, { target: rx }, { ip: rx }];
  }
  const result = await paginate(AdminAuditLog, filter, parsePaging(q), { at: -1 });
  res.json(result);
}));

export default router;
