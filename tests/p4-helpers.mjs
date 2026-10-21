// Shared helpers for the phase-4 test files (not a test file itself).
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agent, login, adminLogin, pickSlot } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let seq = 0;

export function p4(t) {
  const M = t.models;
  const used = new Set();
  const h = {
    used,
    async patient(name = 'P4 Patient') {
      const a = agent(t.base);
      const phone = `97${String(process.pid % 1000).padStart(3, '0')}${String(seq++).padStart(5, '0')}`;
      const out = await login(a, phone, 'patient', name);
      a.user = await M.User.findOne({ id: out.user.id });
      return a;
    },
    async doctor(phone = '9000020000') { const a = agent(t.base); await login(a, phone, 'doctor'); return a; },
    async admin() { const a = agent(t.base); const r = await adminLogin(a); if (r.status !== 200) throw new Error(`admin ${r.status} ${r.text}`); return a; },
    /** Insert a booking directly (fast fixtures for completed / today visits). */
    async mkBooking(user, { status = 'Confirmed', daysFromToday = 0, doctorId = 'demo-doc-1', locationId = 'demo-loc-1-o', time, forMember = null, paid = 0 } = {}) {
      const { todayIST, addDays, istInstant } = await import(path.join(ROOT, 'server/lib/time.js'));
      const d = await M.Doctor.findOne({ id: doctorId }).lean();
      const loc = d.consultationLocations.find(l => l.id === locationId);
      const date = addDays(todayIST(), daysFromToday);
      const n = seq++;
      const tm = time || `${String(6 + (n % 16)).padStart(2, '0')}:${n % 2 ? '30' : '00'}`;
      const id = `p4b-${crypto.randomBytes(5).toString('hex')}`;
      const active = ['Confirmed', 'Pending', 'AwaitingPayment'].includes(status);
      return (await M.Booking.create({
        id, bookingCode: `FAD-T${n}${crypto.randomBytes(2).toString('hex')}`, doctorId, doctorName: d.name, clinicId: loc.clinicId || '', clinicName: loc.name,
        locationId, locationKind: loc.kind, locationName: loc.name, patientUserId: user.id, patientName: forMember?.name || user.name, patientPhone: user.phone,
        forMember: forMember ? { id: forMember.id, name: forMember.name, relation: forMember.relation } : undefined,
        date, timeSlot: tm, slotStart: istInstant(date, tm), ...(active ? { slotLock: `${doctorId}|${date}|${tm}|${id}` } : {}),
        source: 'online', bookingMode: paid ? 'paid' : 'free', fee: loc.fee || 500, bookingPremiumFee: 0, totalAmount: loc.fee || 500,
        amountPaidOnline: paid, amountPayableOnline: paid, amountDueAtClinic: paid ? 0 : (loc.fee || 500), payeeType: loc.clinicId ? 'clinic' : 'doctor', payeeId: loc.clinicId || doctorId,
        paymentStatus: paid ? 'paid' : 'pay_at_clinic', isPaid: Boolean(paid), status, invoiceNumber: ''
      })).toObject();
    },
    /** Book through the real API; completes the mock checkout when payment is required. */
    async book(a, { doctorId = 'demo-doc-1', locationId = 'demo-loc-1-o', slot, ...extra } = {}) {
      slot = slot || await pickSlot(a, doctorId, locationId, used);
      const r = await a.post('/api/bookings', { doctorId, locationId, ...slot, patientName: a.user?.name || 'Test', ...extra });
      if (r.status !== 200) throw new Error(`booking ${r.status} ${r.text}`);
      if (!r.body.payment) return { ...r.body, slot };
      const v = await h.pay(a, r.body.payment.orderId);
      return { ...r.body, booking: v.booking, slot };
    },
    async pay(a, orderId) {
      const au = await a.post('/api/payments/mock/authorize', { orderId });
      if (au.status !== 200) throw new Error(`authorize ${au.status} ${au.text}`);
      const v = await a.post('/api/payments/verify', { orderId, paymentId: au.body.paymentId, signature: au.body.signature });
      if (v.status !== 200) throw new Error(`verify ${v.status} ${v.text}`);
      return v.body;
    },
    async png() { const sharp = (await import('sharp')).default; return sharp({ create: { width: 64, height: 64, channels: 3, background: '#3a7' } }).png().toBuffer(); },
    async pdf(text = 'HbA1c 6.1') {
      const PDFDocument = (await import('pdfkit')).default;
      const doc = new PDFDocument(); const chunks = [];
      doc.on('data', c => chunks.push(c));
      const done = new Promise(r => doc.on('end', r));
      doc.text(text); doc.end(); await done;
      return Buffer.concat(chunks);
    },
    form(buf, name, type, fields = {}) {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.append(k, v);
      f.append('file', new Blob([buf], { type }), name);
      return f;
    },
    async uploadImage(a, purpose) { return a.req('POST', '/api/uploads', { form: h.form(await h.png(), 'p.png', 'image/png', { purpose }) }); },
    async uploadRecord(a, fields = {}, buf) { return a.req('POST', '/api/me/records/upload', { form: h.form(buf || await h.pdf(), 'report.pdf', 'application/pdf', fields) }); }
  };
  return h;
}
