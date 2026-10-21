// Booking reminders: confirmation, 24 h and 2 h before the slot. Re-planned on reschedule, cancelled when the
// booking closes. Every message carries a signed one-tap manage link.
import { on } from './events.js';
import { queueMessage, cancelMessages } from './messaging/index.js';
import { bookingLinkUrl } from './links.js';

const H = 3600000;
const when = b => `${b.date} ${b.timeSlot}`;

export async function planBookingMessages(b) {
  if (!b.patientUserId || b.status !== 'Confirmed') return [];
  const v = b.linkVersion || 0;
  const params = { doctor: b.doctorName, when: when(b), location: b.locationName, code: b.bookingCode, link: bookingLinkUrl(b) };
  const base = { userId: b.patientUserId, phone: b.patientPhone, bookingId: b.id, params };
  const out = [];
  const now = Date.now();
  const slot = b.slotStart ? new Date(b.slotStart).getTime() : 0;
  out.push(await queueMessage({ ...base, kind: 'booking_confirmation', sendAt: new Date(), dedupeKey: `booking_confirmation:${b.id}:${v}` }));
  if (slot - 24 * H > now + 30 * 60000) out.push(await queueMessage({ ...base, kind: 'reminder_24h', sendAt: new Date(slot - 24 * H), dedupeKey: `reminder_24h:${b.id}:${v}` }));
  if (slot - 2 * H > now + 10 * 60000) out.push(await queueMessage({ ...base, kind: 'reminder_2h', sendAt: new Date(slot - 2 * H), dedupeKey: `reminder_2h:${b.id}:${v}` }));
  return out.filter(Boolean);
}

on('booking_confirmed', planBookingMessages);
on('booking_rescheduled', async b => { await cancelMessages({ bookingId: b.id }); await planBookingMessages(b); });
on('booking_closed', b => cancelMessages({ bookingId: b.id }));
