// Idempotent data migrations for the platform upgrade (multi-location bookings, plans, geo, slugs).
// Runs on every start; each step only touches rows still in the old shape.
import crypto from 'crypto';
import { Doctor, Clinic, User, Booking, Counter } from '../models/index.js';
import { ensurePlans, effectivePlan } from './plans.js';
import { toPoint, formatAddress } from './geo.js';
import { doctorSlug } from './profiles.js';
import { to24h, isDateStr, isTimeStr, todayIST, addDays, istInstant } from './time.js';

const IST = 330 * 60000;
const once = async (key, fn) => {
  if (await Counter.findOne({ key })) return null;
  const r = await fn();
  await Counter.updateOne({ key }, { $set: { seq: 1 } }, { upsert: true });
  return r;
};
const locId = () => `loc-${crypto.randomBytes(5).toString('hex')}`;
const DEFAULT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function legacySchedule(doc) {
  const slots = [...new Set((doc.availableSlots || []).map(to24h).filter(Boolean))].sort();
  return slots.length
    ? { days: DEFAULT_DAYS, sessions: [], slotMinutes: 30, slots, blockedDates: [], advanceDays: 14 }
    : { days: DEFAULT_DAYS, sessions: [{ start: '10:00', end: '13:00' }, { start: '17:00', end: '20:00' }], slotMinutes: 20, slots: [], blockedDates: [], advanceDays: 14 };
}

function legacyDate(raw, createdAt) {
  if (isDateStr(raw)) return raw;
  const created = createdAt ? new Date(createdAt) : new Date();
  const base = new Date(created.getTime() + IST).toISOString().slice(0, 10);
  const s = String(raw || '').trim();
  if (/^today/i.test(s)) return base;
  if (/^tomorrow/i.test(s)) return addDays(base, 1);
  const m = s.match(/([A-Za-z]{3,9})\s+(\d{1,2})/);
  if (m) {
    const year = Number(base.slice(0, 4));
    for (const y of [year, year + 1]) {
      const t = Date.parse(`${m[1]} ${m[2]}, ${y} 00:00:00 UTC`);
      if (!isNaN(t)) {
        const iso = new Date(t).toISOString().slice(0, 10);
        if (iso >= addDays(base, -1)) return iso;
      }
    }
  }
  const t = Date.parse(s);
  return isNaN(t) ? base : new Date(t + IST).toISOString().slice(0, 10);
}

