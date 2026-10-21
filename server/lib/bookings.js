// Booking engine: availability, pricing per booking mode, slot locking, payment confirmation,
// status changes and cancellation / refund (with ledger + notifications).
import crypto from 'crypto';
import { Booking, Doctor, Clinic, PaymentOrder, LedgerTransaction, ACTIVE_BOOKING_STATUSES } from '../models/index.js';
import { getSettings } from './settings.js';
import { recordLedgerTransaction, round2 } from './gst.js';
import { effectivePlan } from './plans.js';
import { getPaymentProvider, getProviderByName, paymentsPublicConfig, paymentsNotConfigured } from './payments/index.js';
import { refundPaymentOrder } from './refunds.js';
import log from './logger.js';
import { slotsForDate, todayIST, addDays, istInstant, isDateStr, isTimeStr } from './time.js';
import { formatAddress } from './geo.js';
import { notify } from './notify.js';

export const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });
const rid = (p) => `${p}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
const MIN_LEAD_MINUTES = 15;

export const MODE_LABEL = { free: 'Free booking — pay at clinic', paid: 'Full consultation fee paid online', token: 'Booking amount online, rest at clinic', offline: 'Booked by clinic — pay at clinic', legacy: 'Paid online' };

export function findLocation(doctor, locationId) {
  return (doctor.consultationLocations || []).find(l => l.id === locationId);
}

/** Whether online payment modes are allowed for this location under the relevant plan. */
export async function onlinePaymentsAllowed(doctor, loc) {
  if (loc.kind === 'clinic' && loc.clinicId && loc.managedBy === 'clinic') {
    const clinic = await Clinic.findOne({ id: loc.clinicId }).lean();
    return clinic ? (await effectivePlan(clinic, 'clinic')).limits.onlinePayments : false;
  }
  return (await effectivePlan(doctor, 'doctor')).limits.onlinePayments;
}

/** Price breakdown for a location. If online payments are not allowed by the plan, falls back to FREE (pay at clinic). */
export function quote(loc, settings, { paymentsAllowed = true } = {}) {
  const fee = Math.max(0, round2(loc.fee || 0));
  let mode = loc.bookingMode || 'free';
  if (mode !== 'free' && !paymentsAllowed) mode = 'free';
  const platformFee = mode === 'free' ? round2(settings.freeBookingPlatformFee || 0) : round2(settings.bookingPlatformFee ?? 49);
  let passThrough = 0;
  let tokenAmount = 0;
  if (mode === 'paid') passThrough = fee;
  if (mode === 'token') { tokenAmount = Math.min(fee, Math.max(0, round2(loc.tokenAmount || 0))); passThrough = tokenAmount; }
  const payNow = round2(platformFee + passThrough);
  return { mode, fee, tokenAmount, platformFee, passThrough, payNow, dueAtClinic: round2(fee - passThrough), label: MODE_LABEL[mode] };
}

const slotLockKey = (doctorId, date, time) => `${doctorId}|${date}|${time}`;

/** Release payment holds that were never completed. */
export async function releaseExpiredHolds(extraFilter = {}) {
  const settings = await getSettings();
  const cutoff = new Date(Date.now() - (settings.paymentHoldMinutes || 10) * 60000);
  const stale = await Booking.find({ status: 'AwaitingPayment', createdAt: { $lt: cutoff }, ...extraFilter }).select('id paymentOrderId').lean();
  if (!stale.length) return 0;
  await Booking.updateMany({ id: { $in: stale.map(b => b.id) } }, {
    $set: { status: 'Expired', paymentStatus: 'failed', cancelReason: 'Payment not completed in time', cancelledBy: 'system', cancelledAt: new Date() },
    $unset: { slotLock: 1 }, $push: { statusHistory: { status: 'Expired', at: new Date(), by: 'system', note: 'Payment window elapsed' } }
  });
  await PaymentOrder.updateMany({ id: { $in: stale.map(b => b.paymentOrderId).filter(Boolean) }, status: 'created' }, { status: 'expired' });
  return stale.length;
}

/** Slots for a doctor location on a date, with availability. */
export async function availability(doctor, loc, date) {
  if (!loc || loc.isActive === false) throw httpError(404, 'Consultation location not found');
  if (!isDateStr(date)) throw httpError(400, 'Date must be YYYY-MM-DD');
  const today = todayIST();
  const maxDate = addDays(today, loc.schedule?.advanceDays || 14);
  if (date < today || date > maxDate) return { date, slots: [], reason: `Bookings open for the next ${loc.schedule?.advanceDays || 14} days` };
  await releaseExpiredHolds({ doctorId: doctor.id, date });
  const times = slotsForDate(loc.schedule || {}, date);
  const taken = await Booking.find({ doctorId: doctor.id, date, slotLock: { $exists: true } }).select('timeSlot').lean();
  const takenSet = new Set(taken.map(t => t.timeSlot));
  const earliest = Date.now() + MIN_LEAD_MINUTES * 60000;
  const slots = times.map(t => {
    const past = istInstant(date, t).getTime() < earliest;
    const booked = takenSet.has(t);
    return { time: t, available: !past && !booked, reason: booked ? 'booked' : past ? 'past' : '' };
  });
  return { date, slots, reason: times.length ? '' : 'Not available on this day' };
}

/** Next N days that have at least one schedule slot (for date pickers). */
export function upcomingDates(loc, n = 14) {
  const out = [];
  const today = todayIST();
  const max = Math.min(n, loc.schedule?.advanceDays || 14);
  for (let i = 0; i <= max; i++) {
    const d = addDays(today, i);
    if (slotsForDate(loc.schedule || {}, d).length) out.push(d);
  }
  return out;
}

function payeeFor(doctor, loc) {
  return loc.kind === 'clinic' && loc.clinicId ? { payeeType: 'clinic', payeeId: loc.clinicId } : { payeeType: 'doctor', payeeId: doctor.id };
}

function participants(b) {
  const list = [{ type: 'doctor', id: b.doctorId }];
  if (b.clinicId) list.push({ type: 'clinic', id: b.clinicId });
  if (b.patientUserId) list.push({ type: 'patient', id: b.patientUserId });
  return list;
}

const fmtSlot = b => `${b.date} ${b.timeSlot}`;

/**
 * Create a booking. patient: { userId, name, phone, stateCode }.
 * source 'online' (patient app) or 'clinic' / 'doctor' (booked by staff; no online payment).
 */
export async function createBooking({ doctor, locationId, date, time, patient, forMember = null, note = '', source = 'online' }) {
  if (!doctor || doctor.status === 'deleted') throw httpError(404, 'Doctor not found');
  if (doctor.status !== 'active') throw httpError(400, 'This doctor is not accepting bookings at the moment (profile not yet approved).', 'DOCTOR_NOT_ACTIVE');
  if (doctor.bookingEnabled === false) throw httpError(400, 'Booking is currently paused for this doctor', 'BOOKING_PAUSED');
  const loc = findLocation(doctor, locationId);
  if (!loc || loc.isActive === false) throw httpError(400, 'Please choose a valid consultation location', 'BAD_LOCATION');
  if (loc.kind === 'clinic' && loc.clinicId) {
    const clinic = await Clinic.findOne({ id: loc.clinicId }).lean();
    if (!clinic || clinic.status !== 'active') throw httpError(400, 'This clinic is not accepting bookings at the moment.', 'CLINIC_NOT_ACTIVE');
  }
  if (!isDateStr(date) || !isTimeStr(time)) throw httpError(400, 'Choose a valid date and time slot');
  const av = await availability(doctor, loc, date);
  const slot = av.slots.find(s => s.time === time);
  if (!slot) throw httpError(400, 'That time is not offered at this location', 'BAD_SLOT');
  if (!slot.available) throw httpError(409, slot.reason === 'booked' ? 'Sorry, this slot was just booked. Please pick another time.' : 'This slot is no longer available.', 'SLOT_TAKEN');

  const settings = await getSettings();
  const staffBooking = source !== 'online';
  const q = staffBooking
    ? { mode: 'offline', fee: round2(loc.fee || 0), tokenAmount: 0, platformFee: 0, passThrough: 0, payNow: 0, dueAtClinic: round2(loc.fee || 0) }
    : quote(loc, settings, { paymentsAllowed: await onlinePaymentsAllowed(doctor, loc) });

  const needsPayment = q.payNow > 0;
  if (needsPayment && !getPaymentProvider()) throw paymentsNotConfigured();
  const { payeeType, payeeId } = payeeFor(doctor, loc);
  const initialStatus = needsPayment ? 'AwaitingPayment' : (loc.autoConfirm === false && !staffBooking ? 'Pending' : 'Confirmed');
  const booking = new Booking({
    id: rid('book'),
    bookingCode: `FAD-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
    doctorId: doctor.id, doctorName: doctor.name,
    clinicId: loc.kind === 'clinic' ? loc.clinicId : '',
    clinicName: loc.name || (loc.kind === 'online' ? 'Online consultation' : 'Consultation'),
    locationId: loc.id, locationKind: loc.kind, locationName: loc.name,
    locationAddress: loc.kind === 'online' ? 'Online video consultation' : formatAddress(loc.address),
    locationPoint: loc.location && loc.location.coordinates?.length === 2 ? loc.location : undefined,
    patientUserId: patient.userId || '', patientName: String(patient.name || '').slice(0, 120), patientPhone: patient.phone,
    forMember: forMember ? { id: forMember.id, name: forMember.name, relation: forMember.relation } : undefined,
    patientNote: String(note || '').slice(0, 500),
    date, timeSlot: time, slotStart: istInstant(date, time),
    slotLock: slotLockKey(doctor.id, date, time),
    source,
    bookingMode: q.mode, fee: q.fee, tokenAmount: q.tokenAmount, bookingPremiumFee: q.platformFee,
    amountPayableOnline: q.payNow, amountPaidOnline: 0, amountDueAtClinic: q.dueAtClinic,
    totalAmount: round2(q.fee + q.platformFee),
    payeeType, payeeId,
    paymentStatus: needsPayment ? 'pending' : (q.dueAtClinic > 0 ? 'pay_at_clinic' : 'not_required'),
    isPaid: !needsPayment && q.dueAtClinic === 0,
    status: initialStatus,
    confirmedAt: initialStatus === 'Confirmed' ? new Date() : null,
    statusHistory: [{ status: initialStatus, at: new Date(), by: source === 'online' ? 'patient' : source, note: '' }],
    claimStatus: 'Pending'
  });
  try {
    await booking.save();
  } catch (err) {
    if (err?.code === 11000) throw httpError(409, 'Sorry, this slot was just booked. Please pick another time.', 'SLOT_TAKEN');
    throw err;
  }

  let payment = null;
  if (needsPayment) {
    const provider = getPaymentProvider();
    const order = new PaymentOrder({
      id: rid('pay'), purpose: 'booking', refId: booking.id, partyType: 'patient', partyId: patient.userId || '',
      amount: q.payNow, provider: provider.name,
      meta: { platformFee: q.platformFee, passThrough: q.passThrough, mode: q.mode, doctorId: doctor.id, patientStateCode: patient.stateCode || '' }
    });
    try {
      // amount is computed server-side from the location + settings (never from the client)
      const po = await provider.createOrder({ amount: q.payNow, receipt: order.id, notes: { type: 'booking', bookingId: booking.id, bookingCode: booking.bookingCode, party: 'patient', partyId: patient.userId || '' } });
      order.providerOrderId = po.providerOrderId;
      await order.save();
    } catch (err) {
      await Booking.updateOne({ id: booking.id }, { $set: { status: 'Expired', paymentStatus: 'failed' }, $unset: { slotLock: 1 } });
      log.error('Payment order creation failed', { bookingId: booking.id, err: err.message });
      throw httpError(502, 'Could not start the payment right now. Please try again.', 'PAYMENT_INIT_FAILED');
    }
    booking.paymentOrderId = order.id;
    await booking.save();
    const holdMinutes = settings.paymentHoldMinutes || 10;
    payment = paymentClientPayload(order, { description: `Consultation with ${doctor.name}`, prefill: { name: patient.name, contact: patient.phone }, holdExpiresAt: new Date(booking.createdAt.getTime() + holdMinutes * 60000) });
  } else {
    await afterBookingConfirmedOrPending(booking);
  }
  return { booking, payment, quote: q };
}

