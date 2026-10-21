// Doctor workspace API (requires a signed doctor session).
import express from 'express';
import { Booking, Clinic, Doctor } from '../models/index.js';
import { requireUser } from '../lib/userAuth.js';
import { effectivePlan, withinLimit } from '../lib/plans.js';
import { selfDoctor, doctorSlug } from '../lib/profiles.js';
import { normalizeAddress, toPoint } from '../lib/geo.js';
import { isValidGstin, stateCodeFromGstin, stateCodeFromName } from '../lib/gst.js';
import { removeIfReplaced, keyFromPublicUrl, getStorage, sendPrivateFile } from '../lib/storage/index.js';
import { buildLocation, syncDoctorPrimaryLocation, assertDoctorLocationLimit, hasFutureBookings, affiliateDoctor, notifyAffiliation, LOCATION_LABEL } from '../lib/locations.js';
import { bookingView, bookingScopeFilter, cancelBooking, updateBookingStatus, onlinePaymentsAllowed, httpError } from '../lib/bookings.js';
import { parsePaging, searchFilter } from '../lib/http.js';
import { notify } from '../lib/notify.js';
import { wrap, str, strList, bad } from './common.js';

const router = express.Router();
router.use(requireUser('doctor'));

const DOCTOR_KINDS = ['own_clinic', 'hospital', 'home_visit', 'online'];
const GENDERS = ['', 'male', 'female', 'other'];

async function me(req) {
  const ep = await effectivePlan(req.auth.doctor, 'doctor');
  return selfDoctor(req.auth.doctor, ep);
}

router.get('/me', wrap(async (req, res) => {
  const d = req.auth.doctor;
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const [todayCount, upcoming, pending, invites] = await Promise.all([
    Booking.countDocuments({ doctorId: d.id, date: today, status: { $in: ['Pending', 'Confirmed', 'Completed'] } }),
    Booking.countDocuments({ doctorId: d.id, date: { $gte: today }, status: { $in: ['Pending', 'Confirmed'] } }),
    Booking.countDocuments({ doctorId: d.id, status: 'Pending' }),
    Clinic.countDocuments({ invites: { $elemMatch: { doctorId: d.id, status: 'invited' } } })
  ]);
  res.json({ doctor: await me(req), stats: { today: todayCount, upcoming, pending, invites } });
}));

