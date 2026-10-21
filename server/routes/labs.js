// Lab tests & home sample collection.
//   publicLabsRouter  (/api)              : lab + test catalogue (no auth)
//   labOrdersRouter   (/api/lab-orders)   : patient orders (patient session; ownership enforced)
//   labPartnerRouter  (/api/lab-partner)  : lab partner API (X-Lab-Key, hashed at rest) — status + report upload
import express from 'express';
import crypto from 'crypto';
import { Lab, LabTest, LabOrder } from '../models/index.js';
import { requireUser } from '../lib/userAuth.js';
import { validate, z, zId, zDate } from '../lib/validate.js';
import { rateLimit, userKey } from '../lib/rateLimit.js';
import { createLabOrder, cancelLabOrder, labOrderView, updateLabOrderStatus, attachLabReport, hashPartnerKey } from '../lib/labs.js';
import { singleFile, storePrivateUpload } from '../lib/uploadPipeline.js';
import { normalizeAddress } from '../lib/geo.js';
import { escapeRegex } from '../lib/http.js';
import { httpError } from '../lib/bookings.js';
import { getSettings } from '../lib/settings.js';
import { wrap, bad } from './common.js';

const labPublic = l => ({ id: l.id, name: l.name, type: l.type, address: l.address, city: l.city, accreditation: l.accreditation, homeCollection: Boolean(l.homeCollection), collectionWindows: l.collectionWindows || [], pincodes: l.pincodes || [] });
const testPublic = t => ({ id: t.id, labId: t.labId, code: t.code, name: t.name, category: t.category, description: t.description, price: t.price, mrp: t.mrp, preparation: t.preparation, sampleType: t.sampleType, tatHours: t.tatHours, homeCollection: t.homeCollection !== false });

// ---------------------------------------------------------------- public catalogue
export const publicLabsRouter = express.Router();
publicLabsRouter.get('/labs', wrap(async (req, res) => {
  const [labs, settings] = await Promise.all([Lab.find({ isActive: true }).sort({ name: 1 }).limit(200).lean(), getSettings()]);
  res.json({ success: true, labs: labs.map(labPublic), homeCollectionFee: Math.max(0, settings.labHomeCollectionFee ?? 99) });
}));
publicLabsRouter.get('/lab-tests', validate({ query: z.object({ search: z.string().max(80).optional(), category: z.string().max(60).optional(), labId: zId.optional(), home: z.enum(['true', 'false']).optional() }) }), wrap(async (req, res) => {
  const labs = await Lab.find({ isActive: true }).select('id name homeCollection').lean();
  const f = { isActive: true, labId: { $in: labs.map(l => l.id) } };
  if (req.query.labId) f.labId = labs.some(l => l.id === req.query.labId) ? req.query.labId : '__none__';
  if (req.query.category) f.category = req.query.category;
  if (req.query.home === 'true') { f.homeCollection = { $ne: false }; f.labId = { $in: labs.filter(l => l.homeCollection && (!req.query.labId || l.id === req.query.labId)).map(l => l.id) }; }
  if (req.query.search?.trim()) { const re = new RegExp(escapeRegex(req.query.search.trim()), 'i'); f.$or = [{ name: re }, { code: re }, { category: re }, { description: re }]; }
  const tests = await LabTest.find(f).sort({ name: 1 }).limit(300).lean();
  const byId = Object.fromEntries(labs.map(l => [l.id, l.name]));
  res.json({ success: true, tests: tests.map(t => ({ ...testPublic(t), labName: byId[t.labId] || '' })), categories: [...new Set(tests.map(t => t.category))].sort() });
}));

// ---------------------------------------------------------------- patient orders
export const labOrdersRouter = express.Router();
labOrdersRouter.use(requireUser('patient'));
const addressSchema = z.object({ line1: z.string().trim().max(200).default(''), line2: z.string().trim().max(200).optional(), area: z.string().trim().max(100).optional(), city: z.string().trim().max(80).optional(), state: z.string().trim().max(60).optional(), pincode: z.string().trim().max(10).default(''), landmark: z.string().trim().max(120).optional() }).partial();
labOrdersRouter.post('/', rateLimit({ name: 'lab-order', windowMs: 60 * 60 * 1000, max: 15, key: userKey, message: 'Too many lab orders. Please try again later.' }),
  validate({ body: z.object({ labId: zId, testIds: z.array(zId).min(1, 'Choose at least one test').max(20), mode: z.enum(['lab_visit', 'home_collection']), address: addressSchema.optional(), slotDate: zDate, slotWindow: z.string().max(20).default(''), memberId: zId.optional() }) }),
  wrap(async (req, res) => {
    const u = req.auth.user;
    const b = req.body;
    const member = b.memberId ? (u.familyMembers || []).find(m => m.id === b.memberId) : null;
    if (b.memberId && !member) throw bad('Family member not found');
    const open = await LabOrder.countDocuments({ userId: u.id, status: { $in: ['AwaitingPayment', 'Confirmed', 'SampleCollected', 'Processing'] } });
    if (open >= 10) throw bad('You have too many open lab orders');
    const address = b.mode === 'home_collection' ? { ...normalizeAddress(b.address || {}), line1: String(b.address?.line1 || '').slice(0, 200), pincode: String(b.address?.pincode || '').trim() } : {};
    const out = await createLabOrder({ user: u, member, labId: b.labId, testIds: b.testIds, mode: b.mode, address, slotDate: b.slotDate, slotWindow: b.slotWindow });
    res.json({ success: true, labOrder: labOrderView(out.order), payment: out.payment, requiresPayment: true });
  }));
