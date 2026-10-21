// Patient (signed-in) phase-4 features, mounted under /api/me:
// preferences & reminder opt-ins, live queue, reschedule, waitlist, health records / prescriptions / sharing,
// medicine reminders, ABHA linking (optional), DPDP consents, data export and account deletion.
import express from 'express';
import {
  Booking, Doctor, WaitlistEntry, HealthRecord, Prescription, RecordShare, AbhaTxn, User, CONSENT_PURPOSES
} from '../models/index.js';
import { requireUser } from '../lib/userAuth.js';
import { validate, z, zId, zDate, zTime } from '../lib/validate.js';
import { rateLimit, userKey } from '../lib/rateLimit.js';
import { bookingView, rescheduleBooking, createBooking, findLocation, httpError } from '../lib/bookings.js';
import { patientQueue } from '../lib/queue.js';
import { wid } from '../lib/waitlist.js';
import { singleFile, storePrivateUpload } from '../lib/uploadPipeline.js';
import { getStorage, sendPrivateFile } from '../lib/storage/index.js';
import {
  rid, prescriptionForPatient, recordView, consentState, hasConsent, recordConsent,
  scheduleMedicineReminders, cancelMedicineReminders
} from '../lib/records.js';
import { prescriptionPdf, sendPdf } from '../lib/pdf.js';
import { abhaProvider, abhaEnabled, ABHA_NUMBER, ABHA_ADDRESS } from '../lib/abha/index.js';
import { exportUserData, requestDeletion, cancelDeletion, PRIVACY_NOTICE_VERSION, deletionGraceDays } from '../lib/privacy.js';
import { selfUser } from '../lib/profiles.js';
import { stateCodeFromName } from '../lib/gst.js';
import { todayIST, addDays } from '../lib/time.js';
import { config } from '../lib/config.js';
import { cleanText } from '../lib/text.js';
import { wrap, bad } from './common.js';

const router = express.Router();
router.use(requireUser('patient'));
export default router;

const idParams = z.object({ id: zId });
const ownBooking = (req, id) => Booking.findOne({ id, patientUserId: req.auth.uid });
const memberOf = (user, memberId) => {
  if (!memberId) return null;
  const m = (user.familyMembers || []).find(x => x.id === memberId);
  if (!m) throw bad('Family member not found');
  return m;
};
const requireHealthConsent = async uid => {
  if (!(await hasConsent(uid, 'health_data'))) throw httpError(403, 'Please allow FindADoc to store your health records first (Privacy & consent).', 'CONSENT_REQUIRED');
};

// ---------------------------------------------------------------- preferences (language, reminder channels)
router.put('/preferences', validate({ body: z.object({
  preferredLanguage: z.enum(['en', 'ml', 'hi']).optional(),
  whatsapp: z.boolean().optional(), sms: z.boolean().optional(), medicineReminders: z.boolean().optional()
}) }), wrap(async (req, res) => {
  const u = req.auth.user;
  const b = req.body;
  if (b.preferredLanguage) u.preferredLanguage = b.preferredLanguage;
  for (const [k, purpose] of [['whatsapp', 'whatsapp_reminders'], ['sms', 'sms_reminders']]) {
    if (b[k] !== undefined && Boolean(u.notificationPrefs?.[k]) !== b[k]) {
      u.notificationPrefs[k] = b[k];
      await recordConsent(req, u.id, purpose, b[k], { version: PRIVACY_NOTICE_VERSION, method: 'settings' });
    }
  }
  if (b.medicineReminders !== undefined) u.notificationPrefs.medicineReminders = b.medicineReminders;
  u.markModified('notificationPrefs');
  await u.save();
  res.json({ success: true, user: selfUser(u) });
}));

// ---------------------------------------------------------------- live queue + reschedule
router.get('/bookings/:id/queue', rateLimit({ name: 'queue-poll', windowMs: 60 * 1000, max: 30, key: userKey }), validate({ params: idParams }), wrap(async (req, res) => {
  const b = await ownBooking(req, req.params.id);
  if (!b) throw httpError(404, 'Booking not found');
  res.json({ success: true, queue: await patientQueue(b) });
}));

