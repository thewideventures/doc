// Phase 4: prescriptions (+PDF, private notes), health records access control, private lab uploads, consent-based
// sharing with the booking's doctor, medicine reminders, ABHA disabled by default.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, agent } from './helpers.mjs';
import { p4 } from './p4-helpers.mjs';

let t, M, h, doc, doc2;
before(async () => { t = await boot({ PAYMENTS_MODE: 'mock' }); M = t.models; h = p4(t); doc = await h.doctor('9000020000'); doc2 = await h.doctor('9000020001'); });
after(async () => { await t?.close(); });

const RX = {
  complaints: 'Fever 3 days', diagnosis: 'Viral fever', visitNotes: 'Throat congested', privateNotes: 'SECRET-NOTE-only-for-doctor', advice: 'Fluids, rest',
  vitals: { bp: '120/80', temperature: '100.4F' },
  medicines: [{ name: 'Paracetamol 650', dosage: '1 tab', frequency: '1-0-1', timing: 'After food', durationDays: 3 }],
  tests: ['CBC'], followUp: { afterDays: 7, note: 'If fever persists' }
};

test('prescription: doctor writes for own visit only; patient sees it (no private notes), PDF downloads; others 404', async () => {
  const p = await h.patient('Rx Patient');
  const stranger = await h.patient('Rx Stranger');
  const future = await h.mkBooking(p.user, { daysFromToday: 3 });
  assert.equal((await doc.put(`/api/doctor-portal/bookings/${future.id}/prescription`, RX)).status, 400, 'too early');
  const b = await h.mkBooking(p.user, { status: 'Completed', daysFromToday: -1 });
  assert.equal((await doc2.put(`/api/doctor-portal/bookings/${b.id}/prescription`, RX)).status, 404, 'other doctor');
  assert.equal((await doc.put(`/api/doctor-portal/bookings/${b.id}/prescription`, { ...RX, medicines: [{ name: '' }] })).status, 400, 'zod');
  const w = await doc.put(`/api/doctor-portal/bookings/${b.id}/prescription`, RX);
  assert.equal(w.status, 200, w.text);
  assert.equal(w.body.prescription.privateNotes, RX.privateNotes, 'doctor sees own private notes');
  assert.equal(w.body.prescription.followUp.date.length, 10);
  // patient side
  const list = await p.get('/api/me/prescriptions');
  assert.equal(list.body.items.length, 1);
  const rx = list.body.items[0];
  assert.ok(!JSON.stringify(list.body).includes('SECRET-NOTE'), 'private notes hidden from patient');
  assert.equal(rx.diagnosis, 'Viral fever');
  const pdf = await p.get(`/api/me/prescriptions/${rx.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.match(pdf.headers.get('content-type'), /application\/pdf/);
  assert.ok(pdf.text.startsWith('%PDF'));
  assert.ok(!pdf.text.includes('SECRET-NOTE'));
  const dpdf = await doc.get(`/api/doctor-portal/bookings/${b.id}/prescription/pdf`);
  assert.equal(dpdf.status, 200); assert.ok(dpdf.text.startsWith('%PDF')); assert.ok(!dpdf.text.includes('SECRET-NOTE'));
  // IDOR
  assert.equal((await stranger.get(`/api/me/prescriptions/${rx.id}`)).status, 404);
  assert.equal((await stranger.get(`/api/me/prescriptions/${rx.id}/pdf`)).status, 404);
  assert.equal((await doc2.get(`/api/doctor-portal/bookings/${b.id}/prescription/pdf`)).status, 404);
  assert.equal((await agent(t.base).get(`/api/me/prescriptions/${rx.id}`)).status, 401);
  // appears in the health record timeline; cannot be deleted by the patient
  const recs = (await p.get('/api/me/records')).body.items;
  const rrec = recs.find(r => r.type === 'prescription');
  assert.ok(rrec);
  assert.equal((await p.del(`/api/me/records/${rrec.id}`)).status, 400);
  // /me/bookings shows the prescription + follow-up suggestion
  const bk = (await p.get('/api/me/bookings')).body;
  const row = (bk.bookings || bk.items).find(x => x.id === b.id);
  assert.equal(row.prescriptionId, rx.id); assert.ok(row.followUpSuggested);
  t.rxCase = { p, rx, b };
});

test('medicine reminders follow the dose schedule; turning off cancels them', async () => {
  const { p, rx } = t.rxCase;
  const on = await p.put(`/api/me/prescriptions/${rx.id}/reminders`, { enabled: true });
  assert.equal(on.status, 200, on.text);
  const n = on.body.reminders.scheduledCount;
  assert.ok(n > 0 && n <= 6, `1-0-1 for 3 days => up to 6 future doses, got ${n}`);
  assert.equal(await M.ScheduledMessage.countDocuments({ kind: 'medicine', refId: rx.id, status: 'pending' }), n);
  const off = await p.put(`/api/me/prescriptions/${rx.id}/reminders`, { enabled: false });
  assert.equal(off.status, 200);
  assert.equal(await M.ScheduledMessage.countDocuments({ kind: 'medicine', refId: rx.id, status: 'pending' }), 0);
  const stranger = await h.patient('Reminder Stranger');
  assert.equal((await stranger.put(`/api/me/prescriptions/${rx.id}/reminders`, { enabled: true })).status, 404);
});

test('lab report upload: needs health-data consent, stored privately, only the owner can fetch; unsafe files rejected', async () => {
  const p = await h.patient('Upload Patient');
  const stranger = await h.patient('Upload Stranger');
  const noConsent = await h.uploadRecord(p, { title: 'HbA1c' });
  assert.equal(noConsent.status, 403); assert.equal(noConsent.body.code, 'CONSENT_REQUIRED');
  const c = await p.post('/api/me/consents', { consents: [{ purpose: 'health_data', granted: true }] });
  assert.equal(c.status, 200, c.text);
  assert.ok(await M.Consent.exists({ userId: p.user.id, purpose: 'health_data', granted: true }));
  const up = await h.uploadRecord(p, { title: 'HbA1c March', recordType: 'lab_report', date: '2026-01-10' });
  assert.equal(up.status, 200, up.text);
  const rec = up.body.record;
  assert.equal(rec.type, 'lab_report');
  assert.ok(!JSON.stringify(rec).includes('/uploads/'), 'no public URL for a private record');
  const stored = await M.HealthRecord.findOne({ id: rec.id }).lean();
  assert.ok(stored.file.key && stored.file.visibility !== 'public');
  // the private file is not reachable on the public static path
  assert.ok(stored.file.key.startsWith('private/'));
  for (const u of [`/api/files/${stored.file.key}`, `/api/files/${stored.file.key.replace(/^private\//, '')}`, `/api/files/../${stored.file.key}`, `/uploads/${stored.file.key}`]) {
    const r = await agent(t.base).get(u);
    assert.ok(!r.text.startsWith('%PDF'), `private file leaked at ${u} (${r.status})`);
  }
  const own = await p.get(`/api/me/records/${rec.id}/file`);
  assert.equal(own.status, 200); assert.ok(own.text.startsWith('%PDF'));
  assert.equal(own.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await stranger.get(`/api/me/records/${rec.id}/file`)).status, 404);
  assert.equal((await stranger.del(`/api/me/records/${rec.id}`)).status, 404);
  assert.equal((await agent(t.base).get(`/api/me/records/${rec.id}/file`)).status, 401);
  // disguised / unsafe upload
  const evil = await h.uploadRecord(p, { title: 'evil' }, Buffer.from('<html><script>alert(1)</script></html>'));
  assert.ok([400, 415].includes(evil.status), `got ${evil.status}`);
  t.uploadCase = { p, rec };
});

test('sharing: the booking doctor sees records only after consent-share, only that doctor, until revoked', async () => {
  const { p, rec } = t.uploadCase;
  const b = await h.mkBooking(p.user, { daysFromToday: 1 });
  const none = await doc.get(`/api/doctor-portal/bookings/${b.id}/records`);
  assert.equal(none.status, 200); assert.equal(none.body.shared, false); assert.equal(none.body.records.length, 0);
  assert.equal((await doc.get(`/api/doctor-portal/bookings/${b.id}/records/${rec.id}/file`)).status, 404);
  const sh = await p.post(`/api/me/bookings/${b.id}/share`, { recordIds: [rec.id], days: 3 });
  assert.equal(sh.status, 200, sh.text);
  assert.ok(await M.Consent.exists({ userId: p.user.id, purpose: 'record_sharing', granted: true }));
  const yes = await doc.get(`/api/doctor-portal/bookings/${b.id}/records`);
  assert.equal(yes.body.shared, true); assert.deepEqual(yes.body.records.map(r => r.id), [rec.id]);
  const f = await doc.get(`/api/doctor-portal/bookings/${b.id}/records/${rec.id}/file`);
  assert.equal(f.status, 200);
  assert.equal((await doc2.get(`/api/doctor-portal/bookings/${b.id}/records`)).status, 404, 'other doctor');
  // a different patient's booking cannot be used to share
  const stranger = await h.patient('Share Stranger');
  assert.equal((await stranger.post(`/api/me/bookings/${b.id}/share`, { allRecords: true })).status, 404);
  // revoke
  assert.equal((await p.del(`/api/me/bookings/${b.id}/share`)).status, 200);
  assert.equal((await doc.get(`/api/doctor-portal/bookings/${b.id}/records`)).body.shared, false);
  assert.equal((await doc.get(`/api/doctor-portal/bookings/${b.id}/records/${rec.id}/file`)).status, 404);
  // withdrawing health-data consent also stops any active share
  await p.post(`/api/me/bookings/${b.id}/share`, { allRecords: true });
  await p.post('/api/me/consents', { consents: [{ purpose: 'health_data', granted: false }] });
  assert.equal((await doc.get(`/api/doctor-portal/bookings/${b.id}/records`)).body.shared, false);
});

test('ABHA is OFF by default (env-gated stub): status says disabled and linking is refused', async () => {
  const p = await h.patient('Abha Off');
  const s = await p.get('/api/me/abha');
  assert.equal(s.status, 200); assert.equal(s.body.enabled, false);
  const r = await p.post('/api/me/abha/init', { abhaNumber: '12-3456-7890-1234' });
  assert.ok([404, 503].includes(r.status), `got ${r.status}`);
});