router.put('/profile', wrap(async (req, res) => {
  const d = req.auth.doctor;
  const b = req.body || {};
  const ep = await effectivePlan(d, 'doctor');
  if (b.name !== undefined) { const n = str(b.name, 80); if (n.length < 3) throw bad('Please enter your full name'); d.name = n; }
  if (b.title !== undefined) d.title = str(b.title, 100);
  if (b.qualifications !== undefined) { const q = str(b.qualifications, 200); if (!q) throw bad('Qualifications are required'); d.qualifications = q; }
  if (b.registrationNumber !== undefined) {
    const r = str(b.registrationNumber, 40).toUpperCase();
    if (r && !/^[A-Z0-9\-/ .]{3,40}$/.test(r)) throw bad('Registration number can contain letters, digits, - and / only');
    d.registrationNumber = r;
  }
  if (b.councilName !== undefined) d.councilName = str(b.councilName, 120);
  if (b.registrationYear !== undefined) {
    const y = b.registrationYear === '' || b.registrationYear === null ? null : parseInt(b.registrationYear, 10);
    if (y !== null && !(y >= 1950 && y <= new Date().getFullYear())) throw bad('Registration year looks invalid');
    d.registrationYear = y;
  }
  if (b.experienceYears !== undefined) { const e = parseInt(b.experienceYears, 10); if (!(e >= 0 && e <= 70)) throw bad('Experience must be 0–70 years'); d.experienceYears = e; }
  if (b.specialities !== undefined) {
    const list = strList(b.specialities, 20, 60);
    if (!list.length) throw bad('Choose at least one speciality');
    if (!withinLimit(list.length - 1, ep.limits.maxSpecialities)) throw httpError(403, `Your ${ep.plan.name} plan allows up to ${ep.limits.maxSpecialities} specialities. Upgrade to add more.`, 'PLAN_LIMIT');
    d.specialities = list;
  }
  if (b.languages !== undefined) d.languages = strList(b.languages, 12, 30);
  if (b.bio !== undefined) d.bio = str(b.bio, 2000);
  if (b.gender !== undefined) { if (!GENDERS.includes(b.gender)) throw bad('Invalid gender'); d.gender = b.gender; }
  if (b.sector !== undefined) d.sector = b.sector === 'Government' ? 'Government' : 'Private';
  if (b.email !== undefined) { const e = str(b.email, 120); if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('Email address looks invalid'); d.email = e; }
  if (b.consultationFee !== undefined) { const f = Number(b.consultationFee); if (!(f >= 0 && f <= 100000)) throw bad('Fee must be between ₹0 and ₹1,00,000'); d.consultationFee = f; }
  if (b.bookingEnabled !== undefined) d.bookingEnabled = Boolean(b.bookingEnabled);
  if (b.photo !== undefined) {
    const p = str(b.photo, 400);
    if (p && !keyFromPublicUrl(p) && !/^https:\/\//.test(p)) throw bad('Please upload a profile photo');
    await removeIfReplaced(d.photo, p);
    d.photo = p;
  }
  if (b.address !== undefined) d.addressDetails = normalizeAddress(b.address || {});
  if (b.lat !== undefined || b.lng !== undefined) { const pt = toPoint(b.lat, b.lng); if (pt) { d.location = pt; d.latitude = pt.coordinates[1]; d.longitude = pt.coordinates[0]; } }
  if (b.gstin !== undefined) { const g = str(b.gstin, 15).toUpperCase(); if (g && !isValidGstin(g)) throw bad('GSTIN format is invalid'); d.gstin = g; }
  if (b.state !== undefined) d.state = str(b.state, 60);
  if (b.gstin !== undefined || b.state !== undefined) d.stateCode = stateCodeFromGstin(d.gstin) || stateCodeFromName(d.state || d.addressDetails?.state);
  if (!d.slug) d.slug = doctorSlug(d);
  const out = await me(req);
  if (out.completeness.percent === 100 && !d.profileCompletedAt) d.profileCompletedAt = new Date();
  await d.save();
  res.json({ success: true, doctor: await me(req), message: 'Profile saved' });
}));

// ---------------- Consultation locations ----------------
router.get('/locations', wrap(async (req, res) => {
  const out = await me(req);
  const ep = await effectivePlan(req.auth.doctor, 'doctor');
  res.json({ items: out.consultationLocations, limits: ep.limits, plan: { code: ep.code, name: ep.plan.name }, kinds: LOCATION_LABEL });
}));

router.post('/locations', wrap(async (req, res) => {
  const d = req.auth.doctor;
  const ep = await assertDoctorLocationLimit(d);
  const loc = buildLocation(req.body, { managedBy: 'doctor', allowOnlinePayments: ep.limits.onlinePayments, kinds: DOCTOR_KINDS });
  loc.isActive = true;
  d.consultationLocations.push(loc);
  syncDoctorPrimaryLocation(d);
  await d.save();
  res.json({ success: true, location: loc, doctor: await me(req), message: 'Location added' });
}));

router.put('/locations/:id', wrap(async (req, res) => {
  const d = req.auth.doctor;
  const existing = d.consultationLocations.find(l => l.id === req.params.id);
  if (!existing) throw httpError(404, 'Location not found');
  if (existing.managedBy === 'clinic') throw httpError(403, 'This schedule is managed by the clinic. Ask the clinic to change fee or timings.');
  const ep = await effectivePlan(d, 'doctor');
  const reactivating = existing.isActive === false && req.body.isActive === true;
  if (reactivating) await assertDoctorLocationLimit(d);
  const loc = buildLocation(req.body, { existing: existing.toObject ? existing.toObject() : existing, managedBy: 'doctor', allowOnlinePayments: ep.limits.onlinePayments, kinds: DOCTOR_KINDS });
  Object.assign(existing, loc);
  d.markModified('consultationLocations');
  syncDoctorPrimaryLocation(d);
  await d.save();
  res.json({ success: true, doctor: await me(req), message: 'Location updated' });
}));

router.delete('/locations/:id', wrap(async (req, res) => {
  const d = req.auth.doctor;
  const existing = d.consultationLocations.find(l => l.id === req.params.id);
  if (!existing) throw httpError(404, 'Location not found');
  if (existing.managedBy === 'clinic') throw httpError(403, 'Clinic locations are removed by the clinic (or leave the clinic from Clinic affiliations).');
  if (await hasFutureBookings(d.id, existing.id)) {
    existing.isActive = false;
    d.markModified('consultationLocations');
    await d.save();
    return res.json({ success: true, deactivated: true, doctor: await me(req), message: 'Location has upcoming bookings, so it was deactivated (no new bookings) instead of deleted.' });
  }
  d.consultationLocations = d.consultationLocations.filter(l => l.id !== existing.id);
  syncDoctorPrimaryLocation(d);
  await d.save();
  res.json({ success: true, doctor: await me(req), message: 'Location removed' });
}));

// ---------------- Bookings ----------------
const BOOKING_SORT = { upcoming: { date: 1, timeSlot: 1 }, today: { timeSlot: 1 }, pending: { date: 1, timeSlot: 1 } };

export async function listBookings(baseFilter, q) {
  const filter = { ...baseFilter, ...bookingScopeFilter(q.scope || 'upcoming') };
  if (q.status && q.status !== 'all') filter.status = q.status;
  if (!q.scope || q.scope === 'all') filter.status = filter.status || { $ne: 'Expired' };
  if (q.locationId) filter.locationId = q.locationId;
  if (q.doctorId) filter.doctorId = q.doctorId;
  if (q.mode) filter.bookingMode = q.mode;
  if (q.from || q.to) filter.date = { ...(typeof filter.date === 'object' ? filter.date : filter.date ? { $eq: filter.date } : {}), ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
  const s = searchFilter(q.search, ['patientName', 'patientPhone', 'bookingCode', 'doctorName', 'forMember.name']);
  const finalFilter = s.$or ? { $and: [filter, s] } : filter;
  const paging = parsePaging(q, { defaultLimit: 20, maxLimit: 100 });
  const sort = BOOKING_SORT[q.scope] || { date: -1, timeSlot: -1 };
  const [items, total] = await Promise.all([
    Booking.find(finalFilter).sort(sort).skip(paging.skip).limit(paging.limit).lean(),
    Booking.countDocuments(finalFilter)
  ]);
  return { items: items.map(bookingView), total, page: paging.page, limit: paging.limit, pages: Math.max(1, Math.ceil(total / paging.limit)) };
}

router.get('/bookings', wrap(async (req, res) => {
  res.json(await listBookings({ doctorId: req.auth.doctor.id }, req.query));
}));

router.post('/bookings/:id/:action(accept|complete|no-show|cancel)', wrap(async (req, res) => {
  const b = await Booking.findOne({ id: req.params.id, doctorId: req.auth.doctor.id });
  if (!b) throw httpError(404, 'Booking not found');
  if (req.params.action === 'cancel') {
    const reason = str(req.body?.reason, 300);
    if (reason.length < 3) throw bad('Please give the patient a reason for cancelling');
    const out = await cancelBooking(b, { by: 'doctor', reason });
    if (b.clinicId) await notify({ type: 'clinic', id: b.clinicId }, { type: 'booking_status', title: 'Doctor cancelled a booking', body: `${b.bookingCode} • ${b.patientName} • ${b.date} ${b.timeSlot}` });
    return res.json({ success: true, booking: bookingView(out.booking), refund: out.refund, message: 'Booking cancelled; the patient has been notified' + (out.refund.amount ? ` and ₹${out.refund.amount} refunded.` : '.') });
  }
  const out = await updateBookingStatus(b, req.params.action, 'doctor');
  res.json({ success: true, booking: bookingView(out), message: `Booking ${out.status === 'NoShow' ? 'marked no-show' : out.status.toLowerCase()}` });
}));

router.get('/analytics', wrap(async (req, res) => {
  const d = req.auth.doctor;
  const ep = await effectivePlan(d, 'doctor');
  if (!ep.limits.analytics) throw httpError(403, 'Booking analytics is available on Pro and Premium plans.', 'PLAN_FEATURE');
  res.json(await bookingAnalytics({ doctorId: d.id }));
}));

export async function bookingAnalytics(match) {
  const since = new Date(); since.setMonth(since.getMonth() - 5); since.setDate(1);
  const [byStatus, byMonth, byLocation, byMode] = await Promise.all([
    Booking.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
    Booking.aggregate([{ $match: { ...match, createdAt: { $gte: since }, status: { $nin: ['Expired', 'AwaitingPayment'] } } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: '+05:30' } }, bookings: { $sum: 1 }, online: { $sum: '$amountPaidOnline' }, refunds: { $sum: '$refundAmount' } } }, { $sort: { _id: 1 } }]),
    Booking.aggregate([{ $match: { ...match, status: { $nin: ['Expired', 'AwaitingPayment'] } } }, { $group: { _id: '$locationName', n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 8 }]),
    Booking.aggregate([{ $match: { ...match, status: { $nin: ['Expired', 'AwaitingPayment'] } } }, { $group: { _id: '$bookingMode', n: { $sum: 1 } } }])
  ]);
  return {
    byStatus: Object.fromEntries(byStatus.map(x => [x._id, x.n])),
    byMonth: byMonth.map(x => ({ month: x._id, bookings: x.bookings, online: Math.round((x.online - x.refunds) * 100) / 100 })),
    byLocation: byLocation.map(x => ({ name: x._id || '—', n: x.n })),
    byMode: Object.fromEntries(byMode.map(x => [x._id, x.n]))
  };
}

