// Live queue / token tracking per doctor + location + day.
// Tokens are assigned in slot order the first time the day's queue is touched (later bookings get the next
// numbers), so a patient's token never changes. Calling order: recalled patients first, then slot time, then token.
// ETA = people ahead x average consult time (measured once >= 3 patients were served, else configured / slot length)
// + "running late" delay, never earlier than the booked slot.
import { QueueDay, Booking, Doctor } from '../models/index.js';
import { updateBookingStatus, httpError, findLocation } from './bookings.js';
import { queueMessage } from './messaging/index.js';
import { notify } from './notify.js';
import { todayIST } from './time.js';

export const queueKey = (doctorId, locationId, date) => `${doctorId}|${locationId}|${date}`;
const QUEUE_STATUSES = ['Confirmed', 'Completed', 'NoShow'];

async function queueDay(doctorId, locationId, date, clinicId = '') {
  const key = queueKey(doctorId, locationId, date);
  return QueueDay.findOneAndUpdate({ key }, { $setOnInsert: { key, doctorId, locationId, date, clinicId } }, { upsert: true, new: true });
}

async function assignTokens(qd) {
  const missing = await Booking.find({ doctorId: qd.doctorId, locationId: qd.locationId, date: qd.date, status: { $in: QUEUE_STATUSES }, queueToken: null })
    .sort({ slotStart: 1, createdAt: 1 }).select('id').lean();
  for (const b of missing) {
    const q = await QueueDay.findOneAndUpdate({ key: qd.key }, { $inc: { nextToken: 1 } }, { new: false });
    await Booking.updateOne({ id: b.id, queueToken: null }, { $set: { queueToken: q.nextToken } });
  }
}

function sortQueue(list) {
  return list.sort((a, b) => {
    const pa = a.queuePriority ? new Date(a.queuePriority).getTime() : Infinity;
    const pb = b.queuePriority ? new Date(b.queuePriority).getTime() : Infinity;
    if (pa !== pb) return pa - pb;
    const sa = a.slotStart ? new Date(a.slotStart).getTime() : 0, sb = b.slotStart ? new Date(b.slotStart).getTime() : 0;
    if (sa !== sb) return sa - sb;
    return (a.queueToken || 0) - (b.queueToken || 0);
  });
}

async function entries(qd) {
  await assignTokens(qd);
  const list = await Booking.find({ doctorId: qd.doctorId, locationId: qd.locationId, date: qd.date, status: { $in: QUEUE_STATUSES } })
    .select('id bookingCode queueToken queueStatus queuePriority slotStart timeSlot status patientName patientUserId patientPhone forMember paymentStatus amountDueAtClinic consultStartedAt').lean();
  for (const e of list) e.queueStatus = e.queueStatus || 'waiting'; // bookings created before the queue existed
  return sortQueue(list);
}

async function avgMinutes(qd) {
  if (qd.servedCount >= 3 && qd.totalConsultMs > 0) return Math.max(2, Math.round(qd.totalConsultMs / qd.servedCount / 60000));
  if (qd.avgConsultMinutes) return qd.avgConsultMinutes;
  const doc = await Doctor.findOne({ id: qd.doctorId }).select('consultationLocations').lean();
  return findLocation(doc || {}, qd.locationId)?.schedule?.slotMinutes || 15;
}

function summarise(qd, list, avg) {
  const current = list.find(e => e.queueStatus === 'in_consult' && e.status === 'Confirmed') || null;
  const waiting = list.filter(e => e.queueStatus === 'waiting' && e.status === 'Confirmed');
  return { current, waiting, avg, nowServing: current?.queueToken || null };
}