router.post('/bookings/:id/reschedule', rateLimit({ name: 'reschedule', windowMs: 60 * 60 * 1000, max: 10, key: userKey }),
  validate({ params: idParams, body: z.object({ date: zDate, time: zTime }) }), wrap(async (req, res) => {
    const b = await ownBooking(req, req.params.id);
    if (!b) throw httpError(404, 'Booking not found');
    const out = await rescheduleBooking(b, { date: req.body.date, time: req.body.time, by: 'patient' });
    res.json({ success: true, booking: bookingView(out), message: `Moved to ${out.date} ${out.timeSlot}` });
  }));

// ---------------------------------------------------------------- waitlist
router.get('/waitlist', wrap(async (req, res) => {
  const items = await WaitlistEntry.find({ userId: req.auth.uid, status: { $in: ['waiting', 'offered'] } }).sort({ createdAt: -1 }).select('-_id -__v -offerLock -phone').lean();
  res.json({ success: true, items });
}));

router.post('/waitlist', rateLimit({ name: 'waitlist-join', windowMs: 60 * 60 * 1000, max: 20, key: userKey }),
  validate({ body: z.object({ doctorId: zId, locationId: zId, date: zDate, time: zTime.optional().or(z.literal('')), memberId: zId.optional() }) }),
  wrap(async (req, res) => {
    const u = req.auth.user;
    const { doctorId, locationId, date } = req.body;
    const time = req.body.time || '';
    const doctor = await Doctor.findOne({ id: doctorId, status: 'active' }).lean();
    const loc = doctor && findLocation(doctor, locationId);
    if (!loc || loc.isActive === false) throw httpError(404, 'Doctor or location not found');
    const today = todayIST();
    if (date < today || date > addDays(today, loc.schedule?.advanceDays || 14)) throw bad('Choose a date within the booking window');
    const member = memberOf(u, req.body.memberId);
    if (await WaitlistEntry.countDocuments({ userId: u.id, status: { $in: ['waiting', 'offered'] } }) >= 5) throw bad('You can be on at most 5 waitlists at a time');
    if (await WaitlistEntry.exists({ userId: u.id, doctorId, locationId, date, time, memberId: member?.id || '', status: { $in: ['waiting', 'offered'] } })) throw httpError(409, 'You are already on this waitlist', 'ALREADY_WAITLISTED');
    const e = await WaitlistEntry.create({ id: wid(), userId: u.id, phone: u.phone, patientName: member?.name || u.name, memberId: member?.id || '', doctorId, doctorName: doctor.name, locationId, locationName: loc.name, date, time });
    const position = await WaitlistEntry.countDocuments({ doctorId, locationId, date, status: 'waiting', createdAt: { $lte: e.createdAt } });
    res.json({ success: true, entry: { id: e.id, doctorName: e.doctorName, date, time, status: e.status }, position, message: 'Added to the waitlist. We will notify you if a slot frees up.' });
  }));

router.delete('/waitlist/:id', validate({ params: idParams }), wrap(async (req, res) => {
  const r = await WaitlistEntry.updateOne({ id: req.params.id, userId: req.auth.uid, status: { $in: ['waiting', 'offered'] } }, { $set: { status: 'cancelled' }, $unset: { offerLock: 1 } });
  if (!r.modifiedCount) throw httpError(404, 'Waitlist entry not found');
  res.json({ success: true });
}));