// ---------------- Clinics: invites & join requests ----------------
router.get('/clinics', wrap(async (req, res) => {
  const d = req.auth.doctor;
  const [invites, requested] = await Promise.all([
    Clinic.find({ invites: { $elemMatch: { doctorId: d.id, status: 'invited' } }, status: 'active' }).select('id name address city photo invites').lean(),
    Clinic.find({ 'pendingRequests.doctorId': d.id }).select('id name address city').lean()
  ]);
  res.json({
    affiliations: (d.clinics || []).map(c => ({ ...c.toObject?.() ?? c, location: d.consultationLocations.find(l => l.kind === 'clinic' && l.clinicId === c.clinicId && l.isActive !== false) || null })),
    invites: invites.map(c => ({ clinicId: c.id, clinicName: c.name, address: c.address, photo: c.photo, invite: c.invites.find(i => i.doctorId === d.id && i.status === 'invited') })),
    requested: requested.map(c => ({ clinicId: c.id, clinicName: c.name, address: c.address }))
  });
}));

router.post('/clinics/:clinicId/request', wrap(async (req, res) => {
  const d = req.auth.doctor;
  const clinic = await Clinic.findOne({ id: req.params.clinicId, status: 'active' });
  if (!clinic) throw httpError(404, 'Clinic not found');
  if ((clinic.doctorIds || []).includes(d.id)) throw bad('You are already part of this clinic');
  if (!clinic.pendingRequests.some(r => r.doctorId === d.id)) {
    clinic.pendingRequests.push({ doctorId: d.id, doctorName: d.name, qualifications: d.qualifications, specialities: d.specialities, requestedAt: new Date().toISOString().slice(0, 10) });
    await clinic.save();
    await notify({ type: 'clinic', id: clinic.id }, { type: 'affiliation', title: 'Doctor wants to join your clinic', body: `${d.name} (${d.specialities.join(', ')}) requested to join ${clinic.name}.` });
  }
  res.json({ success: true, message: `Request sent to ${clinic.name}` });
}));

