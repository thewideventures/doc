// DPDP Act 2023: data export, deletion request with grace period, then anonymisation.
// Retained after deletion (legal obligations):
//  - LedgerTransaction (GST invoices / credit notes) and PaymentOrder rows: CGST Act s.35/36 — 72 months.
//    They keep the invoice party name / phone exactly as issued; nothing else links back to the profile.
//  - Prescriptions written by doctors: de-identified (name -> "Deleted user", user link removed) and kept as the
//    doctor's clinical record (NMC regulations require doctors to retain records for 3 years).
//  - Consent records: kept (pseudonymous user id only) as evidence of lawful processing.
// Everything else (profile, family members, uploaded files, health records, shares, waitlist, reminders,
// notifications, reviews, ABHA link, sessions) is erased or anonymised.
import crypto from 'crypto';
import {
  User, Booking, Review, Prescription, HealthRecord, RecordShare, WaitlistEntry, ScheduledMessage, Notification,
  LabOrder, PaymentOrder, LedgerTransaction, Consent, AbhaTxn, AuthSession
} from '../models/index.js';
import { getStorage, keyFromPublicUrl } from './storage/index.js';
import { cancelBooking, bookingView } from './bookings.js';
import { recalcDoctorRating } from './reviews.js';
import { prescriptionForPatient, recordView } from './records.js';
import { getSettings } from './settings.js';
import { config } from './config.js';
import log from './logger.js';

export const PRIVACY_NOTICE_VERSION = '2026-10';
export const DELETED_NAME = 'Deleted user';

export async function deletionGraceDays() {
  if (config.deletionGraceDays !== null && config.deletionGraceDays !== undefined) return config.deletionGraceDays;
  return (await getSettings()).deletionGraceDays ?? 30;
}

const clean = o => { if (!o) return o; const x = typeof o.toObject === 'function' ? o.toObject() : { ...o }; delete x._id; delete x.__v; return x; };

/** Everything we hold about the patient, as JSON (files are listed; download them from the app). */
export async function exportUserData(user) {
  const uid = user.id;
  const [bookings, prescriptions, records, labOrders, reviews, consents, notifications, waitlist, payments, invoices, shares] = await Promise.all([
    Booking.find({ patientUserId: uid }).sort({ createdAt: -1 }).lean(),
    Prescription.find({ patientUserId: uid }).sort({ createdAt: -1 }).lean(),
    HealthRecord.find({ userId: uid }).sort({ createdAt: -1 }).lean(),
    LabOrder.find({ userId: uid }).sort({ createdAt: -1 }).lean(),
    Review.find({ $or: [{ userId: uid }, { userPhone: user.phone }] }).lean(),
    Consent.find({ userId: uid }).sort({ at: -1 }).lean(),
    Notification.find({ recipientType: 'patient', recipientId: uid }).sort({ createdAt: -1 }).limit(500).lean(),
    WaitlistEntry.find({ userId: uid }).lean(),
    PaymentOrder.find({ partyType: 'patient', partyId: uid }).select('id purpose refId amount currency status provider paidAt createdAt refundedAmount').lean(),
    LedgerTransaction.find({ partyType: 'patient', partyId: uid }).select('invoiceNumber documentType txnDate description taxableValue totalTax invoiceValue passThroughAmount totalAmount status').lean(),
    RecordShare.find({ userId: uid }).lean()
  ]);
  const profile = clean(user);
  delete profile.statusBeforeSuspension;
  return {
    exportedAt: new Date().toISOString(),
    format: 'FindADoc data export v1 (DPDP Act 2023, section 11 — right to access)',
    profile,
    bookings: bookings.map(b => { const v = bookingView(b); delete v.directionsUrl; return v; }),
    prescriptions: prescriptions.map(prescriptionForPatient),
    healthRecords: records.map(recordView),
    recordShares: shares.map(clean),
    labOrders: labOrders.map(clean),
    reviews: reviews.map(r => { const x = clean(r); delete x.badWordsFound; return x; }),
    consents: consents.map(clean),
    waitlist: waitlist.map(clean),
    payments: payments.map(clean),
    invoices: invoices.map(clean),
    notifications: notifications.map(clean)
  };
}

export async function requestDeletion(user, reason = '') {
  const days = await deletionGraceDays();
  const now = new Date();
  user.deletion = { requestedAt: now, scheduledFor: new Date(now.getTime() + days * 86400000), reason: String(reason || '').slice(0, 300), cancelledAt: null, completedAt: null };
  user.markModified('deletion');
  await user.save();
  return user.deletion;
}

export async function cancelDeletion(user) {
  if (!user.deletion?.scheduledFor || user.anonymisedAt) return null;
  user.deletion = { ...user.deletion.toObject?.() ?? user.deletion, scheduledFor: null, cancelledAt: new Date() };
  user.markModified('deletion');
  await user.save();
  return user.deletion;
}

