// Admin phase-4 routes (mounted at /api/admin before the main admin router; admin session required):
// doctor registration verification (badge), labs + test catalogue, lab orders (status, report upload),
// lab partner API keys, DPDP deletion requests overview.
import express from 'express';
import crypto from 'crypto';
import { Doctor, Lab, LabTest, LabOrder, HealthRecord, User } from '../models/index.js';
import { requireAdminAuth } from '../lib/adminAuth.js';
import { validate, z, zId, zDate } from '../lib/validate.js';
import { parsePaging, paginate, searchFilter } from '../lib/http.js';
import { notify } from '../lib/notify.js';
import { cancelLabOrder, updateLabOrderStatus, attachLabReport, labOrderView, hashPartnerKey } from '../lib/labs.js';
import { singleFile, storePrivateUpload } from '../lib/uploadPipeline.js';
import { sendPrivateFile } from '../lib/storage/index.js';
import { isValidGstin, stateCodeFromGstin } from '../lib/gst.js';
import { newPartnerKey } from './labs.js';
import { httpError } from '../lib/bookings.js';
import { wrap } from './common.js';

const router = express.Router();
router.use(requireAdminAuth);
export default router;
const rid = p => `${p}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
const idParams = z.object({ id: zId });

// ---------------------------------------------------------------- registration verification
router.post('/doctors/:id/registration', validate({ params: idParams, body: z.object({ verified: z.boolean(), note: z.string().max(300).optional() }) }), wrap(async (req, res) => {
  const d = await Doctor.findOne({ id: req.params.id });
  if (!d) throw httpError(404, 'Doctor not found');
  if (req.body.verified && (!d.registrationNumber || !d.councilName)) throw httpError(400, 'The doctor has not entered a council name and registration number yet');
  d.registrationVerified = req.body.verified;
  d.registrationVerifiedAt = req.body.verified ? new Date() : null;
  await d.save();
  await notify({ type: 'doctor', id: d.id }, { type: 'account_status', title: req.body.verified ? 'Registration verified' : 'Registration verification removed', body: req.body.verified ? `Your ${d.councilName} registration ${d.registrationNumber} is verified. Patients now see the verified badge.` : (req.body.note || 'Please check your registration details.') });
  res.json({ success: true, registrationVerified: d.registrationVerified, registrationVerifiedAt: d.registrationVerifiedAt });
}));

// ---------------------------------------------------------------- labs
const labSchema = z.object({
  name: z.string().trim().min(2).max(120), type: z.enum(['lab', 'partner']).default('lab'), address: z.string().max(300).default(''), city: z.string().max(80).default(''),
  pincodes: z.array(z.string().regex(/^\d{6}$/)).max(500).default([]), phone: z.string().max(20).default(''), email: z.string().max(120).default(''),
  gstin: z.string().max(15).default(''), accreditation: z.string().max(60).default(''), homeCollection: z.boolean().default(true),
  collectionWindows: z.array(z.string().regex(/^\d{2}:\d{2}-\d{2}:\d{2}$/)).max(12).optional(), commissionPercent: z.number().min(0).max(50).nullable().optional(), isActive: z.boolean().default(true)
});
const labAdminView = l => { const o = { ...l }; delete o._id; delete o.__v; o.hasPartnerKey = Boolean(l.partnerKeyHash); delete o.partnerKeyHash; return o; };

router.get('/labs', wrap(async (req, res) => {
  const labs = await Lab.find().sort({ createdAt: -1 }).lean();
  const counts = await LabTest.aggregate([{ $group: { _id: '$labId', n: { $sum: 1 } } }]);
  res.json({ items: labs.map(l => ({ ...labAdminView(l), testCount: counts.find(c => c._id === l.id)?.n || 0 })) });
}));
router.post('/labs', validate({ body: labSchema }), wrap(async (req, res) => {
  const b = req.body;
  const gstin = b.gstin.toUpperCase();
  if (gstin && !isValidGstin(gstin)) throw httpError(400, 'GSTIN format is invalid');
  const lab = await Lab.create({ ...b, gstin, stateCode: stateCodeFromGstin(gstin) || '', id: rid('lab') });
  res.json({ success: true, lab: labAdminView(lab.toObject()) });
}));
router.put('/labs/:id', validate({ params: idParams, body: labSchema.partial() }), wrap(async (req, res) => {
  const lab = await Lab.findOne({ id: req.params.id });
  if (!lab) throw httpError(404, 'Lab not found');
  const b = req.body;
  if (b.gstin !== undefined) { b.gstin = b.gstin.toUpperCase(); if (b.gstin && !isValidGstin(b.gstin)) throw httpError(400, 'GSTIN format is invalid'); lab.stateCode = stateCodeFromGstin(b.gstin) || ''; }
  Object.assign(lab, b);
  await lab.save();
  res.json({ success: true, lab: labAdminView(lab.toObject()) });
}));
// New partner API key: shown ONCE, stored as a hash
router.post('/labs/:id/partner-key', validate({ params: idParams }), wrap(async (req, res) => {
  const lab = await Lab.findOne({ id: req.params.id });
  if (!lab) throw httpError(404, 'Lab not found');
  const key = newPartnerKey();
  lab.partnerKeyHash = hashPartnerKey(key);
  lab.partnerKeyHint = key.slice(-4);
  await lab.save();
  res.json({ success: true, apiKey: key, hint: lab.partnerKeyHint, message: 'Copy this key now — it will not be shown again.' });
}));
router.delete('/labs/:id/partner-key', validate({ params: idParams }), wrap(async (req, res) => {
  await Lab.updateOne({ id: req.params.id }, { $set: { partnerKeyHash: '', partnerKeyHint: '' } });
  res.json({ success: true });
}));

const testSchema = z.object({
  code: z.string().max(30).default(''), name: z.string().trim().min(2).max(160), category: z.string().max(60).default('General'), description: z.string().max(1000).default(''),
  price: z.number().min(1).max(200000), mrp: z.number().min(0).max(200000).default(0), preparation: z.string().max(500).default(''), sampleType: z.string().max(40).default('Blood'),
  tatHours: z.number().int().min(1).max(720).default(24), homeCollection: z.boolean().default(true), isActive: z.boolean().default(true)
});
router.get('/labs/:id/tests', validate({ params: idParams }), wrap(async (req, res) => {
  const items = await LabTest.find({ labId: req.params.id }).sort({ name: 1 }).select('-_id -__v').lean();
  res.json({ items });
}));
router.post('/labs/:id/tests', validate({ params: idParams, body: testSchema }), wrap(async (req, res) => {
  if (!(await Lab.exists({ id: req.params.id }))) throw httpError(404, 'Lab not found');
  const t = await LabTest.create({ ...req.body, id: rid('lt'), labId: req.params.id });
  const o = t.toObject(); delete o._id; delete o.__v;
  res.json({ success: true, test: o });
}));
router.put('/lab-tests/:id', validate({ params: idParams, body: testSchema.partial() }), wrap(async (req, res) => {
  const t = await LabTest.findOneAndUpdate({ id: req.params.id }, { $set: req.body }, { new: true }).select('-_id -__v').lean();
  if (!t) throw httpError(404, 'Test not found');
  res.json({ success: true, test: t });
}));
router.delete('/lab-tests/:id', validate({ params: idParams }), wrap(async (req, res) => {
  await LabTest.updateOne({ id: req.params.id }, { $set: { isActive: false } }); // soft delete keeps order history readable
  res.json({ success: true });
}));

// ---------------------------------------------------------------- lab orders
router.get('/lab-orders', validate({ query: z.object({ status: z.string().max(30).optional(), labId: zId.optional(), search: z.string().max(80).optional(), date: zDate.optional(), page: z.string().optional(), limit: z.string().optional() }) }), wrap(async (req, res) => {
  const q = req.query;
  const f = { status: { $ne: 'Expired' } };
  if (q.status) f.status = q.status;
  if (q.labId) f.labId = q.labId;
  if (q.date) f.slotDate = q.date;
  Object.assign(f, searchFilter(q.search, ['orderCode', 'patientName', 'labName']));
  const out = await paginate(LabOrder, f, parsePaging(q), { createdAt: -1 });
  out.items = out.items.map(o => labOrderView(o, { staff: true }));
  res.json(out);
}));
router.post('/lab-orders/:id/status', validate({ params: idParams, body: z.object({ status: z.enum(['SampleCollected', 'Processing', 'ReportReady', 'Cancelled']), note: z.string().max(300).optional() }) }), wrap(async (req, res) => {
  const o = await LabOrder.findOne({ id: req.params.id });
  if (!o) throw httpError(404, 'Lab order not found');
  if (req.body.status === 'Cancelled') {
    const out = await cancelLabOrder(o, { by: 'admin', reason: req.body.note || 'Cancelled by FindADoc' });
    return res.json({ success: true, labOrder: labOrderView(out.order, { staff: true }), refund: out.refund });
  }
  res.json({ success: true, labOrder: labOrderView(await updateLabOrderStatus(o, req.body.status, { by: 'admin', note: req.body.note }), { staff: true }) });
}));
router.post('/lab-orders/:id/report', singleFile, validate({ params: idParams, body: z.object({ title: z.string().max(160).optional() }) }), wrap(async (req, res) => {
  const o = await LabOrder.findOne({ id: req.params.id });
  if (!o) throw httpError(404, 'Lab order not found');
  const file = await storePrivateUpload(req, { folder: `records/${o.userId}` });
  const rec = await attachLabReport(o, file, { by: 'admin', title: req.body.title });
  res.json({ success: true, recordId: rec.id, labOrder: labOrderView(o, { staff: true }) });
}));
router.get('/lab-orders/:id/reports/:recordId/file', validate({ params: z.object({ id: zId, recordId: zId }) }), wrap(async (req, res) => {
  const rec = await HealthRecord.findOne({ id: req.params.recordId, labOrderId: req.params.id, type: 'lab_report' }).lean();
  if (!rec?.file?.key || !sendPrivateFile(res, rec.file)) throw httpError(404, 'Report not found');
}));

// ---------------------------------------------------------------- DPDP deletion requests (read-only overview)
router.get('/privacy/deletions', wrap(async (req, res) => {
  const items = await User.find({ 'deletion.requestedAt': { $ne: null } }).sort({ 'deletion.requestedAt': -1 }).limit(200).select('id name deletion anonymisedAt status').lean();
  res.json({ items: items.map(u => ({ id: u.id, name: u.anonymisedAt ? 'Deleted user' : u.name, requestedAt: u.deletion?.requestedAt, scheduledFor: u.deletion?.scheduledFor, cancelledAt: u.deletion?.cancelledAt, completedAt: u.deletion?.completedAt || u.anonymisedAt, status: u.status })) });
}));
