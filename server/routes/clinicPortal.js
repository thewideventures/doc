// Clinic workspace API (requires a signed clinic session).
import express from 'express';
import crypto from 'crypto';
import { Booking, Clinic, Doctor, User } from '../models/index.js';
import { requireUser } from '../lib/userAuth.js';
import { effectivePlan, withinLimit } from '../lib/plans.js';
import { selfClinic, publicDoctor, doctorSlug, DEFAULT_DOCTOR_PHOTO } from '../lib/profiles.js';
import { normalizeAddress, toPoint, formatAddress } from '../lib/geo.js';
import { isValidGstin, stateCodeFromGstin, stateCodeFromName } from '../lib/gst.js';
import { removeIfReplaced, keyFromPublicUrl } from '../lib/storage/index.js';
import { buildLocation, affiliateDoctor, unaffiliateDoctor, notifyAffiliation, assertClinicDoctorLimit, clinicDoctorCount, clinicDoctorFilter } from '../lib/locations.js';
import { bookingView, cancelBooking, updateBookingStatus, createBooking, availability, upcomingDates, httpError } from '../lib/bookings.js';
import { findByPhone, canonicalPhone, isValidMobile, maskPhone } from '../lib/phone.js';
import { isTimeStr } from '../lib/time.js';
import { notify } from '../lib/notify.js';
import { listBookings, bookingAnalytics } from './doctorPortal.js';
import { wrap, str, strList, bad } from './common.js';

const router = express.Router();
router.use(requireUser('clinic'));

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

async function me(req) {
  const ep = await effectivePlan(req.auth.clinic, 'clinic');
  return selfClinic(req.auth.clinic, ep);
}

function clinicLocationOf(doctor, clinicId) {
  return (doctor.consultationLocations || []).find(l => l.kind === 'clinic' && l.clinicId === clinicId);
}

router.get('/me', wrap(async (req, res) => {
  const c = req.auth.clinic;
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const [todayCount, upcoming] = await Promise.all([
    Booking.countDocuments({ clinicId: c.id, date: today, status: { $in: ['Pending', 'Confirmed', 'Completed'] } }),
    Booking.countDocuments({ clinicId: c.id, date: { $gte: today }, status: { $in: ['Pending', 'Confirmed'] } })
  ]);
  res.json({ clinic: await me(req), stats: { today: todayCount, upcoming, doctors: await clinicDoctorCount(c), requests: (c.pendingRequests || []).length, invites: (c.invites || []).filter(i => i.status === 'invited').length } });
}));