async function removeFile(key) { if (key) await getStorage().remove(key).catch(() => {}); }
async function removePublicUrl(url) { const k = keyFromPublicUrl(url); if (k) await removeFile(k); }

/** Irreversibly anonymise a patient account (keeps GST / payment records as required by law). */
export async function anonymiseUser(user) {
  if (user.anonymisedAt) return false;
  const uid = user.id;
  const tag = crypto.createHash('sha256').update(`del:${uid}`).digest('hex').slice(0, 10);
  // 1. cancel upcoming bookings (system cancel => full refund of anything paid online)
  const upcoming = await Booking.find({ patientUserId: uid, status: { $in: ['AwaitingPayment', 'Pending', 'Confirmed'] }, slotStart: { $gt: new Date() } });
  for (const b of upcoming) await cancelBooking(b, { by: 'system', reason: 'Patient account deleted' }).catch(e => log.error('Cancel on deletion failed', { bookingId: b.id, err: e.message }));
  // 2. bookings: keep the financial skeleton, drop identity
  await Booking.updateMany({ patientUserId: uid }, { $set: { patientName: DELETED_NAME, patientPhone: `deleted-${tag}`, patientNote: '', 'forMember.name': '', anonymised: true } });
  // 3. reviews: removed (free text may contain personal data); ratings recalculated
  const reviews = await Review.find({ $or: [{ userId: uid }, { userPhone: user.phone }] }).select('doctorId').lean();
  await Review.updateMany({ $or: [{ userId: uid }, { userPhone: user.phone }] }, { $set: { userName: 'Former patient', userPhone: '', userId: '', comment: '', moderationStatus: 'deleted' } });
  for (const d of new Set(reviews.map(r => r.doctorId))) await recalcDoctorRating(d).catch(() => {});
  // 4. health records + files
  const recs = await HealthRecord.find({ userId: uid }).lean();
  for (const r of recs) await removeFile(r.file?.key);
  await HealthRecord.deleteMany({ userId: uid });
  await RecordShare.deleteMany({ userId: uid });
  // 5. prescriptions: de-identified, retained for the doctor's statutory record
  await Prescription.updateMany({ patientUserId: uid }, { $set: { patientUserId: '', patientName: DELETED_NAME, memberId: '', retainedForLegal: true, reminders: { enabled: false, whatsapp: false, sms: false, scheduledCount: 0 } } });
  // 6. lab orders: keep amounts / invoice numbers, drop identity + address
  await LabOrder.updateMany({ userId: uid }, { $set: { patientName: DELETED_NAME, patientPhone: '', address: {}, anonymised: true } });
  // 6b. GST ledger: invoices / credit notes are retained (CGST Act s.36) with amounts and numbers intact; the buyer's
  //     name and phone are removed (not mandatory on B2C invoices). partyId stays as a pseudonymous key.
  await LedgerTransaction.updateMany({ partyType: 'patient', partyId: uid }, { $set: { partyName: DELETED_NAME, partyPhone: '' } });
  // 7. transient data
  await Promise.all([
    WaitlistEntry.deleteMany({ userId: uid }),
    ScheduledMessage.deleteMany({ userId: uid }),
    Notification.deleteMany({ recipientType: 'patient', recipientId: uid }),
    AbhaTxn.deleteMany({ userId: uid }),
    AuthSession.updateMany({ kind: 'user', subject: uid, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'account deleted' } })
  ]);
  // 8. profile
  await removePublicUrl(user.photo);
  for (const m of user.familyMembers || []) await removePublicUrl(m.photo);
  const now = new Date();
  await User.collection.updateOne({ id: uid }, {
    $set: {
      phone: `deleted-${tag}`, name: DELETED_NAME, email: '', dob: '', gender: '', bloodGroup: '', photo: '', state: '', stateCode: '',
      addressDetails: {}, familyMembers: [], abha: { number: '', address: '', status: 'unlinked', linkedAt: null, provider: '' },
      notificationPrefs: { whatsapp: false, sms: false, medicineReminders: false }, status: 'deleted', deletedAt: now, statusUpdatedAt: now,
      anonymisedAt: now, 'deletion.completedAt': now, 'deletion.reason': ''
    },
    $unset: { location: '' }
  });
  log.info('Patient account anonymised (DPDP deletion)', { userId: uid });
  return true;
}

export async function sweepDeletions() {
  const due = await User.find({ 'deletion.scheduledFor': { $ne: null, $lte: new Date() }, anonymisedAt: null }).limit(20);
  let n = 0;
  for (const u of due) { try { if (await anonymiseUser(u)) n++; } catch (e) { log.error('Anonymisation failed', { userId: u.id, err: e.message }); } }
  return n;
}
