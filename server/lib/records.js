// Health records: prescriptions, lab reports, documents per patient / family member, consent-based sharing
// with the doctor of a booking, and medicine reminders derived from the prescription schedule.
import crypto from 'crypto';
import { HealthRecord, RecordShare, Prescription, Consent } from '../models/index.js';
import { queueMessage, cancelMessages } from './messaging/index.js';
import { todayIST, addDays, istInstant } from './time.js';

export const rid = p => `${p}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

export function ageFrom(dob, at = new Date()) {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return '';
  const d = new Date(`${dob}T00:00:00Z`);
  let years = at.getUTCFullYear() - d.getUTCFullYear();
  const m = at.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && at.getUTCDate() < d.getUTCDate())) years--;
  if (years >= 1) return `${years} y`;
  const months = Math.max(0, (at.getUTCFullYear() - d.getUTCFullYear()) * 12 + m - (at.getUTCDate() < d.getUTCDate() ? 1 : 0));
  return `${months} m`;
}

/** Patient-facing prescription (doctor's private notes removed). */
export function prescriptionForPatient(p) {
  const o = typeof p.toObject === 'function' ? p.toObject() : { ...p };
  delete o._id; delete o.__v; delete o.privateNotes;
  return o;
}
export function prescriptionForDoctor(p) {
  const o = typeof p.toObject === 'function' ? p.toObject() : { ...p };
  delete o._id; delete o.__v;
  return o;
}
export function recordView(r) {
  const o = typeof r.toObject === 'function' ? r.toObject() : { ...r };
  delete o._id; delete o.__v;
  o.hasFile = Boolean(o.file?.key);
  o.file = o.file?.key ? { mime: o.file.mime, size: o.file.size, originalName: o.file.originalName } : null;
  return o;
}

/** Latest consent state per purpose for a user. */
export async function consentState(userId) {
  const rows = await Consent.aggregate([
    { $match: { userId } }, { $sort: { at: -1 } },
    { $group: { _id: '$purpose', granted: { $first: '$granted' }, at: { $first: '$at' }, version: { $first: '$version' } } }
  ]);
  return Object.fromEntries(rows.map(r => [r._id, { granted: r.granted, at: r.at, version: r.version }]));
}
export async function hasConsent(userId, purpose) {
  const last = await Consent.findOne({ userId, purpose }).sort({ at: -1 }).lean();
  return Boolean(last?.granted);
}
export async function recordConsent(req, userId, purpose, granted, { version = '', method = 'settings', refId = '' } = {}) {
  const ip = String(req?.ip || '').replace(/^::ffff:/, '');
  const masked = ip.includes('.') ? ip.split('.').slice(0, 3).join('.') + '.0' : ip.split(':').slice(0, 3).join(':') + '::';
  return Consent.create({ id: rid('cns'), userId, purpose, granted: Boolean(granted), version, method, refId, ip: ip ? masked : '', userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 160), at: new Date() });
}

/** Can this doctor see this record through an active share on this booking? */
export async function activeShare(bookingId, doctorId) {
  return RecordShare.findOne({ bookingId, doctorId, revokedAt: null, expiresAt: { $gt: new Date() } }).lean();
}
export function shareCovers(share, record) {
  if (!share || !record) return false;
  if ((record.memberId || '') !== (share.memberId || '')) return false;
  return share.allRecords || (share.recordIds || []).includes(record.id);
}

// ---------------------------------------------------------------- medicine reminders
const FREQ = {
  od: ['08:00'], qd: ['08:00'], daily: ['08:00'], once: ['08:00'], bd: ['08:00', '20:00'], bid: ['08:00', '20:00'], twice: ['08:00', '20:00'],
  tds: ['08:00', '14:00', '20:00'], tid: ['08:00', '14:00', '20:00'], qid: ['07:00', '12:00', '17:00', '22:00'], hs: ['21:30'], night: ['21:30']
};
/** Dose times (HH:MM IST) from a frequency like "1-0-1", "1-1-1-1", "BD", "OD", "HS". SOS / PRN => none. */
export function doseTimes(freq) {
  const f = String(freq || '').trim().toLowerCase();
  if (!f || /sos|prn|as needed|stat/.test(f)) return [];
  const m = f.match(/^([0-9½.]+)\s*-\s*([0-9½.]+)\s*-\s*([0-9½.]+)(?:\s*-\s*([0-9½.]+))?$/);
  if (m) {
    const slots = m[4] !== undefined ? ['08:00', '13:00', '18:00', '21:30'] : ['08:00', '14:00', '21:00'];
    return slots.filter((_, i) => m[i + 1] && m[i + 1] !== '0');
  }
  return FREQ[f.replace(/[^a-z]/g, '')] || [];
}

export async function scheduleMedicineReminders(p, user, { whatsapp = false, sms = false } = {}) {
  await cancelMessages({ refId: p.id, kind: 'medicine' });
  const now = Date.now();
  const start = todayIST();
  let count = 0;
  for (const med of p.medicines || []) {
    const times = doseTimes(med.frequency);
    const days = Math.max(1, Math.min(30, Number(med.durationDays) || 0));
    if (!times.length || !med.durationDays) continue;
    // The course starts with the next upcoming dose and runs for days x doses-per-day
    let left = days * times.length;
    for (let d = 0; d <= days && left > 0 && count < 300; d++) {
      const date = addDays(start, d);
      for (const t of times) {
        if (left <= 0) break;
        const at = istInstant(date, t);
        if (at.getTime() <= now + 60000) continue;
        await queueMessage({
          kind: 'medicine', userId: user.id, refId: p.id, sendAt: at,
          params: { medicine: med.name, dosage: med.dosage || '', timing: med.timing || '', _wa: whatsapp, _sms: sms, memberId: p.memberId || '' },
          dedupeKey: `medicine:${p.id}:v${p.version}:${med.name}:${date}:${t}`
        });
        count++; left--;
      }
    }
  }
  return count;
}
export const cancelMedicineReminders = p => cancelMessages({ refId: p.id, kind: 'medicine' });

/** Ensure the prescription appears in the patient's timeline. */
export async function upsertPrescriptionRecord(p) {
  if (!p.patientUserId) return null;
  return HealthRecord.findOneAndUpdate(
    { prescriptionId: p.id },
    { $set: { userId: p.patientUserId, memberId: p.memberId || '', type: 'prescription', title: `Prescription — ${p.doctor?.name || 'Doctor'}`, date: p.visitDate, source: 'doctor', bookingId: p.bookingId, doctorId: p.doctorId, doctorName: p.doctor?.name || '', notes: p.diagnosis || '' }, $setOnInsert: { id: rid('rec'), prescriptionId: p.id } },
    { upsert: true, new: true }
  );
}

export { Prescription };
