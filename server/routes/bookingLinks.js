// One-tap manage links from reminders (/appointment/:token in the SPA). The signed token is the credential:
// HMAC-checked, expiring, and bound to booking.linkVersion (any reschedule / cancel invalidates older links).
// Responses expose only what the patient needs (never phone numbers or payment ids).
import express from 'express';
import { Booking, Doctor } from '../models/index.js';
import { verifyBookingLink } from '../lib/links.js';
import { availability, upcomingDates, cancelBooking, rescheduleBooking, findLocation, httpError } from '../lib/bookings.js';
import { getSettings } from '../lib/settings.js';
import { validate, z, zDate, zTime } from '../lib/validate.js';
import { rateLimit } from '../lib/rateLimit.js';
import { wrap } from './common.js';

const router = express.Router();
export default router;
router.use(rateLimit({ name: 'booking-link', windowMs: 10 * 60 * 1000, max: 40, message: 'Too many requests. Please try again later.' }));

const tokenParams = z.object({ token: z.string().min(20).max(400).regex(/^[A-Za-z0-9_\-.]+$/) });

async function load(req) {
  const v = verifyBookingLink(req.params.token);
  if (!v) throw httpError(404, 'This link is not valid', 'LINK_INVALID');
  if (v.expired) throw httpError(410, 'This link has expired. Please sign in to manage your booking.', 'LINK_EXPIRED');
  const b = await Booking.findOne({ id: v.bookingId });
  if (!b || (b.linkVersion || 0) !== v.version) throw httpError(410, 'This link is no longer valid (the booking was changed). Please use the latest message or sign in.', 'LINK_STALE');
  return b;
}

async function view(b) {
  const settings = await getSettings();
  const doctor = await Doctor.findOne({ id: b.doctorId }).select('id consultationLocations').lean();
  const loc = doctor ? findLocation(doctor, b.locationId) : null;
  const active = ['Pending', 'Confirmed'].includes(b.status) && b.slotStart > new Date();
  const hoursLeft = b.slotStart ? (b.slotStart.getTime() - Date.now()) / 3600000 : 0;
  const window = settings.cancellationWindowHours ?? 4;
  return {
    booking: { bookingCode: b.bookingCode, doctorName: b.doctorName, locationName: b.locationName, locationAddress: b.locationAddress, date: b.date, timeSlot: b.timeSlot, status: b.status, patientName: b.forMember?.name || b.patientName.split(' ')[0], amountPaidOnline: b.amountPaidOnline || 0 },
    canCancel: active, canReschedule: active && hoursLeft >= window && (b.rescheduleCount || 0) < 3 && Boolean(loc),
    cancellationWindowHours: window, refundEligible: hoursLeft >= window,
    dates: loc ? upcomingDates(loc, loc.schedule?.advanceDays || 14) : []
  };
}

router.get('/:token', validate({ params: tokenParams }), wrap(async (req, res) => {
  res.json({ success: true, ...(await view(await load(req))) });
}));
router.get('/:token/availability', validate({ params: tokenParams, query: z.object({ date: zDate }) }), wrap(async (req, res) => {
  const b = await load(req);
  const doctor = await Doctor.findOne({ id: b.doctorId });
  const loc = doctor && findLocation(doctor, b.locationId);
  if (!loc) throw httpError(404, 'Location not available');
  const a = await availability(doctor, loc, req.query.date, { forUserId: b.patientUserId });
  res.json({ success: true, date: a.date, slots: a.slots.map(s => ({ time: s.time, available: s.available })) });
}));
router.post('/:token/cancel', validate({ params: tokenParams, body: z.object({ reason: z.string().max(300).optional() }) }), wrap(async (req, res) => {
  const b = await load(req);
  const out = await cancelBooking(b, { by: 'patient', reason: req.body.reason || 'Cancelled from reminder link' });
  await Booking.updateOne({ id: b.id }, { $inc: { linkVersion: 1 } });
  res.json({ success: true, status: out.booking.status, refund: { amount: out.refund.amount, status: out.refund.status }, message: 'Your appointment has been cancelled.' });
}));
router.post('/:token/reschedule', validate({ params: tokenParams, body: z.object({ date: zDate, time: zTime }) }), wrap(async (req, res) => {
  const b = await load(req);
  const out = await rescheduleBooking(b, { date: req.body.date, time: req.body.time, by: 'patient' });
  res.json({ success: true, booking: { date: out.date, timeSlot: out.timeSlot, status: out.status }, message: `Moved to ${out.date} ${out.timeSlot}. A new confirmation is on its way.` });
}));
