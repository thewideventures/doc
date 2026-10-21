// Doctor portal phase-4 routes (mounted at /api/doctor-portal, doctor session required):
// live queue, digital prescriptions (+ PDF), consent-shared patient records, earnings & invoices.
import express from 'express';
import { Booking, Prescription, HealthRecord, User } from '../models/index.js';
import { requireUser } from '../lib/userAuth.js';
import { validate, z, zId, zDate } from '../lib/validate.js';
import { rateLimit, userKey } from '../lib/rateLimit.js';
import { findLocation, httpError } from '../lib/bookings.js';
import { staffQueue, queueAction } from '../lib/queue.js';
import { rid, ageFrom, prescriptionForDoctor, upsertPrescriptionRecord, scheduleMedicineReminders, activeShare, shareCovers, recordView } from '../lib/records.js';
import { prescriptionPdf, sendPdf } from '../lib/pdf.js';
import { sendPrivateFile } from '../lib/storage/index.js';
import { notify } from '../lib/notify.js';
import { formatAddress } from '../lib/geo.js';
import { todayIST, addDays } from '../lib/time.js';
import { cleanText } from '../lib/text.js';
import { mountEarnings } from './earnings.js';
import { wrap } from './common.js';

const router = express.Router();
router.use(requireUser('doctor'));
export default router;

const idParams = z.object({ id: zId });

// ---------------------------------------------------------------- live queue
export const queueActionSchema = z.object({
  locationId: zId, bookingId: zId.optional(), minutes: z.coerce.number().int().min(0).max(240).optional(), reason: z.string().max(120).optional()
});
const QUEUE_ACTIONS = 'start|pause|resume|close|next|done|skip|recall|delay|avg';

router.get('/queue', validate({ query: z.object({ locationId: zId, date: zDate.optional() }) }), wrap(async (req, res) => {
  const d = req.auth.doctor;
  const loc = findLocation(d, req.query.locationId);
  if (!loc) throw httpError(404, 'Location not found');
  res.json({ success: true, ...(await staffQueue(d.id, loc.id, req.query.date || todayIST(), loc.clinicId || '')) });
}));
router.post(`/queue/:action(${QUEUE_ACTIONS})`, rateLimit({ name: 'queue-action', windowMs: 60 * 1000, max: 120, key: userKey }), validate({ body: queueActionSchema }), wrap(async (req, res) => {
  const d = req.auth.doctor;
  const loc = findLocation(d, req.body.locationId);
  if (!loc) throw httpError(404, 'Location not found');
  res.json({ success: true, ...(await queueAction({ doctorId: d.id, locationId: loc.id, clinicId: loc.clinicId || '' }, req.params.action, req.body, 'doctor')) });
}));

// ---------------------------------------------------------------- prescriptions
const t = (n) => z.string().max(n).default('');
const prescriptionSchema = z.object({
  complaints: t(1000), diagnosis: t(500), visitNotes: t(3000), privateNotes: t(3000), advice: t(2000),
  vitals: z.object({ bp: t(15), pulse: t(15), temperature: t(15), weight: t(15), spo2: t(15) }).partial().default({}),
  medicines: z.array(z.object({
    name: z.string().trim().min(1, 'Medicine name is required').max(120), dosage: t(60), frequency: t(40), timing: t(60),
    durationDays: z.coerce.number().int().min(0).max(365).default(0), instructions: t(200)
  })).max(30).default([]),
  tests: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  followUp: z.object({ afterDays: z.coerce.number().int().min(0).max(365).default(0), date: zDate.optional().or(z.literal('')), note: t(200) }).default({ afterDays: 0, note: '' })
});

async function doctorBooking(req) {
  const b = await Booking.findOne({ id: req.params.id, doctorId: req.auth.doctor.id });
  if (!b) throw httpError(404, 'Booking not found');
  return b;
}
async function patientFacts(b) {
  const u = b.patientUserId ? await User.findOne({ id: b.patientUserId }).select('dob gender familyMembers').lean() : null;
  const m = b.forMember?.id ? (u?.familyMembers || []).find(x => x.id === b.forMember.id) : null;
  const person = m || u || {};
  return { patientName: b.forMember?.name || b.patientName, patientAge: ageFrom(person.dob), patientGender: person.gender || '' };
}

router.get('/bookings/:id/prescription', validate({ params: idParams }), wrap(async (req, res) => {
  const b = await doctorBooking(req);
  const p = await Prescription.findOne({ bookingId: b.id }).lean();
  if (p) return res.json({ success: true, prescription: prescriptionForDoctor(p), exists: true });
  res.json({ success: true, exists: false, prescription: { bookingId: b.id, ...(await patientFacts(b)), visitDate: b.date, medicines: [], tests: [], followUp: { afterDays: 0, note: '' }, vitals: {} } });
}));