// Claim an offered slot (first-come, time-limited). Creates a normal booking (payment flow applies).
router.post('/waitlist/:id/claim', rateLimit({ name: 'waitlist-claim', windowMs: 60 * 60 * 1000, max: 20, key: userKey }), validate({ params: idParams }), wrap(async (req, res) => {
  const u = req.auth.user;
  const e = await WaitlistEntry.findOne({ id: req.params.id, userId: u.id });
  if (!e) throw httpError(404, 'Waitlist entry not found');
  if (e.status !== 'offered' || !e.offerExpiresAt || e.offerExpiresAt < new Date()) throw httpError(410, 'This offer has expired', 'OFFER_EXPIRED');
  const doctor = await Doctor.findOne({ id: e.doctorId });
  const member = e.memberId ? (u.familyMembers || []).find(m => m.id === e.memberId) || null : null;
  const out = await createBooking({
    doctor, locationId: e.locationId, date: e.date, time: e.offeredTime,
    patient: { userId: u.id, name: member?.name || u.name, phone: u.phone, stateCode: u.stateCode || stateCodeFromName(u.addressDetails?.state) },
    forMember: member, source: 'online', waitlistEntryId: e.id
  });
  await WaitlistEntry.updateOne({ id: e.id }, { $set: { status: 'claimed', bookingId: out.booking.id }, $unset: { offerLock: 1 } });
  res.json({ success: true, booking: bookingView(out.booking), payment: out.payment, requiresPayment: Boolean(out.payment), quote: out.quote, message: out.payment ? `Slot held for you. Pay ₹${out.quote.payNow} to confirm.` : 'Appointment booked!' });
}));

// ---------------------------------------------------------------- health records
router.get('/records', validate({ query: z.object({ memberId: z.string().max(60).optional(), type: z.enum(['prescription', 'lab_report', 'document']).optional() }) }), wrap(async (req, res) => {
  const f = { userId: req.auth.uid };
  if (req.query.memberId !== undefined && req.query.memberId !== 'all') f.memberId = req.query.memberId === 'self' ? '' : req.query.memberId;
  if (req.query.type) f.type = req.query.type;
  const items = await HealthRecord.find(f).sort({ date: -1, createdAt: -1 }).limit(300).lean();
  res.json({ success: true, items: items.map(recordView), consent: await hasConsent(req.auth.uid, 'health_data') });
}));

router.post('/records/upload', rateLimit({ name: 'record-upload', windowMs: 60 * 60 * 1000, max: 30, key: userKey, message: 'Upload limit reached. Please try again in an hour.' }), singleFile,
  validate({ body: z.object({ title: z.string().trim().max(120).optional(), date: zDate.optional(), memberId: z.string().max(60).optional(), recordType: z.enum(['lab_report', 'document']).default('lab_report'), notes: z.string().max(500).optional() }) }),
  wrap(async (req, res) => {
    const u = req.auth.user;
    await requireHealthConsent(u.id);
    const member = memberOf(u, req.body.memberId);
    if (await HealthRecord.countDocuments({ userId: u.id }) >= 500) throw bad('Record storage limit reached (500). Delete some old records first.');
    const date = req.body.date && req.body.date <= todayIST() ? req.body.date : todayIST();
    const file = await storePrivateUpload(req, { folder: `records/${u.id}` });
    const rec = await HealthRecord.create({
      id: rid('rec'), userId: u.id, memberId: member?.id || '', type: req.body.recordType, title: cleanText(req.body.title, 120) || file.originalName,
      date, source: 'patient', file, notes: cleanText(req.body.notes, 500)
    });
    res.json({ success: true, record: recordView(rec) });
  }));

router.get('/records/:id/file', validate({ params: idParams }), wrap(async (req, res) => {
  const rec = await HealthRecord.findOne({ id: req.params.id, userId: req.auth.uid }).lean();
  if (!rec?.file?.key) throw httpError(404, 'File not found');
  if (!sendPrivateFile(res, rec.file)) throw httpError(404, 'File not found');
}));

router.delete('/records/:id', validate({ params: idParams }), wrap(async (req, res) => {
  const rec = await HealthRecord.findOne({ id: req.params.id, userId: req.auth.uid });
  if (!rec) throw httpError(404, 'Record not found');
  if (rec.type === 'prescription') throw bad('Prescriptions are written by your doctor and cannot be deleted here');
  if (rec.file?.key) await getStorage().remove(rec.file.key);
  await HealthRecord.deleteOne({ id: rec.id });
  await RecordShare.updateMany({ userId: req.auth.uid }, { $pull: { recordIds: rec.id } });
  res.json({ success: true });
}));

