// Consultation-location validation + clinic ↔ doctor affiliation helpers.
import crypto from 'crypto';
import { LOCATION_KINDS, BOOKING_MODES, Booking, Doctor } from '../models/index.js';
import { normalizeAddress, toPoint, formatAddress, latLng } from './geo.js';
import { validateSchedule } from './time.js';
import { effectivePlan, withinLimit } from './plans.js';
import { notify } from './notify.js';
import { httpError } from './bookings.js';

export const LOCATION_LABEL = { clinic: 'Clinic', own_clinic: 'Own clinic', hospital: 'Hospital', home_visit: 'Home visit', online: 'Online / tele-consult' };

const num = (v, d = 0) => (v === '' || v === null || v === undefined ? d : Number(v));

/** Validate a location payload. `allowOnlinePayments` comes from the governing plan. */
export function buildLocation(input = {}, { existing = null, managedBy = 'doctor', allowOnlinePayments = false, kinds = LOCATION_KINDS } = {}) {
  const kind = input.kind ?? existing?.kind ?? 'own_clinic';
  if (!kinds.includes(kind)) throw httpError(400, 'Choose a valid location type');
  const name = String(input.name ?? existing?.name ?? '').trim().slice(0, 120) || (kind === 'online' ? 'Online consultation' : kind === 'home_visit' ? 'Home visit' : '');
  if (!name) throw httpError(400, 'Location name is required');
  const address = kind === 'online' ? normalizeAddress({}) : normalizeAddress(input.address ?? existing?.address ?? {});
  const point = kind === 'online' ? undefined : (input.lat !== undefined || input.lng !== undefined ? toPoint(input.lat, input.lng) : existing?.location);
  if (['own_clinic', 'hospital', 'clinic'].includes(kind)) {
    if (!address.city || !(address.line || address.area || address.formatted)) throw httpError(400, 'Enter the full address (street/area and city) for this location');
    if (!point) throw httpError(400, 'Pick the exact location on the map');
  }
  if (kind === 'home_visit' && !address.city) throw httpError(400, 'Enter the city / area you cover for home visits');
  const fee = num(input.fee, existing?.fee ?? 500);
  if (!(fee >= 0 && fee <= 100000)) throw httpError(400, 'Consultation fee must be between ₹0 and ₹1,00,000');
  const bookingMode = input.bookingMode ?? existing?.bookingMode ?? 'free';
  if (!BOOKING_MODES.includes(bookingMode)) throw httpError(400, 'Invalid booking mode');
  if (bookingMode !== 'free' && !allowOnlinePayments) throw httpError(403, 'Collecting payments online (Paid / Booking amount) needs a Pro or Premium plan. Choose "Free booking" or upgrade.', 'PLAN_FEATURE');
  if (bookingMode !== 'free' && fee <= 0) throw httpError(400, 'Set a consultation fee above ₹0 to collect payments online');
  let tokenAmount = 0;
  if (bookingMode === 'token') {
    tokenAmount = num(input.tokenAmount, existing?.tokenAmount ?? 100);
    if (!(tokenAmount >= 1 && tokenAmount < fee)) throw httpError(400, 'Booking amount must be at least ₹1 and less than the consultation fee');
  }
  const schedule = validateSchedule(input.schedule ?? existing?.schedule ?? {});
  const radius = kind === 'home_visit' ? Math.min(100, Math.max(1, num(input.serviceRadiusKm, existing?.serviceRadiusKm ?? 5))) : 0;
  const phone = String(input.phone ?? existing?.phone ?? '').trim().slice(0, 20);
  return {
    id: existing?.id || `loc-${crypto.randomBytes(5).toString('hex')}`,
    kind, name, managedBy,
    clinicId: existing?.clinicId || input.clinicId || '',
    speciality: String(input.speciality ?? existing?.speciality ?? '').slice(0, 80),
    phone,
    address: { ...address, formatted: address.formatted || formatAddress(address) },
    location: point,
    serviceRadiusKm: radius,
    schedule, fee, bookingMode, tokenAmount,
    autoConfirm: input.autoConfirm !== undefined ? Boolean(input.autoConfirm) : existing?.autoConfirm !== false,
    isActive: input.isActive !== undefined ? Boolean(input.isActive) : existing?.isActive !== false,
    notes: String(input.notes ?? existing?.notes ?? '').slice(0, 300),
    createdAt: existing?.createdAt || new Date()
  };
}

/** Keep doctor's top-level location (used for distance / legacy fields) in sync with its first mapped location. */
export function syncDoctorPrimaryLocation(doctor) {
  const first = (doctor.consultationLocations || []).find(l => l.isActive !== false && l.location?.coordinates?.length === 2);
  if (first) {
    doctor.location = first.location;
    const ll = latLng(first.location);
    doctor.latitude = ll.lat; doctor.longitude = ll.lng;
    if (!doctor.addressDetails?.city && first.address?.city) doctor.addressDetails = first.address;
  }
}

export async function countSelfManaged(doctor) {
  return (doctor.consultationLocations || []).filter(l => l.managedBy !== 'clinic' && l.isActive !== false).length;
}