export function paymentClientPayload(order, extra = {}) {
  return { orderId: order.id, providerOrderId: order.providerOrderId, amount: order.amount, currency: order.currency, ...paymentsPublicConfig(), provider: order.provider, ...extra };
}

async function afterBookingConfirmedOrPending(b) {
  const when = fmtSlot(b);
  const pending = b.status === 'Pending';
  await notify([{ type: 'doctor', id: b.doctorId }, b.clinicId && { type: 'clinic', id: b.clinicId }], {
    type: 'booking_new',
    title: pending ? 'New booking request' : 'New booking',
    body: `${b.patientName}${b.forMember?.name ? ` (for ${b.forMember.name})` : ''} booked ${when} at ${b.locationName}. ${MODE_LABEL[b.bookingMode] || ''}`,
    data: { bookingId: b.id }
  });
  if (b.patientUserId) {
    await notify({ type: 'patient', id: b.patientUserId }, {
      type: 'booking_status',
      title: pending ? 'Booking request sent' : 'Booking confirmed',
      body: `${b.doctorName} • ${when} • ${b.locationName}. Token ${b.bookingCode}.${b.amountDueAtClinic > 0 ? ` Pay ₹${b.amountDueAtClinic} at the clinic.` : ''}`,
      data: { bookingId: b.id }
    });
  }
}