labOrdersRouter.get('/', wrap(async (req, res) => {
  const items = await LabOrder.find({ userId: req.auth.uid, status: { $ne: 'Expired' } }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, items: items.map(o => labOrderView(o)) });
}));
labOrdersRouter.get('/:id', validate({ params: z.object({ id: zId }) }), wrap(async (req, res) => {
  const o = await LabOrder.findOne({ id: req.params.id, userId: req.auth.uid }).lean();
  if (!o) throw httpError(404, 'Lab order not found');
  res.json({ success: true, labOrder: labOrderView(o) });
}));
labOrdersRouter.post('/:id/cancel', rateLimit({ name: 'lab-cancel', windowMs: 60 * 60 * 1000, max: 20, key: userKey }), validate({ params: z.object({ id: zId }), body: z.object({ reason: z.string().max(300).optional() }) }), wrap(async (req, res) => {
  const o = await LabOrder.findOne({ id: req.params.id, userId: req.auth.uid });
  if (!o) throw httpError(404, 'Lab order not found');
  const out = await cancelLabOrder(o, { by: 'patient', reason: req.body.reason || 'Cancelled by patient' });
  res.json({ success: true, labOrder: labOrderView(out.order), refund: out.refund, message: out.refund.amount ? `Order cancelled. ₹${out.refund.amount} will be refunded.` : 'Order cancelled.' });
}));

// ---------------------------------------------------------------- lab partner API
export const labPartnerRouter = express.Router();
labPartnerRouter.use(rateLimit({ name: 'lab-partner', windowMs: 60 * 1000, max: 120 }));
labPartnerRouter.use(wrap(async (req, res, next) => {
  const key = String(req.headers['x-lab-key'] || '');
  if (!/^labk_[A-Za-z0-9_-]{20,80}$/.test(key)) throw httpError(401, 'Lab API key required', 'LAB_KEY_REQUIRED');
  const lab = await Lab.findOne({ partnerKeyHash: hashPartnerKey(key), isActive: true });
  if (!lab) throw httpError(401, 'Invalid lab API key', 'LAB_KEY_INVALID');
  req.lab = lab;
  next();
}));
const partnerView = o => { const v = labOrderView(o, { staff: true }); delete v.commissionInvoiceNumber; return v; };
labPartnerRouter.get('/orders', validate({ query: z.object({ status: z.enum(['Confirmed', 'SampleCollected', 'Processing', 'ReportReady', 'Cancelled']).optional(), date: zDate.optional() }) }), wrap(async (req, res) => {
  const f = { labId: req.lab.id, status: req.query.status || { $in: ['Confirmed', 'SampleCollected', 'Processing'] } };
  if (req.query.date) f.slotDate = req.query.date;
  const items = await LabOrder.find(f).sort({ slotDate: 1 }).limit(200).lean();
  res.json({ success: true, items: items.map(partnerView) });
}));
labPartnerRouter.post('/orders/:id/status', validate({ params: z.object({ id: zId }), body: z.object({ status: z.enum(['SampleCollected', 'Processing', 'ReportReady']), note: z.string().max(200).optional() }) }), wrap(async (req, res) => {
  const o = await LabOrder.findOne({ id: req.params.id, labId: req.lab.id });
  if (!o) throw httpError(404, 'Lab order not found');
  res.json({ success: true, labOrder: partnerView(await updateLabOrderStatus(o, req.body.status, { by: `lab:${req.lab.id}`, note: req.body.note })) });
}));
labPartnerRouter.post('/orders/:id/report', singleFile, validate({ params: z.object({ id: zId }), body: z.object({ title: z.string().max(160).optional() }) }), wrap(async (req, res) => {
  const o = await LabOrder.findOne({ id: req.params.id, labId: req.lab.id });
  if (!o) throw httpError(404, 'Lab order not found');
  const file = await storePrivateUpload(req, { folder: `records/${o.userId}` });
  const rec = await attachLabReport(o, file, { by: `lab:${req.lab.id}`, title: req.body.title });
  res.json({ success: true, recordId: rec.id, labOrder: partnerView(o) });
}));

export const newPartnerKey = () => `labk_${crypto.randomBytes(24).toString('base64url')}`;