// ---------------------------------------------------------------- prescriptions
router.get('/prescriptions', wrap(async (req, res) => {
  const items = await Prescription.find({ patientUserId: req.auth.uid }).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ success: true, items: items.map(prescriptionForPatient) });
}));
router.get('/prescriptions/:id', validate({ params: idParams }), wrap(async (req, res) => {
  const p = await Prescription.findOne({ id: req.params.id, patientUserId: req.auth.uid }).lean();
  if (!p) throw httpError(404, 'Prescription not found');
  res.json({ success: true, prescription: prescriptionForPatient(p) });
}));
router.get('/prescriptions/:id/pdf', rateLimit({ name: 'pdf', windowMs: 60 * 60 * 1000, max: 60, key: userKey }), validate({ params: idParams }), wrap(async (req, res) => {
  const p = await Prescription.findOne({ id: req.params.id, patientUserId: req.auth.uid }).lean();
  if (!p) throw httpError(404, 'Prescription not found');
  sendPdf(res, await prescriptionPdf(prescriptionForPatient(p)), `prescription-${p.visitDate || p.id}.pdf`);
}));
router.put('/prescriptions/:id/reminders', validate({ params: idParams, body: z.object({ enabled: z.boolean(), whatsapp: z.boolean().default(false), sms: z.boolean().default(false) }) }), wrap(async (req, res) => {
  const p = await Prescription.findOne({ id: req.params.id, patientUserId: req.auth.uid });
  if (!p) throw httpError(404, 'Prescription not found');
  const { enabled, whatsapp, sms } = req.body;
  if (whatsapp && !req.auth.user.notificationPrefs?.whatsapp) await recordConsent(req, req.auth.uid, 'whatsapp_reminders', true, { version: PRIVACY_NOTICE_VERSION, method: 'medicine_reminders', refId: p.id });
  if (sms && !req.auth.user.notificationPrefs?.sms) await recordConsent(req, req.auth.uid, 'sms_reminders', true, { version: PRIVACY_NOTICE_VERSION, method: 'medicine_reminders', refId: p.id });
  let count = 0;
  if (enabled) count = await scheduleMedicineReminders(p, req.auth.user, { whatsapp, sms });
  else await cancelMedicineReminders(p);
  p.reminders = { enabled, whatsapp: enabled && whatsapp, sms: enabled && sms, scheduledCount: count };
  await p.save();
  res.json({ success: true, reminders: p.reminders, message: enabled ? `${count} medicine reminders scheduled` : 'Medicine reminders turned off' });
}));

// ---------------------------------------------------------------- consent-based sharing with the booking's doctor
router.get('/bookings/:id/share', validate({ params: idParams }), wrap(async (req, res) => {
  const b = await ownBooking(req, req.params.id);
  if (!b) throw httpError(404, 'Booking not found');
  const share = await RecordShare.findOne({ bookingId: b.id, userId: req.auth.uid, revokedAt: null, expiresAt: { $gt: new Date() } }).select('-_id -__v').lean();
  res.json({ success: true, share });
}));
router.post('/bookings/:id/share', rateLimit({ name: 'share', windowMs: 60 * 60 * 1000, max: 30, key: userKey }),
  validate({ params: idParams, body: z.object({ allRecords: z.boolean().default(false), recordIds: z.array(zId).max(100).default([]), days: z.coerce.number().int().min(1).max(30).default(7) }) }),
  wrap(async (req, res) => {
    const b = await ownBooking(req, req.params.id);
    if (!b) throw httpError(404, 'Booking not found');
    if (!['Pending', 'Confirmed', 'Completed'].includes(b.status)) throw bad('Records can be shared only for an active or completed booking');
    await requireHealthConsent(req.auth.uid);
    const memberId = b.forMember?.id || '';
    let ids = [];
    if (!req.body.allRecords) {
      const recs = await HealthRecord.find({ id: { $in: req.body.recordIds }, userId: req.auth.uid, memberId }).select('id').lean();
      if (!recs.length) throw bad('Choose at least one record of this patient to share');
      ids = recs.map(r => r.id);
    }
    const base = b.slotStart && b.slotStart > new Date() ? b.slotStart : new Date();
    const expiresAt = new Date(base.getTime() + req.body.days * 86400000);
    await RecordShare.updateMany({ bookingId: b.id, userId: req.auth.uid, revokedAt: null }, { $set: { revokedAt: new Date() } });
    const share = await RecordShare.create({ id: rid('shr'), userId: req.auth.uid, memberId, bookingId: b.id, doctorId: b.doctorId, recordIds: ids, allRecords: req.body.allRecords, expiresAt });
    await recordConsent(req, req.auth.uid, 'record_sharing', true, { version: PRIVACY_NOTICE_VERSION, method: 'share', refId: share.id });
    const o = share.toObject(); delete o._id; delete o.__v;
    res.json({ success: true, share: o, message: `Shared with ${b.doctorName} until ${expiresAt.toISOString().slice(0, 10)}` });
  }));