/**
 * Apply a VERIFIED payment to its booking. The caller (lib/payments/apply.js) has atomically claimed the order
 * (status 'processing'), so this runs once per order. Ledger rows are only created here, after verification.
 */
export async function confirmBookingPayment(order, { paymentId }) {
  const b = await Booking.findOne({ id: order.refId });
  if (!b) throw httpError(404, 'Booking not found');
  const settings = await getSettings();

  if (b.status !== 'AwaitingPayment') {
    // Late payment (hold expired / cancelled). Re-take the slot if it is still free, otherwise refund automatically.
    let revived = false;
    if (b.status === 'Expired') {
      try {
        const r = await Booking.updateOne({ id: b.id, status: 'Expired' }, { $set: { status: 'AwaitingPayment', slotLock: slotLockKey(b.doctorId, b.date, b.timeSlot), paymentStatus: 'pending' } });
        revived = r.modifiedCount === 1 && (!b.slotStart || b.slotStart.getTime() > Date.now());
        if (r.modifiedCount === 1 && !revived) await Booking.updateOne({ id: b.id }, { $set: { status: 'Expired', paymentStatus: 'failed' }, $unset: { slotLock: 1 } });
      } catch (e) { if (e?.code !== 11000) throw e; }
    }
    if (!revived) {
      order.status = 'paid'; order.providerPaymentId = paymentId; order.paidAt = new Date();
      order.meta = { ...(order.meta || {}), lateRefund: true }; order.markModified('meta');
      await order.save();
      const provider = getProviderByName(order.provider);
      let r = { status: 'failed' };
      if (provider) r = await provider.refund({ paymentId, amount: order.amount, notes: { reason: 'slot hold expired', orderId: order.id } }).catch(e => ({ status: 'failed', error: e.message }));
      order.refunds.push({ id: rid('rf'), amount: order.amount, status: r.status, providerRefundId: r.providerRefundId || '', at: new Date(), reason: 'Payment received after slot hold expired', by: 'system' });
      if (r.status !== 'failed') { order.status = 'refunded'; order.refundedAmount = order.amount; }
      else await notify({ type: 'admin', id: 'admin' }, { type: 'payment', title: 'Late payment needs a manual refund', body: `Payment ${paymentId} (₹${order.amount}) arrived after the hold on booking ${b.bookingCode} expired and the automatic refund failed.`, data: { orderId: order.id } });
      await order.save();
      throw httpError(409, 'Your payment was received after the slot hold expired, so it is being refunded. Please book again.', 'HOLD_EXPIRED');
    }
    b.status = 'AwaitingPayment';
  }

  const doctor = await Doctor.findOne({ id: b.doctorId });
  const loc = doctor ? findLocation(doctor, b.locationId) : null;
  const txn = await LedgerTransaction.findOne({ paymentOrderId: order.id, type: 'patient_fee' }) || await recordLedgerTransaction({
    type: 'patient_fee', category: 'booking_fee', partyType: 'patient',
    partyId: b.patientUserId, partyName: b.patientName, partyPhone: b.patientPhone,
    partyStateCode: order.meta?.patientStateCode || '',
    amount: order.meta?.platformFee ?? b.bookingPremiumFee,
    passThroughAmount: order.meta?.passThrough ?? 0,
    bookingId: b.id, doctorId: b.doctorId,
    bookingMode: b.bookingMode, amountDueAtClinic: b.amountDueAtClinic,
    payeeType: b.payeeType, payeeId: b.payeeId, paymentOrderId: order.id,
    paymentReference: paymentId, paymentMethod: order.paymentMethod ? `online:${order.paymentMethod}` : 'online',
    razorpayOrderId: order.provider === 'razorpay' ? order.providerOrderId : '', razorpayPaymentId: order.provider === 'razorpay' ? paymentId : '',
    description: `Booking ${b.bookingCode} • ${b.doctorName} • ${MODE_LABEL[b.bookingMode] || b.bookingMode}`
  }, settings);
  order.ledgerInvoiceNumber = txn.invoiceNumber;
  order.status = 'paid';
  order.providerPaymentId = paymentId;
  order.paidAt = order.paidAt || new Date();
  await order.save();

  const nextStatus = loc && loc.autoConfirm === false ? 'Pending' : 'Confirmed';
  b.status = nextStatus;
  b.confirmedAt = nextStatus === 'Confirmed' ? new Date() : null;
  b.paymentStatus = 'paid';
  b.paymentId = paymentId;
  b.amountPaidOnline = order.amount;
  b.isPaid = b.amountDueAtClinic === 0;
  b.invoiceNumber = txn.invoiceNumber;
  b.taxablePlatformFee = txn.taxableValue; b.cgst = txn.cgst; b.sgst = txn.sgst; b.igst = txn.igst; b.sacCode = txn.sacCode;
  b.statusHistory.push({ status: nextStatus, at: new Date(), by: 'payment', note: `Paid ₹${order.amount} (${order.provider})` });
  await b.save();

  const pass = round2(order.meta?.passThrough || 0);
  if (pass > 0) {
    const Model = b.payeeType === 'clinic' ? Clinic : Doctor;
    await Model.updateOne({ id: b.payeeId }, { $inc: { claimPendingFee: pass } });
  }
  await afterBookingConfirmedOrPending(b);
  return b;
}

