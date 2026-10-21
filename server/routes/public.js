// Public + patient-facing API: OTP auth, registration, doctor / clinic discovery,
// availability, bookings, reviews, AI symptom triage and payouts.
import express from 'express';
import { refreshInactiveClinics } from '../lib/profiles.js';
import crypto from 'crypto';
import { Speciality, Clinic, Doctor, User, Booking, Review, SpecialityRequest, PayoutRequest, PUBLIC_REVIEW_FILTER } from '../models/index.js';
import { requireUser, optionalUser, verifiedPhoneFromRequest, issuePhoneProof, issueUserSession } from '../lib/userAuth.js';
import { issueOtp, verifyOtp } from '../lib/otp.js';
import { config } from '../lib/config.js';
import { validate, z, zPhone, zRole } from '../lib/validate.js';
import { rateLimit, clientIp, phoneKey, userKey } from '../lib/rateLimit.js';
import { statusMessage, accountStatusPayload } from '../lib/accounts.js';
import { effectivePlan, withinLimit } from '../lib/plans.js';
import { publicDoctor, publicClinic, selfDoctor, selfClinic, selfUser, doctorSlug, DEFAULT_DOCTOR_PHOTO, activeLocations } from '../lib/profiles.js';
import { normalizeAddress, toPoint, formatAddress, latLng, haversineKm } from '../lib/geo.js';
import { buildLocation, syncDoctorPrimaryLocation } from '../lib/locations.js';
import { availability, upcomingDates, createBooking, bookingView, quote, onlinePaymentsAllowed, findLocation, httpError } from '../lib/bookings.js';
import { getSettings } from '../lib/settings.js';
import { round2, stateCodeFromName, stateCodeFromGstin, isValidGstin, STATE_CODES } from '../lib/gst.js';
import { escapeRegex } from '../lib/http.js';
import { findByPhone, canonicalPhone, isValidMobile, phoneDigits } from '../lib/phone.js';
import { keyFromPublicUrl } from '../lib/storage/index.js';
import { screenReviewText } from '../lib/moderation.js';
import { recalcDoctorRating } from '../lib/reviews.js';
import { notify } from '../lib/notify.js';
import { wrap, str, strList, bad } from './common.js';
import { cleanText } from '../lib/text.js';

const router = express.Router();
// keep the inactive-clinic set fresh so suspended / pending clinics' locations are not offered
router.use((req, res, next) => { refreshInactiveClinics(Clinic).then(() => next(), next); });
export default router;

const ROLES = ['patient', 'doctor', 'clinic'];

// ---------------------------------------------------------------------------
// OTP AUTH
// ---------------------------------------------------------------------------
const sendSchema = z.object({ phone: zPhone, role: zRole.default('patient') });
router.post('/auth/send-otp',
  rateLimit({ name: 'otp-send-ip', windowMs: 10 * 60 * 1000, max: 30, message: 'Too many OTP requests from this network. Please wait 10 minutes.' }),
  rateLimit({ name: 'otp-send-phone', windowMs: 10 * 60 * 1000, max: 5, key: phoneKey, message: 'Too many OTP requests for this number. Please wait 10 minutes and try again.' }),
  validate({ body: sendSchema }),
  wrap(async (req, res) => {
    const { phone, role } = req.body;
    const digits = phoneDigits(phone);
    const r = await issueOtp(digits);
    res.json({
      success: true,
      phone: canonicalPhone(phone), role,
      message: `OTP sent to +91 ${digits.slice(0, 2)}xxxxxx${digits.slice(-2)}${r.demo ? ` (demo mode OTP: ${config.otp.demoCode})` : ''}`,
      expiresIn: r.expiresInSec, resendAfter: r.cooldownSec,
      ...(r.demo ? { testOtp: config.otp.demoCode, demo: true } : {})
    });
  }));

async function checkOtp(phone, otp) {
  return verifyOtp(phoneDigits(phone), otp);
}

const verifyLimits = [
  rateLimit({ name: 'otp-verify-ip', windowMs: 10 * 60 * 1000, max: 40, message: 'Too many attempts from this network. Please wait 10 minutes.' }),
  rateLimit({ name: 'otp-verify-phone', windowMs: 10 * 60 * 1000, max: 10, key: phoneKey, message: 'Too many attempts for this number. Please wait 10 minutes.' })
];

function blockingStatus(kind, doc) {
  const m = statusMessage(kind, doc);
  if (m?.blocking) throw Object.assign(new Error(m.error), { status: 403, code: m.code, reason: m.reason || '' });
}

async function getOrCreateUser(phone, { name, role }) {
  let user = await findByPhone(User, phone);
  if (user) { blockingStatus('user', user); return user; }
  return new User({
    id: `user-${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`,
    phone: canonicalPhone(phone),
    name: name || (role === 'doctor' ? 'Doctor' : role === 'clinic' ? 'Clinic Partner' : 'Patient User'),
    role, status: 'active', isVerified: true,
    registeredAt: new Date().toISOString().slice(0, 10)
  }).save();
}

