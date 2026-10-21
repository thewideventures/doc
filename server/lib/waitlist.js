// Waitlist per doctor location + day (optionally a specific time). When a slot frees up, the earliest matching
// entry gets a time-limited exclusive offer (the slot is held for them in availability()). Unclaimed offers
// expire and roll to the next person. offerLock (unique) guarantees one open offer per slot.
import crypto from 'crypto';
import { WaitlistEntry, Doctor, Booking } from '../models/index.js';
import { on } from './events.js';
import { getSettings } from './settings.js';
import { queueMessage } from './messaging/index.js';
import { notify } from './notify.js';
import { config } from './config.js';
import { istInstant } from './time.js';
import log from './logger.js';

const lockKey = (doctorId, date, time) => `${doctorId}|${date}|${time}`;
export const wid = () => `wl-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

async function slotIsFree(doctorId, date, time) {
  return !(await Booking.exists({ doctorId, date, timeSlot: time, slotLock: { $exists: true } }));
}

/** Offer a freed slot to the next waiting patient. Returns the offered entry or null. */
export async function offerFreedSlot({ doctorId, locationId, date, time }) {
  if (!doctorId || !date || !time) return null;
  if (istInstant(date, time).getTime() < Date.now() + 20 * 60000) return null; // too close to be useful
  if (!(await slotIsFree(doctorId, date, time))) return null;
  const doctor = await Doctor.findOne({ id: doctorId }).select('id status bookingEnabled consultationLocations').lean();
  const loc = doctor?.consultationLocations?.find(l => l.id === locationId);
  if (!doctor || doctor.status !== 'active' || doctor.bookingEnabled === false || !loc || loc.isActive === false) return null;
  const settings = await getSettings();
  const minutes = Math.max(5, settings.waitlistOfferMinutes || 15);
  const candidates = await WaitlistEntry.find({ doctorId, locationId, date, status: 'waiting', time: { $in: ['', time] } }).sort({ createdAt: 1 }).limit(20);
  for (const entry of candidates) {
    // Skip people who already hold a booking with this doctor that day
    if (await Booking.exists({ doctorId, date, patientUserId: entry.userId, status: { $in: ['AwaitingPayment', 'Pending', 'Confirmed'] }, ...(entry.memberId ? { 'forMember.id': entry.memberId } : {}) })) {
      await WaitlistEntry.updateOne({ id: entry.id, status: 'waiting' }, { $set: { status: 'cancelled' } });
      continue;
    }
    try {
      const r = await WaitlistEntry.updateOne({ id: entry.id, status: 'waiting' }, {
        $set: { status: 'offered', offeredTime: time, offerExpiresAt: new Date(Date.now() + minutes * 60000), offerLock: lockKey(doctorId, date, time) },
        $inc: { offersMade: 1 }
      });
      if (r.modifiedCount !== 1) continue;
    } catch (e) {
      if (e?.code === 11000) return null; // someone else already holds an offer on this slot
      throw e;
    }
    const link = `${config.appBaseUrl}/?view=my-bookings&waitlist=${encodeURIComponent(entry.id)}`;
    await queueMessage({ kind: 'waitlist_offer', userId: entry.userId, phone: entry.phone, refId: entry.id, params: { doctor: entry.doctorName, when: `${date} ${time}`, minutes, link }, dedupeKey: `waitlist_offer:${entry.id}:${time}:${entry.offersMade + 1}` });
    return WaitlistEntry.findOne({ id: entry.id }).lean();
  }
  return null;
}

/** Expire stale offers and roll the slot to the next person. */
export async function expireWaitlistOffers() {
  const stale = await WaitlistEntry.find({ status: 'offered', offerExpiresAt: { $lt: new Date() } }).limit(200).lean();
  for (const e of stale) {
    const r = await WaitlistEntry.updateOne({ id: e.id, status: 'offered' }, { $set: { status: 'expired' }, $unset: { offerLock: 1 } });
    if (r.modifiedCount === 1) {
      await notify({ type: 'patient', id: e.userId }, { type: 'waitlist', title: 'Waitlist offer expired', body: `The slot with ${e.doctorName} on ${e.date} ${e.offeredTime} was not claimed in time.`, data: { waitlistId: e.id } });
      await offerFreedSlot({ doctorId: e.doctorId, locationId: e.locationId, date: e.date, time: e.offeredTime }).catch(err => log.error('Waitlist re-offer failed', { err: err.message }));
    }
  }
  // Past days: close remaining entries
  const { todayIST } = await import('./time.js');
  await WaitlistEntry.updateMany({ status: 'waiting', date: { $lt: todayIST() } }, { $set: { status: 'expired' } });
  return stale.length;
}

on('slot_freed', slot => offerFreedSlot(slot));