export async function failPaymentOrder(order, reason = 'Payment cancelled') {
  if (order.status !== 'created') return;
  order.status = 'failed';
  order.failureReason = String(reason).slice(0, 200);
  await order.save();
  if (order.purpose === 'booking') {
    await Booking.updateOne({ id: order.refId, status: 'AwaitingPayment' }, {
      $set: { status: 'Expired', paymentStatus: 'failed', cancelledBy: 'system', cancelReason: reason, cancelledAt: new Date() },
      $unset: { slotLock: 1 }, $push: { statusHistory: { status: 'Expired', at: new Date(), by: 'system', note: reason } }
    });
  }
}

/**
 * Cancel a booking and refund per policy:
 * - doctor / clinic / admin cancels: everything paid online is refunded (incl. platform fee → GST credit note)
 * - patient cancels >= cancellationWindowHours before the slot: consultation fee / booking amount refunded; platform fee retained
 * - patient cancels later than that: no refund
 */
export async function cancelBooking(b, { by, reason = '' }) {
  if (!['AwaitingPayment', 'Pending', 'Confirmed'].includes(b.status)) throw httpError(400, `A ${b.status} booking cannot be cancelled`);
  const settings = await getSettings();
  if (by === 'patient' && b.slotStart && b.slotStart.getTime() < Date.now()) throw httpError(400, 'This appointment time has already passed');
  const wasAwaiting = b.status === 'AwaitingPayment';
  b.status = 'Cancelled';
  b.cancelledBy = by;
  b.cancelReason = String(reason || '').slice(0, 300);
  b.cancelledAt = new Date();
  b.slotLock = undefined;
  b.statusHistory.push({ status: 'Cancelled', at: new Date(), by, note: b.cancelReason });

  let refund = { amount: 0, status: 'none' };
  if (!wasAwaiting && b.paymentStatus === 'paid' && b.amountPaidOnline > 0) {
    const order = b.paymentOrderId ? await PaymentOrder.findOne({ id: b.paymentOrderId }) : null;
    const platformPaid = round2(order?.meta?.platformFee ?? b.bookingPremiumFee ?? 0);
    const passPaid = round2(order?.meta?.passThrough ?? Math.max(0, b.amountPaidOnline - platformPaid));
    let refundPlatform = 0, refundPass = 0;
    if (by === 'patient') {
      const hoursLeft = b.slotStart ? (b.slotStart.getTime() - Date.now()) / 3600000 : 0;
      if (hoursLeft >= (settings.cancellationWindowHours ?? 4)) refundPass = passPaid;
    } else {
      refundPlatform = platformPaid;
      refundPass = passPaid;
    }
    const total = round2(refundPlatform + refundPass);
    if (total > 0) {
      try {
        if (!order) throw httpError(400, 'No payment order on this booking');
        const out = await refundPaymentOrder(order, { split: { platform: refundPlatform, pass: refundPass }, reason: `Cancelled by ${by}${b.cancelReason ? `: ${b.cancelReason}` : ''}`, by, booking: b });
        refund = { amount: out.refund.amount, status: 'processed', reference: out.txn.invoiceNumber, providerStatus: out.refund.status };
      } catch (e) {
        log.error('Cancellation refund failed', { bookingId: b.id, err: e.message });
        b.refundStatus = 'failed';
        refund = { amount: total, status: 'failed' };
        await notify({ type: 'admin', id: 'admin' }, { type: 'payment', title: 'Cancellation refund failed', body: `Booking ${b.bookingCode}: automatic refund of ₹${total} failed (${e.message}). Refund it from Admin → Bookings.`, data: { bookingId: b.id } }).catch(() => {});
      }
    } else {
      b.refundStatus = 'not_eligible';
      refund = { amount: 0, status: 'not_eligible' };
    }
  } else if (wasAwaiting) {
    b.paymentStatus = 'failed';
    if (b.paymentOrderId) await PaymentOrder.updateOne({ id: b.paymentOrderId, status: 'created' }, { status: 'failed', failureReason: 'Booking cancelled before payment' });
  }
  await b.save();

  const who = { patient: 'the patient', doctor: 'the doctor', clinic: 'the clinic', admin: 'FindADoc support', system: 'the system' }[by] || by;
  const refundText = refund.status === 'processed' ? ` Refund of ₹${refund.amount} processed.` : refund.status === 'not_eligible' ? ' No refund (cancelled within the cancellation window).' : refund.status === 'failed' ? ' Refund could not be processed automatically — support will follow up.' : '';
  await notify(participants(b).filter(p => !(p.type === by)), {
    type: 'booking_status', title: `Booking cancelled`,
    body: `${b.bookingCode} • ${b.doctorName} • ${fmtSlot(b)} was cancelled by ${who}.${b.cancelReason ? ` Reason: ${b.cancelReason}.` : ''}${refundText}`,
    data: { bookingId: b.id }
  });
  return { booking: b, refund };
}

