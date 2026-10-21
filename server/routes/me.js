// Patient self-service: profile, family members, bookings.
import express from 'express';
import crypto from 'crypto';
import { Booking } from '../models/index.js';
import { requireUser } from '../lib/userAuth.js';
import { normalizeAddress, toPoint } from '../lib/geo.js';
import { selfUser } from '../lib/profiles.js';
import { removeIfReplaced, keyFromPublicUrl } from '../lib/storage/index.js';
import { bookingView, bookingScopeFilter, cancelBooking, httpError } from '../lib/bookings.js';
import { parsePaging } from '../lib/http.js';
import { stateCodeFromName } from '../lib/gst.js';
import { isDateStr } from '../lib/time.js';
import { validate, z, zId } from '../lib/validate.js';
import { wrap, str, bad } from './common.js';

const router = express.Router();
router.use(requireUser('patient'));

const mine = auth => ({ $or: [{ patientUserId: auth.uid }, { patientPhone: auth.user.phone }] });

const GENDERS = ['', 'male', 'female', 'other', 'prefer_not_to_say'];
const RELATIONS = ['spouse', 'child', 'parent', 'sibling', 'grandparent', 'other'];

// zod shape checks (types / lengths); business rules stay in the handlers below
const zStr = max => z.string().max(max);
const addressSchema = z.object({}).catchall(z.union([z.string().max(300), z.number(), z.null()])).nullable();
const profileSchema = z.object({
  name: zStr(80).optional(), email: zStr(120).optional(), dob: zStr(10).optional(),
  gender: z.enum(GENDERS).optional(), bloodGroup: z.enum(['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).optional(),
  photo: zStr(400).optional(), address: addressSchema.optional(),
  lat: z.union([z.number(), z.string().max(30), z.null()]).optional(), lng: z.union([z.number(), z.string().max(30), z.null()]).optional()
});
const memberSchema = z.object({ name: zStr(80), relation: zStr(20).optional(), gender: zStr(30).optional(), dob: zStr(10).optional() });
const idParams = z.object({ id: zId });

function validDob(dob) {
  if (!dob) return '';
  if (!isDateStr(dob)) throw bad('Date of birth must be YYYY-MM-DD');
  const d = new Date(`${dob}T00:00:00Z`);
  if (d > new Date() || d.getUTCFullYear() < 1900) throw bad('Please enter a valid date of birth');
  return dob;
}

router.get('/', wrap(async (req, res) => {
  const counts = await Booking.aggregate([{ $match: mine(req.auth) }, { $group: { _id: '$status', n: { $sum: 1 } } }]);
  res.json({ user: selfUser(req.auth.user), bookingCounts: Object.fromEntries(counts.map(c => [c._id, c.n])) });
}));

router.put('/', validate({ body: profileSchema }), wrap(async (req, res) => {
  const u = req.auth.user;
  const b = req.body || {};
  if (b.name !== undefined) { const n = str(b.name, 80); if (n.length < 2) throw bad('Please enter your full name'); u.name = n; }
  if (b.email !== undefined) { const e = str(b.email, 120); if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('Email address looks invalid'); u.email = e; }
  if (b.dob !== undefined) u.dob = validDob(str(b.dob, 10));
  if (b.gender !== undefined) { if (!GENDERS.includes(b.gender)) throw bad('Invalid gender'); u.gender = b.gender; }
  if (b.bloodGroup !== undefined) u.bloodGroup = str(b.bloodGroup, 5);
  if (b.photo !== undefined) {
    const p = str(b.photo, 400);
    if (p && !keyFromPublicUrl(p) && !/^https:\/\//.test(p)) throw bad('Photo must be uploaded');
    await removeIfReplaced(u.photo, p);
    u.photo = p;
  }
  if (b.address !== undefined) {
    u.addressDetails = normalizeAddress(b.address || {});
    if (u.addressDetails.state) { u.state = u.addressDetails.state; u.stateCode = stateCodeFromName(u.state); }
  }
  if (b.lat !== undefined || b.lng !== undefined) u.location = toPoint(b.lat, b.lng);
  await u.save();
  res.json({ success: true, user: selfUser(u), message: 'Profile saved' });
}));

// Family members
router.post('/family', validate({ body: memberSchema }), wrap(async (req, res) => {
  const u = req.auth.user;
  if ((u.familyMembers || []).length >= 10) throw bad('You can add up to 10 family members');
  const m = memberFrom(req.body);
  m.id = `fm-${crypto.randomBytes(4).toString('hex')}`;
  u.familyMembers.push(m);
  await u.save();
  res.json({ success: true, member: m, user: selfUser(u) });
}));

router.put('/family/:id', validate({ params: idParams, body: memberSchema }), wrap(async (req, res) => {
  const u = req.auth.user;
  const idx = (u.familyMembers || []).findIndex(m => m.id === req.params.id);
  if (idx < 0) throw httpError(404, 'Family member not found');
  u.familyMembers[idx] = { ...memberFrom(req.body), id: req.params.id };
  u.markModified('familyMembers');
  await u.save();
  res.json({ success: true, user: selfUser(u) });
}));

router.delete('/family/:id', validate({ params: idParams }), wrap(async (req, res) => {
  const u = req.auth.user;
  u.familyMembers = (u.familyMembers || []).filter(m => m.id !== req.params.id);
  await u.save();
  res.json({ success: true, user: selfUser(u) });
}));

function memberFrom(b = {}) {
  const name = str(b.name, 80);
  if (name.length < 2) throw bad('Family member name is required');
  const relation = RELATIONS.includes(b.relation) ? b.relation : 'other';
  const gender = GENDERS.includes(b.gender) ? b.gender : '';
  return { name, relation, gender, dob: validDob(str(b.dob, 10)) };
}

// Bookings (history)
router.get('/bookings', wrap(async (req, res) => {
  const q = req.query;
  const filter = { $and: [mine(req.auth)], ...bookingScopeFilter(q.tab || 'all') };
  if (!q.tab || q.tab === 'all') filter.status = { $ne: 'Expired' };
  const paging = parsePaging(q, { defaultLimit: 10, maxLimit: 50 });
  const sort = q.tab === 'upcoming' ? { date: 1, timeSlot: 1 } : { createdAt: -1 };
  const [items, total] = await Promise.all([
    Booking.find(filter).sort(sort).skip(paging.skip).limit(paging.limit).lean(),
    Booking.countDocuments(filter)
  ]);
  res.json({ items: items.map(bookingView), total, page: paging.page, limit: paging.limit, pages: Math.max(1, Math.ceil(total / paging.limit)) });
}));

router.post('/bookings/:id/cancel', wrap(async (req, res) => {
  const b = await Booking.findOne({ id: req.params.id, ...mine(req.auth) });
  if (!b) throw httpError(404, 'Booking not found');
  const out = await cancelBooking(b, { by: 'patient', reason: str(req.body?.reason, 300) || 'Cancelled by patient' });
  res.json({ success: true, booking: bookingView(out.booking), refund: out.refund, message: out.refund.status === 'processed' ? `Booking cancelled. ₹${out.refund.amount} will be refunded to your original payment method.` : out.refund.status === 'not_eligible' ? 'Booking cancelled. Not eligible for a refund as it was cancelled close to the appointment time.' : 'Booking cancelled.' });
}));

export default router;