function etaFor(qd, sum, entry) {
  const now = Date.now();
  const slot = entry.slotStart ? new Date(entry.slotStart).getTime() : now;
  const delay = (qd.delayMinutes || 0) * 60000;
  if (entry.queueStatus === 'in_consult') return { position: 0, etaAt: new Date(now), etaMinutes: 0 };
  const idx = sum.waiting.findIndex(e => e.id === entry.id);
  const ahead = idx < 0 ? null : idx + (sum.current ? 1 : 0);
  if (ahead === null) return { position: null, etaAt: null, etaMinutes: null };
  let est = slot + delay;
  if (qd.status === 'running' || qd.status === 'paused') {
    const remainingCurrent = sum.current?.consultStartedAt ? Math.max(0, sum.avg * 60000 - (now - new Date(sum.current.consultStartedAt).getTime())) : 0;
    const fromQueue = now + idx * sum.avg * 60000 + remainingCurrent + (qd.status === 'paused' ? delay : 0);
    est = Math.max(fromQueue, slot + delay);
  }
  return { position: ahead, etaAt: new Date(est), etaMinutes: Math.max(0, Math.round((est - now) / 60000)) };
}

/** Staff view of a day's queue. */
export async function staffQueue(doctorId, locationId, date = todayIST(), clinicId = '') {
  const qd = await queueDay(doctorId, locationId, date, clinicId);
  const list = await entries(qd);
  const avg = await avgMinutes(qd);
  const sum = summarise(qd, list, avg);
  return {
    queue: { key: qd.key, date, status: qd.status, delayMinutes: qd.delayMinutes, pauseReason: qd.pauseReason, avgConsultMinutes: avg, configuredAvgMinutes: qd.avgConsultMinutes, servedCount: qd.servedCount, nowServing: sum.nowServing },
    entries: list.map(e => ({
      id: e.id, bookingCode: e.bookingCode, token: e.queueToken, queueStatus: e.queueStatus, status: e.status, timeSlot: e.timeSlot,
      patientName: e.forMember?.name ? `${e.forMember.name} (${e.patientName})` : e.patientName,
      paymentStatus: e.paymentStatus, amountDueAtClinic: e.amountDueAtClinic, ...etaFor(qd, sum, e)
    }))
  };
}

/** Patient view of their own booking in the queue. */
export async function patientQueue(b) {
  if (!['Confirmed', 'Completed', 'NoShow'].includes(b.status)) return { active: false, reason: 'not_confirmed' };
  const qd = await queueDay(b.doctorId, b.locationId, b.date, b.clinicId || '');
  const list = await entries(qd);
  const avg = await avgMinutes(qd);
  const sum = summarise(qd, list, avg);
  const me = list.find(e => e.id === b.id);
  const today = todayIST();
  return {
    active: b.date === today && b.status === 'Confirmed',
    date: b.date, queueStatus: qd.status, delayMinutes: qd.delayMinutes, pauseReason: qd.status === 'paused' ? qd.pauseReason : '',
    token: me?.queueToken || null, myStatus: me?.queueStatus || 'waiting', nowServing: sum.nowServing, avgConsultMinutes: avg,
    waitingCount: sum.waiting.length, ...(me ? etaFor(qd, sum, me) : {}), updatedAt: new Date()
  };
}

async function finishCurrent(qd, by) {
  if (!qd.currentBookingId) return null;
  const b = await Booking.findOne({ id: qd.currentBookingId });
  qd.currentBookingId = '';
  if (!b || b.queueStatus !== 'in_consult') return null;
  b.queueStatus = 'done';
  b.consultEndedAt = new Date();
  const ms = b.consultStartedAt ? Date.now() - b.consultStartedAt.getTime() : 0;
  if (ms > 30000 && ms < 3 * 3600000) { qd.servedCount += 1; qd.totalConsultMs += ms; }
  await b.save();
  if (b.status === 'Confirmed') await updateBookingStatus(b, 'complete', by).catch(() => {});
  return b;
}

async function notifyUpcoming(qd, by) {
  const s = await staffQueue(qd.doctorId, qd.locationId, qd.date);
  const doc = await Doctor.findOne({ id: qd.doctorId }).select('name').lean();
  for (const e of s.entries.filter(x => x.queueStatus === 'waiting' && x.status === 'Confirmed' && x.position !== null && x.position <= 2)) {
    const b = await Booking.findOne({ id: e.id }).select('id patientUserId patientPhone').lean();
    if (b?.patientUserId) await queueMessage({ kind: 'queue_soon', userId: b.patientUserId, phone: b.patientPhone, bookingId: b.id, params: { doctor: doc?.name || '', position: e.position, token: e.token }, dedupeKey: `queue_soon:${b.id}` });
  }
}