export async function assertDoctorLocationLimit(doctor) {
  const ep = await effectivePlan(doctor, 'doctor');
  const count = await countSelfManaged(doctor);
  if (!withinLimit(count, ep.limits.maxLocations)) {
    throw httpError(403, `Your ${ep.plan.name} plan allows ${ep.limits.maxLocations} active consultation location${ep.limits.maxLocations === 1 ? '' : 's'}. Upgrade your plan to add more.`, 'PLAN_LIMIT');
  }
  return ep;
}

export async function hasFutureBookings(doctorId, locationId) {
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  return Booking.exists({ doctorId, locationId, date: { $gte: today }, status: { $in: ['AwaitingPayment', 'Pending', 'Confirmed'] } });
}

/** Number of doctors attached to a clinic (for plan limits). */
// Counts the union of clinic.doctorIds and doctors whose profile lists the clinic (legacy / seeded
// affiliations may only exist on the doctor side), excluding deleted doctors.
export function clinicDoctorFilter(clinic, statuses = { $nin: ['deleted'] }) {
  return { status: statuses, $or: [{ 'clinics.clinicId': clinic.id }, { id: { $in: clinic.doctorIds || [] } }] };
}
export async function clinicDoctorCount(clinic) {
  // rejected profiles do not occupy a plan seat
  const linked = await Doctor.find(clinicDoctorFilter(clinic, { $nin: ['deleted', 'rejected'] }), { id: 1 }).lean();
  return new Set(linked.map(d => d.id)).size;
}

export async function assertClinicDoctorLimit(clinic, extra = 1) {
  const ep = await effectivePlan(clinic, 'clinic');
  const count = (await clinicDoctorCount(clinic)) + extra - 1;
  if (!withinLimit(count, ep.limits.maxDoctors)) {
    throw httpError(403, `Your ${ep.plan.name} plan allows up to ${ep.limits.maxDoctors} doctors. Upgrade to add more.`, 'PLAN_LIMIT');
  }
  return ep;
}

/** Attach a doctor to a clinic: roster + a clinic-managed consultation location. */
export async function affiliateDoctor(clinic, doctor, { speciality = '', source = 'invite', fee, schedule } = {}) {
  if (!(clinic.doctorIds || []).includes(doctor.id)) await assertClinicDoctorLimit(clinic);
  clinic.pendingRequests = (clinic.pendingRequests || []).filter(r => r.doctorId !== doctor.id);
  if (!clinic.doctorIds.includes(doctor.id)) clinic.doctorIds.push(doctor.id);
  const spec = speciality || doctor.specialities?.[0] || '';
  const asg = (clinic.doctorAssignments || []).find(a => a.doctorId === doctor.id);
  if (asg) asg.speciality = spec;
  else clinic.doctorAssignments.push({ doctorId: doctor.id, speciality: spec, addedAt: new Date(), source });
  clinic.markModified('doctorAssignments');
  await clinic.save();

  const idx = (doctor.clinics || []).findIndex(c => c.clinicId === clinic.id);
  const entry = { clinicId: clinic.id, clinicName: clinic.name, address: clinic.address, isApproved: true };
  if (idx >= 0) doctor.clinics[idx] = entry; else doctor.clinics.push(entry);

  const existing = (doctor.consultationLocations || []).find(l => l.kind === 'clinic' && l.clinicId === clinic.id);
  const base = {
    kind: 'clinic', clinicId: clinic.id, name: clinic.name, speciality: spec, phone: clinic.phone,
    address: clinic.addressDetails?.city ? clinic.addressDetails : { line: clinic.address, city: clinic.city || '', state: clinic.state || '' },
    fee: fee ?? existing?.fee ?? doctor.consultationFee ?? 500,
    bookingMode: existing?.bookingMode || 'free',
    schedule: schedule || existing?.schedule || { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], sessions: [{ start: '10:00', end: '13:00' }], slotMinutes: 20 },
    isActive: true
  };
  const point = clinic.location?.coordinates?.length === 2 ? clinic.location : toPoint(clinic.latitude, clinic.longitude);
  const ll = latLng(point);
  const loc = buildLocation({ ...base, lat: ll?.lat, lng: ll?.lng }, { existing, managedBy: 'clinic', allowOnlinePayments: true, kinds: ['clinic'] });
  loc.clinicId = clinic.id;
  if (existing) Object.assign(existing, loc); else doctor.consultationLocations.push(loc);
  doctor.markModified('consultationLocations');
  syncDoctorPrimaryLocation(doctor);
  await doctor.save();
  return loc;
}

export async function unaffiliateDoctor(clinic, doctor) {
  clinic.doctorIds = (clinic.doctorIds || []).filter(id => id !== doctor.id);
  clinic.doctorAssignments = (clinic.doctorAssignments || []).filter(a => a.doctorId !== doctor.id);
  clinic.pendingRequests = (clinic.pendingRequests || []).filter(r => r.doctorId !== doctor.id);
  await clinic.save();
  doctor.clinics = (doctor.clinics || []).filter(c => c.clinicId !== clinic.id);
  for (const l of doctor.consultationLocations || []) if (l.kind === 'clinic' && l.clinicId === clinic.id) l.isActive = false;
  doctor.markModified('consultationLocations');
  await doctor.save();
}

export async function notifyAffiliation(clinic, doctor, text) {
  await notify([{ type: 'doctor', id: doctor.id }, { type: 'clinic', id: clinic.id }], { type: 'affiliation', title: 'Clinic affiliation updated', body: text });
}