router.delete('/bookings/:id/share', validate({ params: idParams }), wrap(async (req, res) => {
  const r = await RecordShare.updateMany({ bookingId: req.params.id, userId: req.auth.uid, revokedAt: null }, { $set: { revokedAt: new Date() } });
  if (r.modifiedCount) await recordConsent(req, req.auth.uid, 'record_sharing', false, { version: PRIVACY_NOTICE_VERSION, method: 'share', refId: req.params.id });
  res.json({ success: true, revoked: r.modifiedCount });
}));

// ---------------------------------------------------------------- ABHA (optional)
const abhaLimit = rateLimit({ name: 'abha', windowMs: 60 * 60 * 1000, max: 10, key: userKey, message: 'Too many ABHA attempts. Please try again later.' });
router.get('/abha', wrap(async (req, res) => {
  const a = req.auth.user.abha || {};
  res.json({ success: true, enabled: abhaEnabled(), provider: config.abha.provider, abha: { number: a.number || '', address: a.address || '', status: a.status || 'unlinked', linkedAt: a.linkedAt || null } });
}));
router.post('/abha/init', abhaLimit, validate({ body: z.object({ abhaNumber: z.string().trim().regex(ABHA_NUMBER, 'ABHA number must have 14 digits').optional(), abhaAddress: z.string().trim().regex(ABHA_ADDRESS, 'ABHA address looks like name@abdm').optional() }).refine(v => v.abhaNumber || v.abhaAddress, 'Enter your ABHA number or ABHA address') }),
  wrap(async (req, res) => {
    const provider = abhaProvider();
    const out = await provider.init(req.body);
    const txn = await AbhaTxn.create({ id: rid('abha'), userId: req.auth.uid, provider: config.abha.provider, providerTxnId: out.providerTxnId, abhaNumber: req.body.abhaNumber || '', abhaAddress: req.body.abhaAddress || '', expiresAt: new Date(Date.now() + 10 * 60000) });
    res.json({ success: true, txnId: txn.id, message: out.message });
  }));