/** Doctor / clinic actions: accept | complete | no-show */
export async function updateBookingStatus(b, action, by) {
  const now = Date.now();
  if (action === 'accept') {
    if (b.status !== 'Pending') throw httpError(400, 'Only pending booking requests can be accepted');
    b.status = 'Confirmed'; b.confirmedAt = new Date();
  } else if (action === 'complete') {
    if (b.status !== 'Confirmed') throw httpError(400, 'Only confirmed bookings can be marked completed');
    if (b.slotStart && b.slotStart.getTime() > now + 6 * 3600000) throw httpError(400, 'You can mark the visit completed on the day of the appointment');
    b.status = 'Completed'; b.completedAt = new Date();
    if (b.amountDueAtClinic > 0) b.isPaid = true;
  } else if (action === 'no-show') {
    if (b.status !== 'Confirmed') throw httpError(400, 'Only confirmed bookings can be marked no-show');
    if (b.slotStart && b.slotStart.getTime() > now) throw httpError(400, 'No-show can be marked only after the appointment time');
    b.status = 'NoShow';
  } else throw httpError(400, 'Unknown action');
  if (b.status !== 'Confirmed') b.slotLock = b.status === 'Completed' || b.status === 'NoShow' ? b.slotLock : undefined;
  b.statusHistory.push({ status: b.status, at: new Date(), by, note: '' });
  await b.save();
  if (b.patientUserId) {
    const t = { Confirmed: 'Booking confirmed', Completed: 'Visit completed', NoShow: 'Marked as no-show' }[b.status];
    await notify({ type: 'patient', id: b.patientUserId }, {
      type: 'booking_status', title: t,
      body: `${b.bookingCode} • ${b.doctorName} • ${fmtSlot(b)}${b.status === 'Completed' ? '. Please rate your experience.' : ''}`,
      data: { bookingId: b.id }
    });
  }
  return b;
}

