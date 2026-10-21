// Phase 4: live queue + ETA, reminders (scheduled + dispatched), signed reschedule/cancel links, waitlist auto-offer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, agent, pickSlot, until } from './helpers.mjs';
import { p4 } from './p4-helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let t, M, h, doc;
before(async () => { t = await boot({ PAYMENTS_MODE: 'mock' }); M = t.models; h = p4(t); doc = await h.doctor('9000020000');
  await M.Doctor.updateOne({ id: 'demo-doc-1', 'consultationLocations.id': 'demo-loc-1-o' }, { $set: { 'consultationLocations.$.autoConfirm': true } });
});
after(async () => { await t?.close(); });

const tokenOf = link => decodeURIComponent(String(link).split('/appointment/')[1] || '');

test('live queue: tokens, position and ETA update as staff call / finish / skip / delay; IDOR safe', async () => {
  const pa = await h.patient('Queue A'), pb = await h.patient('Queue B'), pc = await h.patient('Queue C');
  // earliest slots of the day so these three are first in line
  const A = await h.mkBooking(pa.user, { time: '05:00' });
  const B = await h.mkBooking(pb.user, { time: '05:10' });
  const C = await h.mkBooking(pc.user, { time: '05:20' });
  const q0 = await pb.get(`/api/me/bookings/${B.id}/queue`);
  assert.equal(q0.status, 200, q0.text);
  assert.equal(q0.body.queue.active, true);
  assert.equal(q0.body.queue.queueStatus, 'not_started');
  assert.ok(q0.body.queue.token > 0);
  assert.equal(q0.body.queue.position, 1);
  // staff view
  const sv = await doc.get('/api/doctor-portal/queue?locationId=demo-loc-1-o');
  assert.equal(sv.status, 200, sv.text);
  assert.ok(sv.body.entries.find(e => e.id === A.id).token < sv.body.entries.find(e => e.id === C.id).token);
  assert.ok(!JSON.stringify(sv.body).includes(pa.user.phone), 'no patient phone in staff queue');
  // call next => A in consultation, B is next in line
  const n1 = await doc.post('/api/doctor-portal/queue/next', { locationId: 'demo-loc-1-o' });
  assert.equal(n1.status, 200, n1.text);
  assert.equal(n1.body.queue.status, 'running');
  const qa = (await pa.get(`/api/me/bookings/${A.id}/queue`)).body.queue;
  assert.equal(qa.myStatus, 'in_consult'); assert.equal(qa.position, 0);
  const qb = (await pb.get(`/api/me/bookings/${B.id}/queue`)).body.queue;
  assert.equal(qb.position, 1); assert.equal(qb.nowServing, qa.token);
  assert.ok(qb.etaAt && qb.etaMinutes >= 0);
  assert.ok(await M.ScheduledMessage.exists({ kind: 'your_turn', bookingId: A.id }));
  assert.ok(await M.ScheduledMessage.exists({ kind: 'queue_soon', bookingId: B.id }));
  // running late => patients see the delay and get a message
  const before = (await pc.get(`/api/me/bookings/${C.id}/queue`)).body.queue;
  await doc.post('/api/doctor-portal/queue/delay', { locationId: 'demo-loc-1-o', minutes: 20 });
  const late = (await pc.get(`/api/me/bookings/${C.id}/queue`)).body.queue;
  assert.equal(late.delayMinutes, 20);
  assert.ok(new Date(late.etaAt) >= new Date(before.etaAt));
  assert.ok(await M.ScheduledMessage.exists({ kind: 'running_late', bookingId: C.id }));
  // done => A completed; next => B in consult; skip B => skipped, C moves up; recall B
  await doc.post('/api/doctor-portal/queue/done', { locationId: 'demo-loc-1-o' });
  assert.equal((await M.Booking.findOne({ id: A.id }).lean()).status, 'Completed');
  await doc.post('/api/doctor-portal/queue/next', { locationId: 'demo-loc-1-o' });
  await doc.post('/api/doctor-portal/queue/skip', { locationId: 'demo-loc-1-o', bookingId: B.id });
  assert.equal((await pb.get(`/api/me/bookings/${B.id}/queue`)).body.queue.myStatus, 'skipped');
  assert.equal((await pc.get(`/api/me/bookings/${C.id}/queue`)).body.queue.position, 0, 'C is next once B is skipped');
  assert.equal((await doc.post('/api/doctor-portal/queue/recall', { locationId: 'demo-loc-1-o', bookingId: B.id })).status, 200);
  // pause shows the reason
  await doc.post('/api/doctor-portal/queue/pause', { locationId: 'demo-loc-1-o', reason: 'Emergency in ward' });
  const pz = (await pc.get(`/api/me/bookings/${C.id}/queue`)).body.queue;
  assert.equal(pz.queueStatus, 'paused'); assert.equal(pz.pauseReason, 'Emergency in ward');
  // IDOR: another patient / another doctor
  assert.equal((await pa.get(`/api/me/bookings/${C.id}/queue`)).status, 404);
  const doc2 = await h.doctor('9000020001');
  assert.equal((await doc2.post('/api/doctor-portal/queue/next', { locationId: 'demo-loc-1-o' })).status, 404);
  assert.equal((await doc.post('/api/doctor-portal/queue/next', { locationId: 'demo-loc-1-o', bookingId: '$where' })).status, 400);
  assert.equal((await doc.post('/api/doctor-portal/queue/explode', { locationId: 'demo-loc-1-o' })).status, 404);
});