router.put('/bookings/:id/prescription', rateLimit({ name: 'rx-save', windowMs: 60 * 60 * 1000, max: 120, key: userKey }), validate({ params: idParams, body: prescriptionSchema }), wrap(async (req, res) => {
  const d = req.auth.doctor;
  const b = await doctorBooking(req);
  if (!['Confirmed', 'Completed'].includes(b.status)) throw httpError(400, 'A prescription can be written only for a confirmed or completed visit', 'BAD_STATUS');
  if (b.date > todayIST()) throw httpError(400, 'You can write the prescription on or after the visit day', 'TOO_EARLY');
  const body = req.body;
  const loc = findLocation(d, b.locationId);
  const followDate = body.followUp.date || (body.followUp.afterDays ? addDays(b.date, body.followUp.afterDays) : '');
  const fields = {
    doctorId: d.id,
    doctor: { name: d.name, qualifications: d.qualifications || '', registrationNumber: d.registrationNumber || '', councilName: d.councilName || '', specialities: d.specialities || [], locationName: b.locationName || loc?.name || '', locationAddress: b.locationAddress || (loc ? formatAddress(loc.address) : '') },
    patientUserId: b.patientUserId || '', memberId: b.forMember?.id || '', ...(await patientFacts(b)), visitDate: b.date,
    complaints: cleanText(body.complaints, 1000), diagnosis: cleanText(body.diagnosis, 500), visitNotes: cleanText(body.visitNotes, 3000), privateNotes: cleanText(body.privateNotes, 3000), advice: cleanText(body.advice, 2000),
    vitals: Object.fromEntries(Object.entries(body.vitals).map(([k, v]) => [k, cleanText(v, 15)])),
    medicines: body.medicines.map(m => ({ name: cleanText(m.name, 120), dosage: cleanText(m.dosage, 60), frequency: cleanText(m.frequency, 40), timing: cleanText(m.timing, 60), durationDays: m.durationDays, instructions: cleanText(m.instructions, 200) })),
    tests: body.tests.map(x => cleanText(x, 120)).filter(Boolean),
    followUp: { afterDays: body.followUp.afterDays, date: followDate, note: cleanText(body.followUp.note, 200) }
  };
  let p = await Prescription.findOne({ bookingId: b.id });
  const isNew = !p;
  if (p) { Object.assign(p, fields); p.version += 1; }
  else p = new Prescription({ id: rid('rx'), bookingId: b.id, ...fields });
  try { await p.save(); } catch (e) { if (e?.code === 11000) throw httpError(409, 'Prescription was just saved from another device. Reload and try again.', 'CONFLICT'); throw e; }
  await upsertPrescriptionRecord(p);
  if (p.reminders?.enabled && p.patientUserId) {
    const u = await User.findOne({ id: p.patientUserId });
    if (u) p.reminders.scheduledCount = await scheduleMedicineReminders(p, u, { whatsapp: p.reminders.whatsapp, sms: p.reminders.sms });
    await p.save();
  }
  if (b.patientUserId) {
    await notify({ type: 'patient', id: b.patientUserId }, {
      type: 'prescription', title: isNew ? 'New prescription' : 'Prescription updated',
      body: `${d.name} ${isNew ? 'shared a prescription' : 'updated your prescription'} for the visit on ${b.date}.${followDate ? ` Follow-up suggested on ${followDate}.` : ''}`,
      data: { bookingId: b.id, prescriptionId: p.id }
    });
  }
  res.json({ success: true, prescription: prescriptionForDoctor(p), message: isNew ? 'Prescription saved and shared with the patient' : 'Prescription updated' });
}));

router.get('/bookings/:id/prescription/pdf', rateLimit({ name: 'pdf', windowMs: 60 * 60 * 1000, max: 60, key: userKey }), validate({ params: idParams }), wrap(async (req, res) => {
  const b = await doctorBooking(req);
  const p = await Prescription.findOne({ bookingId: b.id }).lean();
  if (!p) throw httpError(404, 'No prescription yet');
  const { privateNotes, ...pub } = prescriptionForDoctor(p); // the printable copy never includes private notes
  sendPdf(res, await prescriptionPdf(pub), `prescription-${b.bookingCode}.pdf`);
}));

// ---------------------------------------------------------------- patient records shared for this booking (consent-based)
router.get('/bookings/:id/records', validate({ params: idParams }), wrap(async (req, res) => {
  const b = await doctorBooking(req);
  const share = await activeShare(b.id, req.auth.doctor.id);
  const memberId = b.forMember?.id || '';
  let records = [];
  if (share && b.patientUserId) {
    const f = { userId: b.patientUserId, memberId };
    if (!share.allRecords) f.id = { $in: share.recordIds || [] };
    records = (await HealthRecord.find(f).sort({ date: -1 }).limit(200).lean()).map(recordView);
  }
  // this doctor's own earlier prescriptions for the same patient are always visible to them
  const own = b.patientUserId ? await Prescription.find({ doctorId: req.auth.doctor.id, patientUserId: b.patientUserId, memberId }).sort({ createdAt: -1 }).limit(20).lean() : [];
  res.json({ success: true, shared: Boolean(share), shareExpiresAt: share?.expiresAt || null, records, previousPrescriptions: own.map(prescriptionForDoctor) });
}));

router.get('/bookings/:id/records/:recordId/file', validate({ params: z.object({ id: zId, recordId: zId }) }), wrap(async (req, res) => {
  const b = await doctorBooking(req);
  const share = await activeShare(b.id, req.auth.doctor.id);
  const rec = share ? await HealthRecord.findOne({ id: req.params.recordId, userId: b.patientUserId }).lean() : null;
  if (!rec || !shareCovers(share, rec) || !rec.file?.key) throw httpError(404, 'Record not found or not shared with you');
  if (!sendPrivateFile(res, rec.file)) throw httpError(404, 'File not found');
}));

// ---------------------------------------------------------------- earnings / invoices
mountEarnings(router, async req => ({ type: 'doctor', entity: req.auth.doctor }));