export async function runPlatformMigrations() {
  const log = [];
  await ensurePlans();

  // 1) Clinics: GeoJSON point, structured address, subscription state, assignments
  const clinics = await Clinic.find({});
  const clinicById = new Map();
  let cFixed = 0;
  for (const c of clinics) {
    clinicById.set(c.id, c);
    let changed = false;
    if (!c.location?.coordinates?.length && c.latitude && c.longitude) { c.location = toPoint(c.latitude, c.longitude); changed = Boolean(c.location) || changed; }
    if (!c.addressDetails?.city && !c.addressDetails?.line) {
      c.addressDetails = { line: c.address || '', area: '', city: c.city || '', district: '', state: c.state || '', pincode: '', landmark: '', formatted: c.address || '' };
      changed = true;
    }
    if (!c.subscription?.planCode) { c.subscription = c.isPremium ? { planCode: 'pro', planName: 'Clinic Pro', startedAt: c.createdAt || new Date(), expiresAt: null, source: 'legacy' } : { planCode: 'basic', planName: 'Clinic Basic', source: 'default' }; changed = true; }
    for (const id of c.doctorIds || []) {
      if (!(c.doctorAssignments || []).some(a => a.doctorId === id)) { c.doctorAssignments.push({ doctorId: id, speciality: '', addedAt: c.createdAt || new Date(), source: 'legacy' }); changed = true; }
    }
    if (changed) { await c.save({ validateBeforeSave: false }); cFixed++; }
  }
  if (cFixed) log.push(`${cFixed} clinics`);

  // 2) Doctors: slug, point, subscription, consultation locations (from legacy clinics + slots)
  const doctors = await Doctor.find({});
  let dFixed = 0, locsMade = 0;
  const legacyLocDone = await Counter.findOne({ key: 'migration:platform-locations-v1' });
  for (const d of doctors) {
    let changed = false;
    if (!d.slug) { d.slug = doctorSlug(d); changed = true; }
    if (!d.location?.coordinates?.length && d.latitude && d.longitude) { d.location = toPoint(d.latitude, d.longitude); changed = Boolean(d.location) || changed; }
    if (!d.subscription?.planCode) { d.subscription = d.isPremium ? { planCode: 'pro', planName: 'Doctor Pro', startedAt: d.createdAt || new Date(), expiresAt: null, source: 'legacy' } : { planCode: 'basic', planName: 'Doctor Basic', source: 'default' }; changed = true; }
    if (!legacyLocDone && !(d.consultationLocations || []).length) {
      const schedule = legacySchedule(d);
      const docPlan = await effectivePlan(d, 'doctor');
      const approved = (d.clinics || []).filter(x => x.isApproved && clinicById.has(x.clinicId));
      for (const a of approved) {
        const c = clinicById.get(a.clinicId);
        const cp = await effectivePlan(c, 'clinic');
        d.consultationLocations.push({
          id: locId(), kind: 'clinic', name: c.name, clinicId: c.id, managedBy: 'clinic', speciality: d.specialities?.[0] || '', phone: c.phone,
          address: c.addressDetails?.city || c.addressDetails?.line ? c.addressDetails : { line: c.address, city: c.city, state: c.state, formatted: c.address },
          location: c.location?.coordinates?.length ? c.location : toPoint(c.latitude, c.longitude),
          schedule, fee: d.consultationFee ?? 500, bookingMode: cp.limits.onlinePayments ? 'paid' : 'free', tokenAmount: 0, autoConfirm: true, isActive: true, createdAt: new Date()
        });
        if (!(c.doctorIds || []).includes(d.id)) { c.doctorIds.push(d.id); c.doctorAssignments.push({ doctorId: d.id, speciality: d.specialities?.[0] || '', addedAt: new Date(), source: 'legacy' }); await c.save({ validateBeforeSave: false }); }
        locsMade++;
      }
      if (!approved.length) {
        const first = (d.clinics || [])[0];
        d.consultationLocations.push({
          id: locId(), kind: 'own_clinic', name: first?.clinicName || `${d.name} — Consultation`, managedBy: 'doctor', speciality: d.specialities?.[0] || '',
          address: { line: first?.address || '', city: d.addressDetails?.city || '', state: d.state || '', formatted: first?.address || '' },
          location: d.location?.coordinates?.length ? d.location : toPoint(d.latitude, d.longitude),
          schedule, fee: d.consultationFee ?? 500, bookingMode: docPlan.limits.onlinePayments ? 'paid' : 'free', tokenAmount: 0, autoConfirm: true, isActive: true, createdAt: new Date()
        });
        locsMade++;
      }
      changed = true;
    }
    if (changed) { await d.save({ validateBeforeSave: false }); dFixed++; }
  }
  if (!legacyLocDone) await Counter.updateOne({ key: 'migration:platform-locations-v1' }, { $set: { seq: 1 } }, { upsert: true });
  if (dFixed) log.push(`${dFixed} doctors (${locsMade} consultation locations created)`);

  // 3) Bookings: ISO date + 24h time, slotStart, patient link, slot locks for future active rows
  const legacy = await Booking.find({ $or: [{ slotStart: { $exists: false } }, { slotStart: null }] }).lean();
  let bFixed = 0;
  const today = todayIST();
  for (const b of legacy) {
    const date = legacyDate(b.date, b.createdAt);
    const time = isTimeStr(b.timeSlot) ? b.timeSlot : (to24h(b.timeSlot) || '10:00');
    const set = { date, timeSlot: time, slotStart: istInstant(date, time) };
    if (!b.bookingMode) { set.bookingMode = 'legacy'; set.source = 'legacy'; set.amountPaidOnline = b.isPaid ? (b.totalAmount || 0) : 0; set.paymentStatus = b.isPaid ? 'paid' : 'pay_at_clinic'; set.payeeType = 'doctor'; set.payeeId = b.doctorId; }
    if (!b.patientUserId && b.patientPhone) {
      const u = await User.findOne({ phone: b.patientPhone }).select('id').lean();
      if (u) set.patientUserId = u.id;
    }
    if (!b.clinicId && b.clinicName) {
      const c = clinics.find(x => x.name === b.clinicName);
      if (c) set.clinicId = c.id;
    }
    await Booking.updateOne({ _id: b._id }, { $set: set });
    if (date >= today && ['Pending', 'Confirmed'].includes(b.status)) {
      try { await Booking.updateOne({ _id: b._id }, { $set: { slotLock: `${b.doctorId}|${date}|${time}` } }); } catch { /* duplicate legacy slot — leave unlocked */ }
    }
    bFixed++;
  }
  if (bFixed) log.push(`${bFixed} bookings normalised`);

  await once('migration:platform-indexes-v1', async () => {
    for (const M of [Doctor, Clinic, Booking]) { try { await M.syncIndexes(); } catch (e) { console.error(`Index sync (${M.modelName}) failed:`, e.message); } }
  });
  if (log.length) console.log(`🛠  Platform migration: ${log.join(', ')}`);
}