router.post('/abha/confirm', abhaLimit, validate({ body: z.object({ txnId: zId, otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit OTP') }) }), wrap(async (req, res) => {
  const provider = abhaProvider();
  const txn = await AbhaTxn.findOne({ id: req.body.txnId, userId: req.auth.uid, expiresAt: { $gt: new Date() } });
  if (!txn) throw httpError(410, 'This ABHA verification has expired. Start again.', 'ABHA_TXN_EXPIRED');
  if (txn.attempts >= 5) throw httpError(429, 'Too many wrong OTPs. Start again.', 'ABHA_TOO_MANY');
  txn.attempts += 1; await txn.save();
  const out = await provider.confirm({ providerTxnId: txn.providerTxnId, otp: req.body.otp, abhaNumber: txn.abhaNumber, abhaAddress: txn.abhaAddress });
  const u = req.auth.user;
  u.abha = { number: out.abhaNumber, address: out.abhaAddress, status: 'linked', linkedAt: new Date(), provider: config.abha.provider };
  u.markModified('abha');
  await u.save();
  await AbhaTxn.deleteOne({ id: txn.id });
  await recordConsent(req, u.id, 'abha_linking', true, { version: PRIVACY_NOTICE_VERSION, method: 'abha' });
  res.json({ success: true, abha: { number: u.abha.number, address: u.abha.address, status: 'linked', linkedAt: u.abha.linkedAt } });
}));
router.delete('/abha', wrap(async (req, res) => {
  const u = req.auth.user;
  u.abha = { number: '', address: '', status: 'unlinked', linkedAt: null, provider: '' };
  u.markModified('abha');
  await u.save();
  await recordConsent(req, u.id, 'abha_linking', false, { version: PRIVACY_NOTICE_VERSION, method: 'abha' });
  res.json({ success: true });
}));

// ---------------------------------------------------------------- DPDP: notice, consents, export, deletion
router.get('/privacy', wrap(async (req, res) => {
  const u = req.auth.user;
  res.json({
    success: true, noticeVersion: PRIVACY_NOTICE_VERSION, acceptedVersion: u.privacyNoticeVersion || '', acceptedAt: u.privacyAcceptedAt || null,
    needsNotice: u.privacyNoticeVersion !== PRIVACY_NOTICE_VERSION, consents: await consentState(u.id),
    deletion: u.deletion?.scheduledFor ? { requestedAt: u.deletion.requestedAt, scheduledFor: u.deletion.scheduledFor } : null,
    graceDays: await deletionGraceDays()
  });
}));

const CONSENT_SETTABLE = CONSENT_PURPOSES.filter(p => !['abha_linking', 'record_sharing'].includes(p));
router.post('/consents', rateLimit({ name: 'consent', windowMs: 60 * 60 * 1000, max: 60, key: userKey }),
  validate({ body: z.object({ consents: z.array(z.object({ purpose: z.enum(CONSENT_SETTABLE), granted: z.boolean() })).min(1).max(10), method: z.enum(['onboarding', 'settings', 'booking']).default('settings') }) }),
  wrap(async (req, res) => {
    const u = req.auth.user;
    for (const c of req.body.consents) {
      if (c.purpose === 'privacy_notice') {
        if (!c.granted) throw bad('The privacy notice must be acknowledged to use FindADoc. To stop using the service, delete your account instead.');
        u.privacyNoticeVersion = PRIVACY_NOTICE_VERSION; u.privacyAcceptedAt = new Date();
      }
      if (c.purpose === 'whatsapp_reminders') u.notificationPrefs.whatsapp = c.granted;
      if (c.purpose === 'sms_reminders') u.notificationPrefs.sms = c.granted;
      if (c.purpose === 'health_data' && !c.granted) {
        // withdrawal: stop sharing immediately (records stay until the patient deletes them or the account)
        await RecordShare.updateMany({ userId: u.id, revokedAt: null }, { $set: { revokedAt: new Date() } });
      }
      await recordConsent(req, u.id, c.purpose, c.granted, { version: PRIVACY_NOTICE_VERSION, method: req.body.method });
    }
    u.markModified('notificationPrefs');
    await u.save();
    res.json({ success: true, consents: await consentState(u.id), user: selfUser(u) });
  }));

router.get('/export', rateLimit({ name: 'data-export', windowMs: 24 * 60 * 60 * 1000, max: 5, key: userKey, message: 'You can download your data 5 times a day.' }), wrap(async (req, res) => {
  const data = await exportUserData(req.auth.user);
  res.setHeader('Content-Disposition', `attachment; filename="findadoc-my-data-${todayIST()}.json"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(data);
}));

router.post('/deletion', rateLimit({ name: 'deletion', windowMs: 24 * 60 * 60 * 1000, max: 5, key: userKey }),
  validate({ body: z.object({ confirm: z.literal('DELETE', { message: 'Type DELETE to confirm' }), reason: z.string().max(300).optional() }) }),
  wrap(async (req, res) => {
    const d = await requestDeletion(req.auth.user, cleanText(req.body.reason, 300));
    res.json({ success: true, deletion: { requestedAt: d.requestedAt, scheduledFor: d.scheduledFor }, message: `Your account will be deleted on ${d.scheduledFor.toISOString().slice(0, 10)}. You can cancel until then.` });
  }));
router.delete('/deletion', wrap(async (req, res) => {
  const d = await cancelDeletion(req.auth.user);
  if (!d) throw httpError(404, 'No pending deletion request');
  res.json({ success: true, message: 'Deletion request cancelled' });
}));

export { User };