/** Staff actions: start | pause | resume | close | next | done | skip | recall | delay | avg */
export async function queueAction({ doctorId, locationId, date = todayIST(), clinicId = '' }, action, body = {}, by = 'doctor') {
  if (date !== todayIST()) throw httpError(400, 'The queue can only be run for today');
  const qd = await queueDay(doctorId, locationId, date, clinicId);
  const doc = await Doctor.findOne({ id: doctorId }).select('name').lean();
  switch (action) {
    case 'start': case 'resume': qd.status = 'running'; qd.pauseReason = ''; qd.startedAt = qd.startedAt || new Date(); break;
    case 'pause': qd.status = 'paused'; qd.pauseReason = String(body.reason || '').slice(0, 120); break;
    case 'close': await finishCurrent(qd, by); qd.status = 'closed'; break;
    case 'delay': {
      const minutes = Math.max(0, Math.min(240, Math.round(Number(body.minutes) || 0)));
      qd.delayMinutes = minutes;
      if (minutes > 0) {
        const waiting = await Booking.find({ doctorId, locationId, date, status: 'Confirmed', queueStatus: { $in: ['waiting', null] }, patientUserId: { $ne: '' } }).select('id patientUserId patientPhone').lean();
        for (const b of waiting) await queueMessage({ kind: 'running_late', userId: b.patientUserId, phone: b.patientPhone, bookingId: b.id, params: { doctor: doc?.name || '', minutes }, dedupeKey: `running_late:${b.id}:${minutes}` });
      }
      break;
    }
    case 'avg': qd.avgConsultMinutes = Math.max(0, Math.min(120, Math.round(Number(body.minutes) || 0))); break;
    case 'done': await finishCurrent(qd, by); break;
    case 'next': {
      await finishCurrent(qd, by);
      const list = await entries(qd);
      const next = list.find(e => e.queueStatus === 'waiting' && e.status === 'Confirmed');
      qd.status = 'running'; qd.startedAt = qd.startedAt || new Date(); qd.pauseReason = '';
      if (next) {
        await Booking.updateOne({ id: next.id }, { $set: { queueStatus: 'in_consult', consultStartedAt: new Date() } });
        qd.currentBookingId = next.id;
        if (next.patientUserId) {
          await queueMessage({ kind: 'your_turn', userId: next.patientUserId, phone: next.patientPhone, bookingId: next.id, params: { doctor: doc?.name || '', token: next.queueToken }, dedupeKey: `your_turn:${next.id}:${Date.now()}` });
        }
      }
      break;
    }
    case 'skip': {
      const id = body.bookingId || qd.currentBookingId;
      const b = id ? await Booking.findOne({ id, doctorId, locationId, date }) : null;
      if (!b || !['waiting', 'in_consult'].includes(b.queueStatus)) throw httpError(400, 'Nothing to skip');
      if (b.id === qd.currentBookingId) qd.currentBookingId = '';
      b.queueStatus = 'skipped'; b.queuePriority = null; await b.save();
      if (b.patientUserId) await notify({ type: 'patient', id: b.patientUserId }, { type: 'queue', title: 'You missed your turn', body: `${doc?.name || 'The doctor'} called token ${b.queueToken}. Please inform the reception — you will be called again.`, data: { bookingId: b.id } });
      break;
    }
    case 'recall': {
      const b = await Booking.findOne({ id: body.bookingId, doctorId, locationId, date, queueStatus: 'skipped' });
      if (!b) throw httpError(400, 'Only skipped patients can be recalled');
      b.queueStatus = 'waiting'; b.queuePriority = new Date(); await b.save();
      break;
    }
    default: throw httpError(400, 'Unknown queue action');
  }
  await qd.save();
  if (['next', 'skip', 'done', 'recall', 'start', 'resume'].includes(action)) await notifyUpcoming(qd, by);
  return staffQueue(doctorId, locationId, date, clinicId);
}