/** Projection for booking lists. Staff (doctor/clinic/admin) see patient contact; patients see everything about their own booking. */
export function bookingView(b) {
  const o = typeof b.toObject === 'function' ? b.toObject() : { ...b };
  delete o._id; delete o.__v; delete o.slotLock;
  const c = o.locationPoint?.coordinates;
  o.directionsUrl = Array.isArray(c) && c.length === 2 ? `https://www.google.com/maps/dir/?api=1&destination=${c[1]},${c[0]}` : '';
  o.modeLabel = MODE_LABEL[o.bookingMode] || '';
  return o;
}

export function bookingScopeFilter(scope) {
  const today = todayIST();
  switch (scope) {
    case 'today': return { date: today, status: { $in: ['Pending', 'Confirmed', 'Completed', 'NoShow'] } };
    case 'upcoming': return { date: { $gte: today }, status: { $in: ['Pending', 'Confirmed', 'AwaitingPayment'] } };
    case 'past': return { $or: [{ date: { $lt: today } }, { status: { $in: ['Completed', 'NoShow'] } }], status: { $nin: ['Cancelled', 'Expired', 'AwaitingPayment'] } };
    case 'cancelled': return { status: { $in: ['Cancelled', 'Expired'] } };
    case 'pending': return { status: 'Pending' };
    default: return {};
  }
}

export { ACTIVE_BOOKING_STATUSES };