const verifySchema = z.object({ phone: zPhone, otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit OTP'), name: z.string().max(80).optional(), role: zRole.default('patient') });
router.post('/auth/verify-otp', ...verifyLimits, validate({ body: verifySchema }), wrap(async (req, res) => {
  const { phone, otp, name, role } = req.body;
  await checkOtp(phone, otp);
  const phoneToken = issuePhoneProof(canonicalPhone(phone));
  const existingUser = await findByPhone(User, phone);
  if (existingUser) blockingStatus('user', existingUser);

  if (role === 'doctor' || role === 'clinic') {
    const Model = role === 'doctor' ? Doctor : Clinic;
    const linkedId = role === 'doctor' ? existingUser?.doctorId : existingUser?.clinicId;
    const entity = (linkedId && await Model.findOne({ id: linkedId, status: { $ne: 'deleted' } })) || await findByPhone(Model, phone, { status: { $ne: 'deleted' } }) || await findByPhone(Model, phone);
    if (!entity) {
      return res.status(404).json({ error: role === 'doctor' ? 'No doctor profile is registered with this mobile number. Register your doctor profile to continue.' : 'No clinic is registered with this mobile number. Register your clinic to continue.', code: 'PROFILE_NOT_FOUND', phoneToken, phone: canonicalPhone(phone) });
    }
    blockingStatus(role, entity);
    const user = await getOrCreateUser(phone, { name: entity.name, role });
    if (user.role !== 'admin') { user.role = role; if (role === 'doctor') user.doctorId = entity.id; else user.clinicId = entity.id; }
    user.isVerified = true; user.lastLoginAt = new Date();
    await user.save();
    const ep = await effectivePlan(entity, role);
    const { token, expiresIn } = await issueUserSession(req, res, { user, role, doctorId: role === 'doctor' ? entity.id : '', clinicId: role === 'clinic' ? entity.id : '' });
    return res.json({
      success: true, token, expiresIn, phoneToken, role,
      user: selfUser(user),
      [role]: role === 'doctor' ? selfDoctor(entity, ep) : selfClinic(entity, ep),
      associatedDoctor: role === 'doctor' ? selfDoctor(entity, ep) : null,
      associatedClinic: role === 'clinic' ? selfClinic(entity, ep) : null,
      accountStatus: accountStatusPayload(role, entity)
    });
  }

  const user = await getOrCreateUser(phone, { name: str(name, 80), role: 'patient' });
  if (name && (user.name === 'Patient User' || !user.name)) user.name = str(name, 80);
  user.isVerified = true; user.lastLoginAt = new Date();
  await user.save();
  const { token, expiresIn } = await issueUserSession(req, res, { user, role: 'patient' });
  res.json({ success: true, token, expiresIn, phoneToken, role: 'patient', user: selfUser(user), accountStatus: accountStatusPayload('user', user) });
}));

// Phone-ownership proof for registration flows
router.post('/auth/verify-phone', ...verifyLimits, validate({ body: verifySchema.pick({ phone: true, otp: true }) }), wrap(async (req, res) => {
  const { phone, otp } = req.body;
  await checkOtp(phone, otp);
  res.json({ success: true, phoneToken: issuePhoneProof(canonicalPhone(phone)), phone: canonicalPhone(phone) });
}));

router.get('/auth/session', requireUser(), wrap(async (req, res) => {
  const a = req.auth;
  const out = { role: a.role, user: selfUser(a.user) };
  if (a.doctor) out.doctor = selfDoctor(a.doctor, await effectivePlan(a.doctor, 'doctor'));
  if (a.clinic) out.clinic = selfClinic(a.clinic, await effectivePlan(a.clinic, 'clinic'));
  res.json(out);
}));

async function phoneFromProof(req) {
  const ph = await verifiedPhoneFromRequest(req);
  if (!ph) throw httpError(401, 'Please verify your mobile number with OTP first.', 'PHONE_NOT_VERIFIED');
  return ph;
}

// Account status (used by apps on load)
router.get('/account/status', optionalUser, wrap(async (req, res) => {
  const a = req.auth;
  if (!a) return res.json({ status: 'not_found' });
  const kind = a.role === 'doctor' || a.role === 'clinic' ? a.role : 'user';
  if (['suspended', 'deleted'].includes(a.user.status)) return res.json(accountStatusPayload('user', a.user));
  if (kind === 'user') return res.json(accountStatusPayload('user', a.user));
  const t = a.token;
  const doc = kind === 'doctor' ? await Doctor.findOne({ id: t.did }).lean() : await Clinic.findOne({ id: t.cid }).lean();
  res.json(accountStatusPayload(kind, doc));
}));

// ---------------------------------------------------------------------------
// SPECIALITIES
// ---------------------------------------------------------------------------
router.get('/specialities', wrap(async (req, res) => {
  const specialities = await Speciality.find().sort({ name: 1 }).select('-_id -__v').lean();
  res.json({ success: true, specialities });
}));

router.post('/specialities/request', requireUser('doctor'), rateLimit({ name: 'spec-req', windowMs: 24 * 3600 * 1000, max: 10, key: userKey }), wrap(async (req, res) => {
  const name = str(req.body?.name, 60);
  if (name.length < 3) throw bad('Speciality name is required');
  if (await Speciality.findOne({ name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') } })) throw bad('This speciality already exists — choose it from the list');
  if (await SpecialityRequest.findOne({ name: { $regex: new RegExp(`^${escapeRegex(name)}$`, 'i') }, status: 'pending' })) throw bad('This speciality has already been requested and is awaiting review');
  const d = req.auth.doctor;
  const request = await SpecialityRequest.create({
    id: `req-${Date.now()}`, name, category: str(req.body?.category, 60) || 'General Medicine',
    description: str(req.body?.description, 300) || 'Specialised clinical branch',
    requestedByDoctorId: d.id, doctorName: d.name, status: 'pending', createdAt: new Date().toISOString().slice(0, 10)
  });
  res.json({ success: true, message: 'Speciality request submitted to FindADoc admins for review.', request });
}));

// ---------------------------------------------------------------------------
// DOCTORS (public)
// ---------------------------------------------------------------------------
function distanceFor(doc, user) {
  if (!user) return { distance: null, nearestLocationId: '' };
  let best = null, bestId = '';
  for (const l of activeLocations(doc)) {
    const p = latLng(l.location);
    if (!p) continue;
    const d = haversineKm(user, p);
    if (best === null || d < best) { best = d; bestId = l.id; }
  }
  if (best === null) {
    const p = latLng(doc.location) || (doc.latitude && doc.longitude ? { lat: doc.latitude, lng: doc.longitude } : null);
    if (p) best = haversineKm(user, p);
  }
  return { distance: best, nearestLocationId: bestId };
}

router.get('/doctors', wrap(async (req, res) => {
  const { speciality, sector, minExp, minRating, search, clinicId, sortBy = 'recommended', mode, kind, gender, language } = req.query;
  const query = { status: 'active' };
  const and = [];
  if (speciality && speciality !== 'all') query.specialities = { $regex: new RegExp(escapeRegex(String(speciality)), 'i') };
  if (sector && sector !== 'all') query.sector = sector === 'Government' ? 'Government' : 'Private';
  if (minExp) query.experienceYears = { $gte: parseInt(minExp, 10) || 0 };
  if (minRating) query.rating = { $gte: parseFloat(minRating) || 0 };
  if (gender && ['male', 'female'].includes(gender)) query.gender = gender;
  if (language) query.languages = { $regex: new RegExp(`^${escapeRegex(String(language))}$`, 'i') };
  if (clinicId) and.push({ $or: [{ 'clinics.clinicId': String(clinicId) }, { consultationLocations: { $elemMatch: { clinicId: String(clinicId), isActive: { $ne: false } } } }] });
  if (mode && ['free', 'paid', 'token'].includes(mode)) query.consultationLocations = { $elemMatch: { bookingMode: mode, isActive: { $ne: false } } };
  if (kind && ['clinic', 'own_clinic', 'hospital', 'home_visit', 'online'].includes(kind)) query['consultationLocations.kind'] = kind;
  if (search && String(search).trim()) {
    const re = new RegExp(escapeRegex(String(search).trim()), 'i');
    and.push({ $or: [{ name: re }, { title: re }, { specialities: re }, { qualifications: re }, { 'clinics.clinicName': re }, { 'consultationLocations.name': re }, { 'consultationLocations.address.city': re }, { 'consultationLocations.address.area': re }, { 'consultationLocations.address.pincode': re }, { 'addressDetails.city': re }] });
  }
  if (and.length) query.$and = and;
  const docs = await Doctor.find(query).select('-documents -claimPendingFee -payoutPendingFee -claimedFee -gstin -statusBeforeSuspension -phone -email').limit(500).lean();

  const lat = parseFloat(req.query.userLat), lng = parseFloat(req.query.userLng);
  const user = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const maxKm = parseFloat(req.query.maxKm);
  let results = [];
  for (const d of docs) {
    const ep = await effectivePlan(d, 'doctor');
    const dist = distanceFor(d, user);
    if (user && Number.isFinite(maxKm) && maxKm > 0) {
      const online = activeLocations(d).some(l => l.kind === 'online');
      if ((dist.distance === null || dist.distance > maxKm) && !(online && req.query.includeOnline === 'true')) continue;
    }
    results.push(publicDoctor(d, ep, { distance: dist.distance, nearestLocationId: dist.nearestLocationId, _priority: ep.limits.listingPriority || 0 }));
  }
  const by = {
    recommended: (a, b) => b._priority - a._priority || (b.rating || 0) - (a.rating || 0) || (a.distance ?? 1e9) - (b.distance ?? 1e9),
    distance: (a, b) => (a.distance ?? 1e9) - (b.distance ?? 1e9) || b._priority - a._priority,
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    experience: (a, b) => (b.experienceYears || 0) - (a.experienceYears || 0),
    fee_low: (a, b) => (a.consultationFee || 0) - (b.consultationFee || 0),
    fee_high: (a, b) => (b.consultationFee || 0) - (a.consultationFee || 0)
  };
  results.sort(by[sortBy] || by.recommended);
  results = results.map(({ _priority, ...r }) => r);
  res.json({ success: true, total: results.length, doctors: results });
}));

async function findPublicDoctor(idOrSlug) {
  const key = String(idOrSlug || '').slice(0, 120);
  return Doctor.findOne({ $or: [{ id: key }, { slug: key }] });
}

router.get('/doctors/:id', wrap(async (req, res) => {
  const doctor = await findPublicDoctor(req.params.id);
  if (!doctor || doctor.status === 'deleted') throw httpError(404, 'Doctor not found');
  if (doctor.status === 'suspended') { const m = statusMessage('doctor', doctor); throw Object.assign(new Error(m.error), { status: 403, code: m.code }); }
  if (doctor.status !== 'active') throw httpError(404, 'This doctor profile is not publicly listed yet');
  const ep = await effectivePlan(doctor, 'doctor');
  const reviews = await Review.find({ doctorId: doctor.id, ...PUBLIC_REVIEW_FILTER }).select('-_id -__v -userPhone -badWordsFound -flagReason -moderationNote').sort({ createdAt: -1 }).limit(50).lean();
  const settings = await getSettings();
  const out = publicDoctor(doctor, ep);
  for (const l of out.locations) {
    const raw = findLocation(doctor, l.id);
    l.quote = quote(raw, settings, { paymentsAllowed: await onlinePaymentsAllowed(doctor, raw) });
    l.bookingMode = l.quote.mode;
  }
  const lat = parseFloat(req.query.userLat), lng = parseFloat(req.query.userLng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) for (const l of out.locations) l.distance = l.lat ? haversineKm({ lat, lng }, { lat: l.lat, lng: l.lng }) : null;
  res.json({ success: true, doctor: out, reviews, cancellationWindowHours: settings.cancellationWindowHours ?? 4 });
}));

// Without an explicit date, default to the first upcoming day that still has an open slot
// (late in the evening "today" has only past slots).
async function firstOpenDay(doctor, loc, dates) {
  if (!dates.length) return { date: null, slots: [], reason: 'No upcoming availability' };
  let first = null;
  for (const d of dates.slice(0, 7)) {
    const a = await availability(doctor, loc, d);
    if (!first) first = a;
    if (a.slots?.some(x => x.available)) return a;
  }
  return first;
}

router.get('/doctors/:id/availability', wrap(async (req, res) => {
  const doctor = await findPublicDoctor(req.params.id);
  if (!doctor || doctor.status !== 'active') throw httpError(404, 'Doctor not found');
  const loc = findLocation(doctor, String(req.query.locationId || ''));
  if (!loc || loc.isActive === false) throw httpError(404, 'Consultation location not found');
  const dates = upcomingDates(loc, loc.schedule?.advanceDays || 14);
  const slots = req.query.date ? await availability(doctor, loc, String(req.query.date)) : await firstOpenDay(doctor, loc, dates);
  res.json({ success: true, locationId: loc.id, dates, ...slots });
}));

// Reveal a clinic / hospital business number on an explicit "Call" tap (rate limited against scraping).
router.get('/doctors/:id/locations/:locId/contact', rateLimit({ name: 'contact-reveal', windowMs: 60 * 60 * 1000, max: 30, message: 'Too many contact requests. Please try again later.' }), wrap(async (req, res) => {
  const doctor = await Doctor.findOne({ $or: [{ id: str(req.params.id, 80) }, { slug: str(req.params.id, 80) }], status: 'active' }).select('consultationLocations').lean();
  const loc = (doctor?.consultationLocations || []).find(l => l.id === req.params.locId && l.isActive !== false);
  if (!loc || !['clinic', 'hospital'].includes(loc.kind) || !loc.phone) throw httpError(404, 'No phone number listed for this location');
  res.json({ phone: canonicalPhone(loc.phone) });
}));

// Doctor self-registration (phone verified by OTP; pending admin approval)
router.post('/doctors/register', rateLimit({ name: 'doc-register', windowMs: 60 * 60 * 1000, max: 10 }), wrap(async (req, res) => {
  const phone = await phoneFromProof(req);
  const b = req.body || {};
  const existingUser = await findByPhone(User, phone);
  if (existingUser) blockingStatus('user', existingUser);
  const existing = await findByPhone(Doctor, phone);
  if (existing) { blockingStatus('doctor', existing); throw httpError(409, 'A doctor profile is already registered with this mobile number. Please sign in instead.', 'ALREADY_REGISTERED'); }
  const name = str(b.name, 80);
  if (name.length < 3) throw bad('Please enter your full name');
  const qualifications = str(b.qualifications, 200);
  if (!qualifications) throw bad('Qualifications are required (e.g. MBBS, MD)');
  const registrationNumber = str(b.registrationNumber, 40).toUpperCase();
  if (!/^[A-Z0-9\-/ .]{3,40}$/.test(registrationNumber)) throw bad('Enter your medical council registration number');
  const specialities = strList(b.specialities, 20, 60);
  if (!specialities.length) throw bad('Choose at least one speciality');
  const basic = await effectivePlan({}, 'doctor');
  if (!withinLimit(specialities.length - 1, basic.limits.maxSpecialities)) throw bad(`The Basic plan allows up to ${basic.limits.maxSpecialities} specialities. You can add more after upgrading.`);
  const gstin = str(b.gstin, 15).toUpperCase();
  if (gstin && !isValidGstin(gstin)) throw bad('GSTIN format is invalid (leave blank if not registered)');
  const photo = str(b.photo, 400);
  if (photo && !keyFromPublicUrl(photo)) throw bad('Please upload your profile photo');
  const exp = parseInt(b.experienceYears, 10);
  const fee = Number(b.consultationFee ?? 500);
  if (!(fee >= 0 && fee <= 100000)) throw bad('Fee must be between ₹0 and ₹1,00,000');
  const doctor = new Doctor({
    id: `doc-${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`,
    name, qualifications, registrationNumber,
    title: str(b.title, 100) || `Consultant ${specialities[0]}`,
    councilName: str(b.councilName, 120),
    registrationYear: parseInt(b.registrationYear, 10) || null,
    photo: photo || DEFAULT_DOCTOR_PHOTO,
    experienceYears: exp >= 0 && exp <= 70 ? exp : 0,
    gender: ['male', 'female', 'other'].includes(b.gender) ? b.gender : '',
    sector: b.sector === 'Government' ? 'Government' : 'Private',
    specialities, languages: strList(b.languages, 12, 30), bio: str(b.bio, 2000),
    consultationFee: fee, email: str(b.email, 120),
    phone, status: 'pending', isVerified: false, isPremium: false, bookingEnabled: true,
    gstin, state: str(b.state, 60) || STATE_CODES[stateCodeFromGstin(gstin)] || '',
    rating: 5, reviewCount: 0, clinics: [], consultationLocations: []
  });
  doctor.stateCode = stateCodeFromGstin(gstin) || stateCodeFromName(doctor.state);
  if (b.location && typeof b.location === 'object') {
    const loc = buildLocation({ ...b.location, fee: b.location.fee ?? fee, bookingMode: 'free' }, { managedBy: 'doctor', allowOnlinePayments: false, kinds: ['own_clinic', 'hospital', 'home_visit', 'online'] });
    doctor.consultationLocations.push(loc);
    syncDoctorPrimaryLocation(doctor);
  }
  doctor.slug = doctorSlug(doctor);
  await doctor.save();
  const user = existingUser || await getOrCreateUser(phone, { name, role: 'doctor' });
  if (user.role !== 'admin') { user.role = 'doctor'; user.doctorId = doctor.id; }
  if (!user.name || user.name === 'Patient User') user.name = name;
  await user.save();
  const ep = await effectivePlan(doctor, 'doctor');
  res.json({
    success: true,
    message: 'Profile submitted! It is pending verification by the FindADoc team. Complete your profile and upload your registration certificate to speed up approval.',
    ...(await issueUserSession(req, res, { user, role: 'doctor', doctorId: doctor.id })),
    doctor: selfDoctor(doctor, ep), user: selfUser(user),
    accountStatus: accountStatusPayload('doctor', doctor)
  });
}));

// ---------------------------------------------------------------------------
// CLINICS (public)
// ---------------------------------------------------------------------------
router.post('/clinics/register', rateLimit({ name: 'clinic-register', windowMs: 60 * 60 * 1000, max: 10 }), wrap(async (req, res) => {
  const phone = await phoneFromProof(req);
  const b = req.body || {};
  const existingUser = await findByPhone(User, phone);
  if (existingUser) blockingStatus('user', existingUser);
  const existing = await findByPhone(Clinic, phone);
  if (existing) { blockingStatus('clinic', existing); throw httpError(409, 'A clinic is already registered with this phone number. Please sign in instead.', 'ALREADY_REGISTERED'); }
  const name = str(b.name, 120);
  if (name.length < 3) throw bad('Clinic name is required');
  const a = normalizeAddress(typeof b.address === 'object' && b.address ? b.address : { line: b.address, city: b.city, state: b.state });
  if (!a.city || !(a.line || a.area)) throw bad('Enter the clinic address (street/area and city)');
  const pt = toPoint(b.lat, b.lng);
  const gstin = str(b.gstin, 15).toUpperCase();
  if (gstin && !isValidGstin(gstin)) throw bad('GSTIN format is invalid (leave blank if not registered)');
  const photo = str(b.photo, 400);
  if (photo && !keyFromPublicUrl(photo)) throw bad('Please upload the clinic logo');
  const formatted = formatAddress(a);
  const clinic = new Clinic({
    id: `clinic-${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`,
    name, type: str(b.type, 80) || 'Multi-Speciality Clinic', sector: b.sector === 'Government' ? 'Government' : 'Private',
    address: formatted, addressDetails: { ...a, formatted }, city: a.city,
    phone, email: str(b.email, 120), about: str(b.about, 2000),
    state: a.state || STATE_CODES[stateCodeFromGstin(gstin)] || '', gstin, photo,
    facilities: strList(b.facilities, 30, 60),
    isVerified: false, status: 'pending'
  });
  clinic.stateCode = stateCodeFromGstin(gstin) || stateCodeFromName(clinic.state);
  if (pt) { clinic.location = pt; clinic.latitude = pt.coordinates[1]; clinic.longitude = pt.coordinates[0]; }
  await clinic.save();
  const user = existingUser || await getOrCreateUser(phone, { name, role: 'clinic' });
  if (user.role !== 'admin') { user.role = 'clinic'; user.clinicId = clinic.id; }
  await user.save();
  const ep = await effectivePlan(clinic, 'clinic');
  res.json({
    success: true,
    message: 'Clinic registered! It is pending verification by the FindADoc team.',
    ...(await issueUserSession(req, res, { user, role: 'clinic', clinicId: clinic.id })),
    clinic: selfClinic(clinic, ep), user: selfUser(user),
    accountStatus: accountStatusPayload('clinic', clinic)
  });
}));

router.get('/clinics', wrap(async (req, res) => {
  const { search, sector } = req.query;
  const query = { status: 'active' };
  if (sector && sector !== 'all') query.sector = sector === 'Government' ? 'Government' : 'Private';
  if (search && String(search).trim()) {
    const re = new RegExp(escapeRegex(String(search).trim()), 'i');
    query.$or = [{ name: re }, { address: re }, { city: re }, { 'addressDetails.area': re }, { 'addressDetails.pincode': re }, { facilities: re }];
  }
  const clinics = await Clinic.find(query).limit(300).lean();
  const lat = parseFloat(req.query.userLat), lng = parseFloat(req.query.userLng);
  const user = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const out = [];
  for (const c of clinics) {
    const ep = await effectivePlan(c, 'clinic');
    const p = latLng(c.location) || (c.latitude ? { lat: c.latitude, lng: c.longitude } : null);
    out.push({ ...publicClinic(c, ep, { distance: user && p ? haversineKm(user, p) : null }), _p: ep.limits.listingPriority || 0 });
  }
  out.sort((a, b) => (req.query.sortBy === 'distance' ? (a.distance ?? 1e9) - (b.distance ?? 1e9) : b._p - a._p || (a.distance ?? 1e9) - (b.distance ?? 1e9)));
  res.json({ success: true, clinics: out.map(({ _p, ...c }) => c) });
}));

router.get('/clinics/:id', wrap(async (req, res) => {
  const clinic = await Clinic.findOne({ id: String(req.params.id) }).lean();
  if (!clinic || clinic.status === 'deleted') throw httpError(404, 'Clinic not found');
  if (clinic.status === 'suspended') { const m = statusMessage('clinic', clinic); throw Object.assign(new Error(m.error), { status: 403, code: m.code }); }
  if (clinic.status !== 'active') throw httpError(404, 'This clinic is not publicly listed yet');
  const ep = await effectivePlan(clinic, 'clinic');
  const docs = await Doctor.find({ status: 'active', id: { $in: clinic.doctorIds || [] } }).select('-documents -phone -email -gstin -claimPendingFee -payoutPendingFee -claimedFee').lean();
  const doctors = [];
  for (const d of docs) {
    const asg = (clinic.doctorAssignments || []).find(a => a.doctorId === d.id);
    doctors.push(publicDoctor(d, await effectivePlan(d, 'doctor'), { clinicSpeciality: asg?.speciality || d.specialities?.[0] || '' }));
  }
  res.json({ success: true, clinic: publicClinic(clinic, ep), doctors });
}));

// Legacy unauthenticated mutation endpoints are retired (they allowed anyone to edit any profile / grant PRO).
const gone = (msg) => (req, res) => res.status(410).json({ error: msg, code: 'ENDPOINT_RETIRED' });
router.put('/doctors/:id', gone('Profile updates moved to /api/doctor-portal/profile (sign in required).'));
router.post('/doctors/:id/subscribe-premium', gone('Subscriptions moved to /api/subscriptions/checkout (payment required).'));
router.post('/clinics/:id/subscribe-premium', gone('Subscriptions moved to /api/subscriptions/checkout (payment required).'));
router.post('/doctors/:id/request-clinic', gone('Use /api/doctor-portal/clinics/:clinicId/request (sign in required).'));
router.put('/clinics/:id', gone('Clinic updates moved to /api/clinic-portal/profile (sign in required).'));
router.post('/clinics/:id/approve-doctor', gone('Use /api/clinic-portal/doctors/requests/:doctorId/approve (sign in required).'));
router.post('/clinics/:id/remove-doctor', gone('Use DELETE /api/clinic-portal/doctors/:doctorId (sign in required).'));

// ---------------------------------------------------------------------------
// AI SYMPTOM TRIAGE (keyword based; multilingual keyword lists live on specialities)
// ---------------------------------------------------------------------------
const EMERGENCY = ['emergency', 'severe chest pain', 'chest pain', 'cannot breathe', "can't breathe", 'unconscious', 'paralysis', 'stroke', 'vomiting blood', 'choking', 'bleeding heavily', 'heart attack', 'seizure', 'fits', 'suicide',
  'बेहोश', 'सांस बंद', 'गंभीर', 'दिल का दौरा', 'നെഞ്ചുവേദന', 'ബോധം', 'ശ്വാസം മുട്ടൽ', 'urgencia', 'emergencia'];
const PRIORITY = ['severe', 'high fever', 'breathing', 'blood', 'fracture', 'pregnan', 'infant', 'baby', 'दर्द', 'तेज बुखार', 'കടുത്ത പനി', 'വേദന', 'dolor fuerte'];

router.post('/ai-symptom-triage', rateLimit({ name: 'triage', windowMs: 60 * 1000, max: 30 }), wrap(async (req, res) => {
  const symptomsText = str(req.body?.symptomsText, 1000);
  if (!symptomsText) throw bad('Please describe your symptoms');
  const text = symptomsText.toLowerCase();
  const all = await Speciality.find().lean();
  const scored = all.map(spec => {
    const matched = [];
    let score = 0;
    for (const kw of spec.keywords || []) if (kw && text.includes(String(kw).toLowerCase())) { score += 10; matched.push(kw); }
    if (text.includes(spec.name.toLowerCase())) { score += 20; matched.push(spec.name); }
    return { spec, score, matched };
  }).sort((a, b) => b.score - a.score);
  const top = scored[0]?.score > 0 ? scored[0] : { spec: all.find(s => s.id === 'general_physician') || all[0], score: 0, matched: [] };
  if (!top.spec) throw httpError(503, 'Specialities are not configured yet');
  const alternatives = scored.filter(s => s.score > 0 && s.spec.id !== top.spec.id).slice(0, 2).map(s => ({ id: s.spec.id, name: s.spec.name }));
  let urgencyLevel = 'routine', urgency = 'Routine consultation';
  if (EMERGENCY.some(k => text.includes(k))) { urgencyLevel = 'emergency'; urgency = 'Emergency — go to the nearest hospital / call 112 now'; }
  else if (PRIORITY.some(k => text.includes(k))) { urgencyLevel = 'priority'; urgency = 'See a doctor within 24 hours'; }

  const docs = await Doctor.find({ status: 'active', specialities: { $regex: new RegExp(escapeRegex(top.spec.name), 'i') } })
    .select('-documents -phone -email -gstin -claimPendingFee -payoutPendingFee -claimedFee').limit(60).lean();
  const lat = parseFloat(req.body?.userLat), lng = parseFloat(req.body?.userLng);
  const user = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const ranked = [];
  for (const d of docs) {
    const ep = await effectivePlan(d, 'doctor');
    const dist = distanceFor(d, user);
    ranked.push({ ...publicDoctor(d, ep, { distance: dist.distance, nearestLocationId: dist.nearestLocationId }), _f: ep.limits.featuredInAi ? 1 : 0, _p: ep.limits.listingPriority || 0 });
  }
  ranked.sort((a, b) => b._f - a._f || b._p - a._p || (a.distance ?? 1e9) - (b.distance ?? 1e9) || (b.rating || 0) - (a.rating || 0));
  const matchingDoctors = ranked.slice(0, 6).map(({ _f, _p, ...d }) => d);
  res.json({
    success: true,
    query: symptomsText,
    detectedIllnessCategory: top.spec.name,
    specialityId: top.spec.id,
    alternatives,
    confidence: top.score >= 20 ? 'High' : top.score > 0 ? 'Medium' : 'Low (general screening)',
    matchedKeywords: top.matched,
    urgency, urgencyLevel,
    aiExplanation: top.score > 0
      ? `Your symptoms ("${symptomsText.slice(0, 120)}") match ${top.spec.name}. ${top.spec.description ? `They specialise in ${String(top.spec.description).toLowerCase()}.` : ''}`
      : 'We could not match a specific speciality, so a General Physician is the best first step.',
    nextSteps: urgencyLevel === 'emergency' ? 'Please go to the nearest emergency room or dial 112 immediately. Do not wait for an appointment.' : `Book a verified ${top.spec.name} below.`,
    disclaimer: 'This is guidance, not a diagnosis. Always consult a qualified doctor.',
    matchingDoctorsCount: matchingDoctors.length,
    matchingDoctors
  });
}));

// ---------------------------------------------------------------------------
// BOOKINGS (patient)
// ---------------------------------------------------------------------------
router.get('/bookings/quote', wrap(async (req, res) => {
  const doctor = await findPublicDoctor(req.query.doctorId);
  if (!doctor || doctor.status !== 'active') throw httpError(404, 'Doctor not found');
  const loc = findLocation(doctor, String(req.query.locationId || ''));
  if (!loc) throw httpError(404, 'Location not found');
  const settings = await getSettings();
  res.json({ quote: quote(loc, settings, { paymentsAllowed: await onlinePaymentsAllowed(doctor, loc) }), cancellationWindowHours: settings.cancellationWindowHours ?? 4 });
}));

router.post('/bookings',
  requireUser('patient'),
  rateLimit({ name: 'booking-create', windowMs: 60 * 60 * 1000, max: 20, key: userKey, message: 'Too many booking attempts. Please try again later.' }),
  validate({ body: z.object({
    doctorId: z.string().trim().min(1).max(80), locationId: z.string().trim().max(60).default(''),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid date'), time: z.string().regex(/^\d{2}:\d{2}$/).optional(), timeSlot: z.string().max(10).optional(),
    memberId: z.string().max(60).optional(), patientName: z.string().max(120).optional(), note: z.string().max(500).optional()
  }) }),
  wrap(async (req, res) => {
    const b = req.body;
    const u = req.auth.user;
    const doctor = await Doctor.findOne({ id: str(b.doctorId, 80) });
    if (!doctor) throw httpError(404, 'Doctor not found');
    let forMember = null;
    if (b.memberId) {
      forMember = (u.familyMembers || []).find(m => m.id === b.memberId);
      if (!forMember) throw bad('Family member not found');
    }
    const patientName = forMember ? forMember.name : (str(b.patientName, 120) || u.name);
    if (!patientName || patientName === 'Patient User') throw bad('Please enter the patient name');
    if (!forMember && b.patientName && (u.name === 'Patient User' || !u.name)) { u.name = str(b.patientName, 120); await u.save(); }
    // limit open bookings per patient to prevent slot hoarding
    const open = await Booking.countDocuments({ patientUserId: u.id, status: { $in: ['AwaitingPayment', 'Pending', 'Confirmed'] }, slotStart: { $gte: new Date() } });
    if (open >= 10) throw bad('You have too many upcoming bookings. Please complete or cancel some first.');
    const out = await createBooking({
      doctor, locationId: str(b.locationId, 60), date: str(b.date, 10), time: str(b.time || b.timeSlot, 5),
      patient: { userId: u.id, name: patientName, phone: u.phone, stateCode: u.stateCode || stateCodeFromName(u.addressDetails?.state) },
      forMember, note: cleanText(b.note, 500), source: 'online'
    });
    res.json({
      success: true,
      booking: bookingView(out.booking),
      quote: out.quote,
      payment: out.payment,
      requiresPayment: Boolean(out.payment),
      message: out.payment ? `Slot held for you. Pay ₹${out.quote.payNow} to confirm.` : out.booking.status === 'Pending' ? 'Booking requested — the doctor will confirm shortly.' : 'Appointment booked!'
    });
  }));

// The old GET /api/bookings?phone= leaked any patient's bookings — now only for the signed-in patient.
router.get('/bookings', requireUser('patient'), wrap(async (req, res) => {
  const bookings = await Booking.find({ $or: [{ patientUserId: req.auth.uid }, { patientPhone: req.auth.phone }], status: { $ne: 'Expired' } }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ success: true, bookings: bookings.map(bookingView) });
}));

// ---------------------------------------------------------------------------
// REVIEWS (signed-in patients)
// ---------------------------------------------------------------------------
router.post('/reviews', requireUser('patient'), rateLimit({ name: 'review', windowMs: 24 * 3600 * 1000, max: 10, key: userKey }),
  validate({ body: z.object({ doctorId: z.string().trim().min(1).max(80), rating: z.coerce.number().int().min(1, 'Rating must be between 1 and 5').max(5, 'Rating must be between 1 and 5'), comment: z.string().max(5000).default(''), userName: z.string().max(60).optional() }) }),
  wrap(async (req, res) => {
  const { doctorId, rating, comment } = req.body;
  const r = rating;
  const text = cleanText(comment, 3000);
  if (text.length < 5) throw bad('Please write a few words about your experience');
  const doctor = await Doctor.findOne({ id: str(doctorId, 80) }).lean();
  if (!doctor || doctor.status !== 'active') throw httpError(404, 'Doctor not found');
  const u = req.auth.user;
  if (await Review.findOne({ doctorId: doctor.id, userPhone: u.phone, moderationStatus: { $ne: 'deleted' } })) throw bad('You have already reviewed this doctor');
  const visit = await Booking.findOne({ doctorId: doctor.id, $or: [{ patientUserId: u.id }, { patientPhone: u.phone }], status: { $in: ['Completed', 'Confirmed'] } }).lean();
  const settings = await getSettings();
  const screen = screenReviewText(text, settings);
  const review = await Review.create({
    id: `rev-${Date.now()}`, doctorId: doctor.id, userName: cleanText(req.body?.userName, 60) || u.name || 'Verified Patient', userPhone: u.phone,
    isVerifiedBooking: Boolean(visit), rating: r, comment: text, ...screen,
    sentiment: screen.isFlagged ? 'flagged' : r >= 4 ? 'positive' : r === 3 ? 'neutral' : 'negative',
    moderationStatus: screen.isFlagged ? 'flagged' : 'visible', date: new Date().toISOString().slice(0, 10)
  });
  await recalcDoctorRating(doctor.id);
  const out = review.toObject();
  delete out.badWordsFound; delete out.userPhone; delete out._id;
  res.json({ success: true, moderated: screen.isFlagged, message: screen.isFlagged ? 'Thanks! Your review is awaiting moderation.' : 'Review published!', review: out });
}));

// ---------------------------------------------------------------------------
// PAYOUTS (doctor / clinic, signed in)
// ---------------------------------------------------------------------------
function payoutEntity(auth) {
  return auth.role === 'doctor' ? { entityType: 'doctor', entity: auth.doctor } : { entityType: 'clinic', entity: auth.clinic };
}

router.post('/payouts/request', requireUser('doctor', 'clinic'), rateLimit({ name: 'payout', windowMs: 3600 * 1000, max: 10, key: userKey }), wrap(async (req, res) => {
  const { entityType, entity } = payoutEntity(req.auth);
  const msg = statusMessage(entityType, entity);
  if (msg) throw httpError(403, msg.blocking ? msg.error : 'Payouts are available once your account is verified and active.', msg.code);
  const available = round2(entity.claimPendingFee || 0);
  const raw = req.body?.amount;
  const amt = raw === undefined || raw === null || raw === '' ? available : round2(Number(raw));
  if (!(amt > 0) || !Number.isFinite(amt)) throw bad('No available balance to request a payout for.');
  if (amt > available) throw bad(`Requested amount exceeds available balance (₹${available}).`);
  const open = await PayoutRequest.countDocuments({ entityType, entityId: entity.id, status: { $in: ['Pending', 'Approved'] } });
  if (open >= 3) throw bad('You already have open payout requests. Please wait for them to be processed.');
  // atomic debit: two parallel requests can never take the same balance twice
  const Model = entityType === 'clinic' ? Clinic : Doctor;
  const debited = await Model.findOneAndUpdate({ id: entity.id, claimPendingFee: { $gte: amt } }, { $inc: { claimPendingFee: -amt, payoutPendingFee: amt } }, { returnDocument: 'after' });
  if (!debited) throw bad('Your available balance changed. Please refresh and try again.');
  entity.claimPendingFee = round2(debited.claimPendingFee);
  entity.payoutPendingFee = round2(debited.payoutPendingFee);
  const payout = await PayoutRequest.create({
    id: `pay-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`, referenceCode: `PR-${Date.now().toString(36).toUpperCase()}`,
    entityType, entityId: entity.id, entityName: entity.name, entityPhone: entity.phone || '', amount: amt, status: 'Pending',
    bankDetails: str(req.body?.bankDetails, 300), note: str(req.body?.note, 500), requestedAt: new Date()
  });
  res.json({ success: true, message: `Payout request ${payout.referenceCode} for ₹${payout.amount} submitted for admin approval.`, payout, balance: { available: entity.claimPendingFee, inProcess: entity.payoutPendingFee, paidOut: entity.claimedFee } });
}));

router.get('/payouts', requireUser('doctor', 'clinic'), wrap(async (req, res) => {
  const { entityType, entity } = payoutEntity(req.auth);
  const payouts = await PayoutRequest.find({ entityType, entityId: entity.id }).sort({ createdAt: -1 }).limit(50).select('-_id -__v -entityPhone').lean();
  res.json({ success: true, payouts, balance: { available: entity.claimPendingFee || 0, inProcess: entity.payoutPendingFee || 0, paidOut: entity.claimedFee || 0 } });
}));
router.post('/doctors/:id/claim-fee', gone('Use POST /api/payouts/request (sign in required).'));