router.post('/clinics/:clinicId/invite/:action(accept|decline)', wrap(async (req, res) => {
  const d = req.auth.doctor;
  const clinic = await Clinic.findOne({ id: req.params.clinicId });
  const inv = clinic?.invites?.find(i => i.doctorId === d.id && i.status === 'invited');
  if (!inv) throw httpError(404, 'Invitation not found or already answered');
  if (req.params.action === 'decline') {
    inv.status = 'declined'; inv.respondedAt = new Date();
    clinic.markModified('invites');
    await clinic.save();
    await notify({ type: 'clinic', id: clinic.id }, { type: 'affiliation', title: 'Invitation declined', body: `${d.name} declined your invitation.` });
    return res.json({ success: true, message: 'Invitation declined' });
  }
  if (clinic.status !== 'active') throw bad('This clinic is not active right now');
  await affiliateDoctor(clinic, d, { speciality: inv.speciality, source: 'invite' });
  inv.status = 'accepted'; inv.respondedAt = new Date();
  clinic.markModified('invites');
  await clinic.save();
  await notifyAffiliation(clinic, d, `${d.name} joined ${clinic.name}${inv.speciality ? ` (${inv.speciality})` : ''}. The clinic manages fee & timings for this location.`);
  res.json({ success: true, doctor: await me(req), message: `You joined ${clinic.name}. The clinic will set your schedule and fee there.` });
}));

router.post('/clinics/:clinicId/leave', wrap(async (req, res) => {
  const d = req.auth.doctor;
  const clinic = await Clinic.findOne({ id: req.params.clinicId });
  if (!clinic) throw httpError(404, 'Clinic not found');
  const { unaffiliateDoctor } = await import('../lib/locations.js');
  await unaffiliateDoctor(clinic, d);
  await notifyAffiliation(clinic, d, `${d.name} left ${clinic.name}.`);
  res.json({ success: true, doctor: await me(req), message: `You left ${clinic.name}` });
}));

// ---------------- Verification documents ----------------
router.get('/documents', wrap(async (req, res) => {
  res.json({ items: (await me(req)).documents });
}));

router.get('/documents/:id/file', wrap(async (req, res) => {
  const doc = req.auth.doctor.documents.find(x => x.id === req.params.id);
  if (!doc) throw httpError(404, 'Document not found');
  if (!sendPrivateFile(res, doc)) throw httpError(404, 'File missing');
}));

router.delete('/documents/:id', wrap(async (req, res) => {
  const d = req.auth.doctor;
  const doc = d.documents.find(x => x.id === req.params.id);
  if (!doc) throw httpError(404, 'Document not found');
  if (doc.status === 'verified' && d.status === 'active') throw bad('Verified documents cannot be removed. Contact support to replace them.');
  await getStorage().remove(doc.key);
  d.documents = d.documents.filter(x => x.id !== doc.id);
  await d.save();
  res.json({ success: true, items: (await me(req)).documents });
}));

export default router;