test('reminders: confirmation + 24h + 2h scheduled with a signed link; dispatched in-app and to opted-in WhatsApp (console in dev)', async () => {
  const a = await h.patient('Reminder Pat');
  const pref = await a.put('/api/me/preferences', { whatsapp: true });
  assert.equal(pref.status, 200, pref.text);
  assert.ok(await M.Consent.exists({ userId: a.user.id, purpose: 'whatsapp_reminders', granted: true }), 'consent record');
  // a slot at least 2 days ahead
  const r = await a.get('/api/doctors/demo-doc-1/availability?locationId=demo-loc-1-o');
  const date = r.body.dates[2];
  const day = await a.get(`/api/doctors/demo-doc-1/availability?locationId=demo-loc-1-o&date=${date}`);
  const slot = { date, time: day.body.slots.find(s => s.available).time };
  h.used.add(`${date} ${slot.time}`);
  const b = await h.book(a, { slot });
  assert.equal(b.booking.status, 'Confirmed');
  const msgs = await until(async () => { const m = await M.ScheduledMessage.find({ bookingId: b.booking.id, status: { $ne: 'cancelled' } }).lean(); return m.length >= 3 && m; });
  assert.deepEqual(msgs.map(m => m.kind).sort(), ['booking_confirmation', 'reminder_24h', 'reminder_2h']);
  const slotStart = new Date((await M.Booking.findOne({ id: b.booking.id }).lean()).slotStart).getTime();
  assert.equal(new Date(msgs.find(m => m.kind === 'reminder_24h').sendAt).getTime(), slotStart - 24 * 3600000);
  assert.equal(new Date(msgs.find(m => m.kind === 'reminder_2h').sendAt).getTime(), slotStart - 2 * 3600000);
  for (const m of msgs) assert.match(m.params.link, /\/appointment\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const { dispatchDueMessages } = await import(path.join(ROOT, 'server/lib/messaging/index.js'));
  await dispatchDueMessages();
  const conf = await M.ScheduledMessage.findOne({ bookingId: b.booking.id, kind: 'booking_confirmation' }).lean();
  assert.equal(conf.status, 'sent');
  assert.deepEqual(conf.channels.map(c => c.channel).sort(), ['inapp', 'whatsapp']);
  assert.equal((await M.ScheduledMessage.findOne({ bookingId: b.booking.id, kind: 'reminder_24h' }).lean()).status, 'pending', 'future reminder not sent early');
  // opted-out patient: in-app only
  const quiet = await h.patient('Quiet Pat');
  const qb = await h.book(quiet);
  await dispatchDueMessages();
  const qc = await M.ScheduledMessage.findOne({ bookingId: qb.booking.id, kind: 'booking_confirmation' }).lean();
  assert.deepEqual(qc.channels.map(c => c.channel), ['inapp']);
  t.reminderCase = { a, booking: b.booking, link: msgs[0].params.link };
});

test('signed links: view without login, reschedule (old link becomes stale), cancel; tampering rejected', async () => {
  const { a, booking, link } = t.reminderCase;
  const token = tokenOf(link);
  const anon = agent(t.base);
  const v = await anon.get(`/api/booking-links/${token}`);
  assert.equal(v.status, 200, v.text);
  assert.equal(v.body.booking.bookingCode, booking.bookingCode);
  assert.equal(v.body.canReschedule, true); assert.equal(v.body.canCancel, true);
  assert.ok(!JSON.stringify(v.body).includes(a.user.phone), 'no phone in link view');
  // tampered signature / payload
  const [data, sig] = token.split('.');
  assert.equal((await anon.get(`/api/booking-links/${data}.${sig.slice(0, -2)}xx`)).status, 404);
  const forged = Buffer.from(JSON.stringify({ b: booking.id, v: 0, e: 9999999999 })).toString('base64url');
  assert.equal((await anon.get(`/api/booking-links/${forged}.${sig}`)).status, 404);
  // reschedule via link
  const dates = v.body.dates;
  let target;
  for (const d of dates.slice(3)) { const s = await anon.get(`/api/booking-links/${token}/availability?date=${d}`); const x = s.body.slots?.find(y => y.available && !h.used.has(`${d} ${y.time}`)); if (x) { target = { date: d, time: x.time }; break; } }
  h.used.add(`${target.date} ${target.time}`);
  const rs = await anon.post(`/api/booking-links/${token}/reschedule`, target);
  assert.equal(rs.status, 200, rs.text);
  assert.equal(rs.body.booking.date, target.date);
  // old token is now stale; reminders were re-planned for the new time with a fresh link
  assert.equal((await anon.get(`/api/booking-links/${token}`)).status, 410);
  const fresh = await until(async () => M.ScheduledMessage.findOne({ bookingId: booking.id, kind: 'reminder_24h', status: 'pending' }).lean());
  const { istInstant } = await import(path.join(ROOT, 'server/lib/time.js'));
  assert.equal(new Date(fresh.sendAt).getTime(), istInstant(target.date, target.time).getTime() - 24 * 3600000);
  const newToken = tokenOf(fresh.params.link);
  assert.notEqual(newToken, token);
  const c = await anon.post(`/api/booking-links/${newToken}/cancel`, { reason: 'Feeling better' });
  assert.equal(c.status, 200, c.text);
  assert.equal(c.body.status, 'Cancelled');
  assert.ok(c.body.refund.amount > 0, 'early cancel refunds the consultation amount');
  assert.equal(await M.ScheduledMessage.countDocuments({ bookingId: booking.id, status: 'pending' }), 0, 'pending reminders cancelled');
  assert.equal((await anon.post(`/api/booking-links/${newToken}/cancel`, {})).status, 410);
});

test('waitlist: freed slot is auto-offered to the first in line, held from others, claimable once, expires to the next person', async () => {
  const holder = await h.patient('Slot Holder');
  const w1 = await h.patient('Waiter One'), w2 = await h.patient('Waiter Two'), other = await h.patient('Other Pat');
  const held = await h.book(holder);
  const { date, time } = held.slot;
  const j1 = await w1.post('/api/me/waitlist', { doctorId: 'demo-doc-1', locationId: 'demo-loc-1-o', date, time });
  assert.equal(j1.status, 200, j1.text); assert.equal(j1.body.position, 1);
  const j2 = await w2.post('/api/me/waitlist', { doctorId: 'demo-doc-1', locationId: 'demo-loc-1-o', date });
  assert.equal(j2.status, 200); assert.equal(j2.body.position, 2);
  assert.equal((await w1.post('/api/me/waitlist', { doctorId: 'demo-doc-1', locationId: 'demo-loc-1-o', date, time })).status, 409);
  // holder cancels => offer to w1
  const cx = await holder.post(`/api/me/bookings/${held.booking.id}/cancel`, { reason: 'x' });
  assert.equal(cx.status, 200, cx.text);
  const offered = await until(async () => M.WaitlistEntry.findOne({ id: j1.body.entry.id, status: 'offered' }).lean());
  assert.ok(offered, 'w1 offered'); assert.equal(offered.offeredTime, time);
  assert.ok(await M.ScheduledMessage.exists({ kind: 'waitlist_offer', refId: offered.id }));
  // the slot is reserved for w1
  const day = await other.get(`/api/doctors/demo-doc-1/availability?locationId=demo-loc-1-o&date=${date}`);
  assert.equal(day.body.slots.find(s => s.time === time).available, false);
  assert.ok([400, 409].includes((await other.post('/api/bookings', { doctorId: 'demo-doc-1', locationId: 'demo-loc-1-o', date, time, patientName: 'Other' })).status));
  assert.equal((await w2.post(`/api/me/waitlist/${offered.id}/claim`)).status, 404, 'cannot claim someone else\'s offer');
  // offer expires => rolls to w2
  await M.WaitlistEntry.updateOne({ id: offered.id }, { $set: { offerExpiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await w1.post(`/api/me/waitlist/${offered.id}/claim`)).status, 410);
  const { expireWaitlistOffers } = await import(path.join(ROOT, 'server/lib/waitlist.js'));
  await expireWaitlistOffers();
  const o2 = await M.WaitlistEntry.findOne({ id: j2.body.entry.id }).lean();
  assert.equal(o2.status, 'offered'); assert.equal(o2.offeredTime, time);
  const cl = await w2.post(`/api/me/waitlist/${o2.id}/claim`);
  assert.equal(cl.status, 200, cl.text);
  if (cl.body.payment) await h.pay(w2, cl.body.payment.orderId);
  const nb = await M.Booking.findOne({ id: cl.body.booking.id }).lean();
  assert.equal(nb.timeSlot, time); assert.equal(nb.patientUserId, w2.user.id); assert.equal(nb.status, 'Confirmed');
  assert.equal((await w2.post(`/api/me/waitlist/${o2.id}/claim`)).status, 410, 'claim once');
  const wl = (await w2.get('/api/me/waitlist')).body.items;
  assert.ok(!wl.some(x => 'phone' in x || 'offerLock' in x));
});