router.put('/profile', wrap(async (req, res) => {
  const c = req.auth.clinic;
  const b = req.body || {};
  const ep = await effectivePlan(c, 'clinic');
  let addressChanged = false;
  if (b.name !== undefined) { const n = str(b.name, 120); if (n.length < 3) throw bad('Clinic name is required'); c.name = n; }
  if (b.type !== undefined) c.type = str(b.type, 80) || c.type;
  if (b.sector !== undefined) c.sector = b.sector === 'Government' ? 'Government' : 'Private';
  if (b.about !== undefined) c.about = str(b.about, 2000);
  if (b.website !== undefined) { const w = str(b.website, 200); if (w && !/^https?:\/\/[^\s]+\.[^\s]+$/.test(w)) throw bad('Website must start with http:// or https://'); c.website = w; }
  if (b.email !== undefined) { const e = str(b.email, 120); if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('Email address looks invalid'); c.email = e; }
  if (b.facilities !== undefined) c.facilities = strList(b.facilities, 30, 60);
  if (b.insurers !== undefined) c.insurers = strList(b.insurers, 40, 80);
  if (b.emergencyServices !== undefined) c.emergencyServices = Boolean(b.emergencyServices);
  for (const field of ['photo', 'coverPhoto']) {
    if (b[field] !== undefined) {
      const p = str(b[field], 400);
      if (p && !keyFromPublicUrl(p) && !/^https:\/\//.test(p)) throw bad('Please upload the image');
      await removeIfReplaced(c[field], p);
      c[field] = p;
    }
  }
  if (b.gallery !== undefined) {
    const list = strList(b.gallery, 100, 400).filter(u => keyFromPublicUrl(u) || /^https:\/\//.test(u));
    if (!withinLimit(list.length - 1, ep.limits.maxGalleryImages)) throw httpError(403, `Your ${ep.plan.name} plan allows ${ep.limits.maxGalleryImages} gallery photos. Upgrade to add more.`, 'PLAN_LIMIT');
    for (const old of c.gallery || []) if (!list.includes(old)) await removeIfReplaced(old, '');
    c.gallery = list;
  }
  if (b.address !== undefined) {
    const a = normalizeAddress(b.address || {});
    if (!a.city || !(a.line || a.area)) throw bad('Enter the clinic address (street/area and city)');
    c.addressDetails = { ...a, formatted: a.formatted || formatAddress(a) };
    c.address = c.addressDetails.formatted;
    c.city = a.city;
    if (a.state) c.state = a.state;
    addressChanged = true;
  }
  if (b.lat !== undefined || b.lng !== undefined) {
    const pt = toPoint(b.lat, b.lng);
    if (!pt) throw bad('Pick the clinic location on the map');
    c.location = pt; c.latitude = pt.coordinates[1]; c.longitude = pt.coordinates[0];
    addressChanged = true;
  }
  if (b.timings !== undefined) {
    if (!Array.isArray(b.timings)) throw bad('Invalid timings');
    c.timings = DAYS.map(day => {
      const t = b.timings.find(x => x?.day === day) || { day, closed: true };
      const closed = Boolean(t.closed);
      if (!closed && (!isTimeStr(t.open) || !isTimeStr(t.close) || t.open >= t.close)) throw bad(`Check the opening hours for ${day}`);
      return { day, open: closed ? '' : t.open, close: closed ? '' : t.close, closed };
    });
  }
  if (b.is24x7 !== undefined) c.is24x7 = Boolean(b.is24x7);
  if (b.gstin !== undefined) { const g = str(b.gstin, 15).toUpperCase(); if (g && !isValidGstin(g)) throw bad('GSTIN format is invalid'); c.gstin = g; }
  if (b.gstin !== undefined || b.address !== undefined) c.stateCode = stateCodeFromGstin(c.gstin) || stateCodeFromName(c.state);
  await c.save();
  if (addressChanged || b.name !== undefined) {
    // keep doctors' clinic-managed locations in sync with the clinic address / pin
    const docs = await Doctor.find({ id: { $in: c.doctorIds || [] } });
    for (const d of docs) {
      const loc = clinicLocationOf(d, c.id);
      if (!loc) continue;
      loc.name = c.name;
      if (c.addressDetails?.city) loc.address = c.addressDetails;
      if (c.location?.coordinates?.length === 2) loc.location = c.location;
      d.markModified('consultationLocations');
      const ce = (d.clinics || []).find(x => x.clinicId === c.id);
      if (ce) { ce.clinicName = c.name; ce.address = c.address; }
      await d.save();
    }
  }
  res.json({ success: true, clinic: await me(req), message: 'Clinic profile saved' });
}));

// ---------------- Doctors ----------------
router.get('/doctors', wrap(async (req, res) => {
  const c = req.auth.clinic;
  const ep = await effectivePlan(c, 'clinic');
  const docs = await Doctor.find(clinicDoctorFilter(c)).lean();
  const items = docs.map(d => {
    const asg = (c.doctorAssignments || []).find(a => a.doctorId === d.id);
    const loc = clinicLocationOf(d, c.id);
    return {
      ...publicDoctor(d, null),
      status: d.status, phone: maskPhone(d.phone),
      speciality: asg?.speciality || loc?.speciality || d.specialities?.[0] || 'General',
      addedAt: asg?.addedAt || null, source: asg?.source || 'legacy',
      createdByClinic: d.createdByClinicId === c.id,
      clinicLocation: loc ? { id: loc.id, fee: loc.fee, bookingMode: loc.bookingMode, tokenAmount: loc.tokenAmount, schedule: loc.schedule, isActive: loc.isActive !== false, autoConfirm: loc.autoConfirm !== false } : null
    };
  });
  const groups = {};
  for (const it of items) (groups[it.speciality] ||= []).push(it);
  const reqDocs = await Doctor.find({ id: { $in: (c.pendingRequests || []).map(r => r.doctorId) } }).select('id name photo qualifications specialities experienceYears status').lean();
  res.json({
    items, groups: Object.entries(groups).map(([speciality, doctors]) => ({ speciality, doctors })).sort((a, b) => a.speciality.localeCompare(b.speciality)),
    requests: reqDocs.map(d => ({ doctorId: d.id, name: d.name, photo: d.photo, qualifications: d.qualifications, specialities: d.specialities, experienceYears: d.experienceYears, status: d.status, requestedAt: (c.pendingRequests.find(r => r.doctorId === d.id) || {}).requestedAt })),
    invites: (c.invites || []).filter(i => i.status === 'invited').map(i => ({ ...i.toObject?.() ?? i, phone: maskPhone(i.phone) })),
    limits: { maxDoctors: ep.limits.maxDoctors, used: await clinicDoctorCount(c), plan: ep.plan.name, onlinePayments: ep.limits.onlinePayments }
  });
}));

router.post('/doctors/invite', wrap(async (req, res) => {
  const c = req.auth.clinic;
  const { phone, doctorId } = req.body || {};
  const speciality = str(req.body?.speciality, 80);
  if (!speciality) throw bad('Choose the speciality / department for this doctor');
  let doctor = null;
  if (doctorId) doctor = await Doctor.findOne({ id: str(doctorId, 60) });
  else if (phone) { if (!isValidMobile(phone)) throw bad('Enter a valid 10-digit mobile number'); doctor = await findByPhone(Doctor, phone); }
  else throw bad('Enter the doctor\'s mobile number or FindADoc doctor ID');
  if (!doctor || doctor.status === 'deleted') throw httpError(404, 'No FindADoc doctor found. You can create the doctor profile instead.', 'DOCTOR_NOT_FOUND');
  if (['suspended', 'rejected'].includes(doctor.status)) throw bad('This doctor cannot be added right now');
  if ((c.doctorIds || []).includes(doctor.id)) throw bad(`${doctor.name} is already part of your clinic`);
  await assertClinicDoctorLimit(c);
  // a doctor who already asked to join is added straight away
  if ((c.pendingRequests || []).some(r => r.doctorId === doctor.id)) {
    await affiliateDoctor(c, doctor, { speciality, source: 'request' });
    await notifyAffiliation(c, doctor, `${doctor.name} was added to ${c.name} (${speciality}).`);
    return res.json({ success: true, added: true, message: `${doctor.name} added to your clinic` });
  }
  const existing = (c.invites || []).find(i => i.doctorId === doctor.id && i.status === 'invited');
  if (existing) { existing.speciality = speciality; }
  else c.invites.push({ id: `inv-${crypto.randomBytes(5).toString('hex')}`, doctorId: doctor.id, doctorName: doctor.name, phone: doctor.phone, speciality, status: 'invited', createdAt: new Date() });
  c.markModified('invites');
  await c.save();
  await notify({ type: 'doctor', id: doctor.id }, { type: 'invite', title: `${c.name} invited you`, body: `Join ${c.name} as ${speciality}. Open Clinics in your doctor portal to accept.`, link: '/doctor?tab=clinics' });
  res.json({ success: true, invited: true, message: `Invitation sent to ${doctor.name}. They will appear here once they accept.` });
}));

router.delete('/doctors/invites/:id', wrap(async (req, res) => {
  const c = req.auth.clinic;
  const inv = (c.invites || []).find(i => i.id === req.params.id && i.status === 'invited');
  if (!inv) throw httpError(404, 'Invitation not found');
  inv.status = 'cancelled'; inv.respondedAt = new Date();
  c.markModified('invites');
  await c.save();
  res.json({ success: true, message: 'Invitation cancelled' });
}));

router.post('/doctors/create', wrap(async (req, res) => {
  const c = req.auth.clinic;
  const b = req.body || {};
  const name = str(b.name, 80);
  const qualifications = str(b.qualifications, 200);
  const speciality = str(b.speciality, 80);
  if (name.length < 3) throw bad('Doctor name is required');
  if (!qualifications) throw bad('Qualifications are required');
  if (!speciality) throw bad('Choose the speciality / department');
  if (!isValidMobile(b.phone)) throw bad('Enter the doctor\'s 10-digit mobile number (they will use it to sign in)');
  if (await findByPhone(Doctor, b.phone)) throw httpError(409, 'A doctor with this mobile number already exists on FindADoc. Invite them instead.', 'ALREADY_REGISTERED');
  await assertClinicDoctorLimit(c);
  const regNo = str(b.registrationNumber, 40).toUpperCase();
  if (!regNo) throw bad('Medical registration number is required for verification');
  const photo = str(b.photo, 400);
  if (photo && !keyFromPublicUrl(photo)) throw bad('Please upload the doctor photo');
  const exp = parseInt(b.experienceYears, 10);
  const specialities = strList([speciality, ...strList(b.specialities, 4, 60)], 4, 60);
  const doctor = new Doctor({
    id: `doc-${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`,
    name, qualifications, title: `Consultant ${speciality}`,
    photo: photo || DEFAULT_DOCTOR_PHOTO,
    experienceYears: exp >= 0 && exp <= 70 ? exp : 1,
    gender: ['male', 'female', 'other'].includes(b.gender) ? b.gender : '',
    registrationNumber: regNo, councilName: str(b.councilName, 120),
    languages: strList(b.languages, 12, 30),
    bio: str(b.bio, 2000),
    specialities,
    phone: canonicalPhone(b.phone),
    consultationFee: Number(b.fee) >= 0 ? Number(b.fee) : 500,
    status: 'pending', isVerified: false,
    createdByClinicId: c.id,
    state: c.state, stateCode: c.stateCode,
    clinics: [], consultationLocations: []
  });
  doctor.slug = doctorSlug(doctor);
  await doctor.save();
  await affiliateDoctor(c, doctor, { speciality, source: 'created', fee: doctor.consultationFee, schedule: b.schedule });
  await notify({ type: 'clinic', id: c.id }, { type: 'affiliation', title: 'Doctor profile submitted', body: `${name} was added under ${speciality}. The profile becomes bookable after FindADoc admin approval.` });
  res.json({ success: true, doctorId: doctor.id, message: `${name} added. The profile is pending FindADoc verification before patients can book.` });
}));

router.post('/doctors/requests/:doctorId/:action(approve|reject)', wrap(async (req, res) => {
  const c = req.auth.clinic;
  if (!(c.pendingRequests || []).some(r => r.doctorId === req.params.doctorId)) throw httpError(404, 'Request not found');
  const doctor = await Doctor.findOne({ id: req.params.doctorId });
  if (req.params.action === 'reject' || !doctor) {
    c.pendingRequests = c.pendingRequests.filter(r => r.doctorId !== req.params.doctorId);
    await c.save();
    if (doctor) await notify({ type: 'doctor', id: doctor.id }, { type: 'affiliation', title: 'Clinic request declined', body: `${c.name} declined your request to join.` });
    return res.json({ success: true, message: 'Request declined' });
  }
  await affiliateDoctor(c, doctor, { speciality: str(req.body?.speciality, 80) || doctor.specialities?.[0], source: 'request' });
  await notifyAffiliation(c, doctor, `${doctor.name} joined ${c.name}.`);
  res.json({ success: true, message: `${doctor.name} added to your clinic` });
}));

router.put('/doctors/:doctorId', wrap(async (req, res) => {
  const c = req.auth.clinic;
  if (!(c.doctorIds || []).includes(req.params.doctorId)) throw httpError(404, 'Doctor is not part of your clinic');
  const doctor = await Doctor.findOne({ id: req.params.doctorId });
  if (!doctor) throw httpError(404, 'Doctor not found');
  const ep = await effectivePlan(c, 'clinic');
  const b = req.body || {};
  const loc = clinicLocationOf(doctor, c.id);
  if (b.speciality !== undefined) {
    const s = str(b.speciality, 80);
    if (!s) throw bad('Speciality is required');
    const asg = c.doctorAssignments.find(a => a.doctorId === doctor.id);
    if (asg) asg.speciality = s; else c.doctorAssignments.push({ doctorId: doctor.id, speciality: s, addedAt: new Date(), source: 'legacy' });
    c.markModified('doctorAssignments');
    await c.save();
  }
  const ll = c.location?.coordinates?.length === 2 ? { lat: c.location.coordinates[1], lng: c.location.coordinates[0] } : { lat: c.latitude, lng: c.longitude };
  const next = buildLocation({
    kind: 'clinic', clinicId: c.id, name: c.name, phone: c.phone,
    address: c.addressDetails?.city ? c.addressDetails : { line: c.address, city: c.city, state: c.state },
    ...ll,
    speciality: b.speciality ?? loc?.speciality,
    fee: b.fee, bookingMode: b.bookingMode, tokenAmount: b.tokenAmount, schedule: b.schedule,
    autoConfirm: b.autoConfirm, isActive: b.isActive
  }, { existing: loc ? (loc.toObject ? loc.toObject() : loc) : null, managedBy: 'clinic', allowOnlinePayments: ep.limits.onlinePayments, kinds: ['clinic'] });
  next.clinicId = c.id;
  if (loc) Object.assign(loc, next); else doctor.consultationLocations.push(next);
  doctor.markModified('consultationLocations');
  await doctor.save();
  await notify({ type: 'doctor', id: doctor.id }, { type: 'schedule', title: `${c.name} updated your clinic schedule`, body: `Fee ₹${next.fee} • ${next.schedule.days.join(', ')} • ${next.schedule.sessions.map(s => `${s.start}–${s.end}`).join(', ')}` });
  res.json({ success: true, message: 'Schedule & fee saved' });
}));

router.delete('/doctors/:doctorId', wrap(async (req, res) => {
  const c = req.auth.clinic;
  if (!(c.doctorIds || []).includes(req.params.doctorId)) throw httpError(404, 'Doctor is not part of your clinic');
  const doctor = await Doctor.findOne({ id: req.params.doctorId });
  if (doctor) {
    await unaffiliateDoctor(c, doctor);
    await notifyAffiliation(c, doctor, `${doctor.name} was removed from ${c.name}. Existing bookings stay valid.`);
  } else {
    c.doctorIds = c.doctorIds.filter(id => id !== req.params.doctorId);
    await c.save();
  }
  res.json({ success: true, message: 'Doctor removed from your clinic. Existing bookings are not affected.' });
}));

// ---------------- Bookings ----------------
router.get('/bookings', wrap(async (req, res) => {
  res.json(await listBookings({ clinicId: req.auth.clinic.id }, req.query));
}));

router.get('/doctors/:doctorId/availability', wrap(async (req, res) => {
  const c = req.auth.clinic;
  const doctor = await Doctor.findOne({ id: req.params.doctorId });
  const loc = doctor && clinicLocationOf(doctor, c.id);
  if (!loc || loc.isActive === false) throw httpError(404, 'This doctor has no active schedule at your clinic');
  const dates = upcomingDates(loc, loc.schedule?.advanceDays || 14);
  let slots = { date: null, slots: [] };
  if (req.query.date) slots = await availability(doctor, loc, String(req.query.date));
  else for (const d of dates.slice(0, 7)) { // default to the first day that still has an open slot
    const a = await availability(doctor, loc, d);
    if (!slots.date) slots = a;
    if (a.slots?.some(x => x.available)) { slots = a; break; }
  }
  res.json({ locationId: loc.id, dates, ...slots });
}));

router.post('/bookings', wrap(async (req, res) => {
  const c = req.auth.clinic;
  const b = req.body || {};
  if (!(c.doctorIds || []).includes(b.doctorId)) throw bad('Choose a doctor from your clinic');
  const name = str(b.patientName, 120);
  if (name.length < 2) throw bad('Patient name is required');
  if (!isValidMobile(b.patientPhone)) throw bad('Enter the patient\'s 10-digit mobile number');
  const doctor = await Doctor.findOne({ id: b.doctorId });
  const loc = doctor && clinicLocationOf(doctor, c.id);
  if (!loc) throw bad('This doctor has no schedule at your clinic yet');
  let user = await findByPhone(User, b.patientPhone);
  if (user && ['suspended', 'deleted'].includes(user.status)) throw bad('This patient account is not active');
  if (!user) {
    user = await new User({ id: `user-${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`, phone: canonicalPhone(b.patientPhone), name, role: 'patient', status: 'active', isVerified: false, registeredAt: new Date().toISOString().slice(0, 10) }).save();
  }
  const out = await createBooking({ doctor, locationId: loc.id, date: b.date, time: b.time, patient: { userId: user.id, name, phone: user.phone, stateCode: c.stateCode }, note: str(b.note, 500), source: 'clinic' });
  res.json({ success: true, booking: bookingView(out.booking), message: `Booked ${name} with ${doctor.name} on ${b.date} at ${b.time}` });
}));

router.post('/bookings/:id/:action(accept|complete|no-show|cancel)', wrap(async (req, res) => {
  const b = await Booking.findOne({ id: req.params.id, clinicId: req.auth.clinic.id });
  if (!b) throw httpError(404, 'Booking not found');
  if (req.params.action === 'cancel') {
    const reason = str(req.body?.reason, 300);
    if (reason.length < 3) throw bad('Please give a reason for cancelling');
    const out = await cancelBooking(b, { by: 'clinic', reason });
    return res.json({ success: true, booking: bookingView(out.booking), refund: out.refund, message: 'Booking cancelled' + (out.refund.amount ? ` and ₹${out.refund.amount} refunded to the patient.` : '.') });
  }
  const out = await updateBookingStatus(b, req.params.action, 'clinic');
  res.json({ success: true, booking: bookingView(out), message: `Booking ${out.status === 'NoShow' ? 'marked no-show' : out.status.toLowerCase()}` });
}));

router.get('/analytics', wrap(async (req, res) => {
  const ep = await effectivePlan(req.auth.clinic, 'clinic');
  if (!ep.limits.analytics) throw httpError(403, 'Booking analytics is available on Pro and Premium plans.', 'PLAN_FEATURE');
  res.json(await bookingAnalytics({ clinicId: req.auth.clinic.id }));
}));

export default router;