// ---------------------------------------------------------------------------
// Phase 3 (Razorpay + security). Safe to run repeatedly; never deletes data.
// ---------------------------------------------------------------------------
export async function runSecurityMigrations() {
  const { Settings, PaymentOrder } = await import('../models/index.js');
  const out = [];
  // 1) payment hold window 15 -> 10 minutes (only if still at the old default; admins can change it afterwards)
  await once('phase3-hold-minutes-10', async () => {
    const r = await Settings.updateMany({ paymentHoldMinutes: 15 }, { $set: { paymentHoldMinutes: 10 } });
    if (r.modifiedCount) out.push('payment hold 15 -> 10 min');
  });
  // 2) refundedAmount on payment orders (derived from the refunds list)
  await once('phase3-order-refunded-amount', async () => {
    const orders = await PaymentOrder.find({ 'refunds.0': { $exists: true } });
    for (const o of orders) {
      const amt = Math.round((o.refunds || []).filter(r => r.status !== 'failed').reduce((s, r) => s + (r.amount || 0), 0) * 100) / 100;
      if (amt && !o.refundedAmount) { o.refundedAmount = amt; await o.save(); }
    }
    if (orders.length) out.push(`refundedAmount backfilled on ${orders.length} order(s)`);
  });
  // 3) unique payment id index — report duplicates instead of failing silently
  const dups = await PaymentOrder.aggregate([
    { $match: { providerPaymentId: { $type: 'string', $gt: '' } } },
    { $group: { _id: '$providerPaymentId', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $limit: 5 }
  ]);
  if (dups.length) out.push(`WARNING: ${dups.length}+ payment id(s) are linked to more than one order — the unique index cannot be built until they are fixed`);
  else await PaymentOrder.createIndexes().catch(e => out.push(`index sync: ${e.message}`));
  return out;
}

/**
 * Phase 4 (idempotent, additive, safe on real data — never deletes or rewrites existing values):
 * 1) registrationVerified backfill from already-verified registration certificates
 * 2) queueStatus default on today's / future bookings (older documents pre-date the field)
 * 3) indexes for the new collections + the one-review-per-booking unique index
 */
export async function runPhase4Migrations() {
  const m = await import('../models/index.js');
  const { todayIST, addDays } = await import('./time.js');
  const out = [];
  await once('phase4-registration-verified-backfill', async () => {
    const r = await m.Doctor.updateMany(
      { registrationVerified: { $ne: true }, registrationNumber: { $type: 'string', $gt: '' }, documents: { $elemMatch: { docType: 'registration_certificate', status: 'verified' } } },
      { $set: { registrationVerified: true, registrationVerifiedAt: new Date() } }
    );
    if (r.modifiedCount) out.push(`registration badge set for ${r.modifiedCount} doctor(s) with a verified certificate`);
  });
  await once('phase4-queue-status-default', async () => {
    const r = await m.Booking.collection.updateMany({ queueStatus: { $exists: false }, date: { $gte: addDays(todayIST(), -1) } }, { $set: { queueStatus: 'waiting' } });
    if (r.modifiedCount) out.push(`queueStatus initialised on ${r.modifiedCount} upcoming booking(s)`);
  });
  const dupReviews = await m.Review.aggregate([{ $match: { bookingId: { $type: 'string', $gt: '' } } }, { $group: { _id: '$bookingId', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $limit: 3 }]);
  if (dupReviews.length) out.push('WARNING: some bookings have more than one review — the one-review-per-booking index was not built');
  else await m.Review.createIndexes().catch(e => out.push(`review index: ${e.message}`));
  for (const name of ['QueueDay', 'ScheduledMessage', 'WaitlistEntry', 'Prescription', 'HealthRecord', 'RecordShare', 'Lab', 'LabTest', 'LabOrder', 'Consent', 'AbhaTxn']) {
    await m[name].createIndexes().catch(e => out.push(`${name} index: ${e.message}`));
  }
  return out;
}
