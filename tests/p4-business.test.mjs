// Phase 4: earnings analytics + GST invoice / statement PDFs; labs (admin catalogue, booking, Razorpay mock, status,
// report -> health record, ledger/GST/commission, partner API); DPDP consents, export, deletion + anonymisation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, agent, login } from './helpers.mjs';
import { p4 } from './p4-helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let t, M, h, admin;
before(async () => { t = await boot({ PAYMENTS_MODE: 'mock' }); M = t.models; h = p4(t); admin = await h.admin(); });
after(async () => { await t?.close(); });

// ---------------------------------------------------------------- earnings
test('earnings analytics, GST invoices (owner-only PDF) and statement PDF for a doctor', async () => {
  const inv = await M.LedgerTransaction.findOne({ partyType: 'doctor' }).lean();
  assert.ok(inv, 'seed has doctor subscription invoices');
  const d = await M.Doctor.findOne({ id: inv.partyId }).lean();
  const doc = agent(t.base); await login(doc, d.phone.replace(/\D/g, '').slice(-10), 'doctor');
  const e = await doc.get('/api/doctor-portal/earnings?period=fy');
  assert.equal(e.status, 200, e.text);
  for (const k of ['bookings', 'noShowRate', 'revenue', 'payouts', 'ratings', 'series']) assert.ok(k in e.body, k);
  assert.equal(typeof e.body.revenue.net, 'number');
  assert.ok(Array.isArray(e.body.series));
  const list = await doc.get('/api/doctor-portal/invoices');
  assert.ok(list.body.invoices.some(x => x.id === inv.id));
  assert.ok(!JSON.stringify(list.body).includes('partyPhone'));
  const pdf = await doc.get(`/api/doctor-portal/invoices/${inv.id}/pdf`);
  assert.equal(pdf.status, 200); assert.ok(pdf.text.startsWith('%PDF'));
  const st = await doc.get('/api/doctor-portal/earnings/statement.pdf?from=2026-04-01&to=2026-10-20');
  assert.equal(st.status, 200); assert.ok(st.text.startsWith('%PDF'));
  // another doctor cannot download this invoice
  const other = await M.Doctor.findOne({ id: { $ne: d.id }, status: 'active' }).lean();
  const doc2 = agent(t.base); await login(doc2, other.phone.replace(/\D/g, '').slice(-10), 'doctor');
  assert.equal((await doc2.get(`/api/doctor-portal/invoices/${inv.id}/pdf`)).status, 404);
  assert.equal((await doc.get('/api/doctor-portal/earnings/statement.pdf?from=2026-13-01&to=x')).status, 400);
  const pat = await h.patient('Not A Doctor');
  assert.ok([401, 403].includes((await pat.get('/api/doctor-portal/earnings')).status));
});

// ---------------------------------------------------------------- labs
test('labs: admin catalogue + partner key; patient books, pays (mock Razorpay); status flow; report lands in the private health record; ledger/GST/commission', async () => {
  const lab = await admin.post('/api/admin/labs', { name: 'Test Diagnostics', city: 'Kochi', gstin: '32AAACT1234A1Z9', accreditation: 'NABL', commissionPercent: 20, collectionWindows: ['07:00-09:00'] });
  assert.equal(lab.status, 200, lab.text);
  const labId = (lab.body.lab || lab.body.item).id;
  const tst = await admin.post(`/api/admin/labs/${labId}/tests`, { name: 'Thyroid profile (T3 T4 TSH)', category: 'Thyroid', price: 500, tatHours: 12 });
  assert.equal(tst.status, 200, tst.text);
  const testId = (tst.body.test || tst.body.item).id;
  assert.equal((await admin.post(`/api/admin/labs/${labId}/tests`, { name: 'x', price: -1 })).status, 400);
  const key = await admin.post(`/api/admin/labs/${labId}/partner-key`);
  assert.equal(key.status, 200); const apiKey = key.body.apiKey;
  const adminList = await admin.get('/api/admin/labs');
  assert.ok(!JSON.stringify(adminList.body).includes('partnerKeyHash') && !JSON.stringify(adminList.body).includes(apiKey));
  // public catalogue
  const pub = await agent(t.base).get(`/api/lab-tests?labId=${labId}&search=thyroid`);
  assert.equal(pub.body.tests.length, 1); assert.equal(pub.body.tests[0].price, 500);
  // patient order with home collection (client prices ignored)
  const p = await h.patient('Lab Patient');
  await p.post('/api/me/consents', { consents: [{ purpose: 'health_data', granted: true }] });
  const { todayIST, addDays } = await import(path.join(ROOT, 'server/lib/time.js'));
  const o = await p.post('/api/lab-orders', { labId, testIds: [testId], mode: 'home_collection', slotDate: addDays(todayIST(), 1), slotWindow: '07:00-09:00', address: { line1: '12 MG Road', city: 'Kochi', state: 'Kerala', pincode: '682016' }, total: 1 });
  assert.equal(o.status, 200, o.text);
  assert.ok(o.body.payment && o.body.labOrder.status === 'AwaitingPayment');
  assert.ok(o.body.labOrder.total > 500, 'tests + home collection fee');
  const paid = await h.pay(p, o.body.payment.orderId);
  assert.equal(paid.labOrder.status, 'Confirmed');
  const orderId = paid.labOrder.id;
  const led = await M.LedgerTransaction.find({ labOrderId: orderId }).lean();
  const sale = led.find(x => x.type === 'lab_order'); const comm = led.find(x => x.type === 'lab_commission');
  assert.ok(sale && sale.invoiceNumber && sale.partyType === 'patient');
  assert.ok(comm && comm.partyType === 'lab' && comm.gstRate === 18 && comm.taxableValue > 0, 'platform commission invoice to the lab with GST');
  assert.equal(Math.round(comm.taxableValue), 100, '20% of the 500 test price');
  // another patient cannot see / cancel it
  const stranger = await h.patient('Lab Stranger');
  assert.equal((await stranger.get(`/api/lab-orders/${orderId}`)).status, 404);
  assert.equal((await stranger.post(`/api/lab-orders/${orderId}/cancel`, {})).status, 404);
  // partner API: wrong key refused; right key advances status
  assert.equal((await agent(t.base).req('GET', '/api/lab-partner/orders', { headers: { 'X-Lab-Key': 'nope' }, origin: null })).status, 401);
  const st = await agent(t.base).req('POST', `/api/lab-partner/orders/${orderId}/status`, { body: { status: 'SampleCollected' }, headers: { 'X-Lab-Key': apiKey }, origin: null });
  assert.equal(st.status, 200, st.text);
  assert.equal((await p.post(`/api/lab-orders/${orderId}/cancel`, {})).status, 400, 'no cancel after collection');
  assert.equal((await admin.post(`/api/admin/lab-orders/${orderId}/status`, { status: 'Processing' })).status, 200);
  // admin uploads the report -> private health record of the patient
  const rep = await admin.req('POST', `/api/admin/lab-orders/${orderId}/report`, { form: h.form(await h.pdf('TSH 2.1'), 'tsh.pdf', 'application/pdf', { title: 'Thyroid report' }) });
  assert.equal(rep.status, 200, rep.text);
  const ord = (await p.get(`/api/lab-orders/${orderId}`)).body.labOrder;
  assert.equal(ord.status, 'ReportReady');
  const recs = (await p.get('/api/me/records?type=lab_report')).body.items;
  const r = recs.find(x => x.labOrderId === orderId || /Thyroid/.test(x.title));
  assert.ok(r, 'report in health record');
  const f = await p.get(`/api/me/records/${r.id}/file`);
  assert.equal(f.status, 200); assert.ok(f.text.startsWith('%PDF'));
  assert.equal((await stranger.get(`/api/me/records/${r.id}/file`)).status, 404);
  assert.ok(await M.ScheduledMessage.exists({ kind: 'lab_status', refId: orderId }));
  t.labCase = { p, orderId };
});

test('labs: unpaid orders can be cancelled before collection with a full refund + credit note', async () => {
  const p = await h.patient('Lab Cancel');
  const tests = (await agent(t.base).get('/api/lab-tests?labId=demo-lab-1')).body.tests;
  const { todayIST, addDays } = await import(path.join(ROOT, 'server/lib/time.js'));
  const o = await p.post('/api/lab-orders', { labId: 'demo-lab-1', testIds: [tests[0].id], mode: 'lab_visit', slotDate: addDays(todayIST(), 2) });
  assert.equal(o.status, 200, o.text);
  await h.pay(p, o.body.payment.orderId);
  const c = await p.post(`/api/lab-orders/${o.body.labOrder.id}/cancel`, {});
  assert.equal(c.status, 200, c.text);
  const after = await M.LabOrder.findOne({ id: o.body.labOrder.id }).lean();
  assert.equal(after.status, 'Cancelled');
  assert.ok(await M.LedgerTransaction.exists({ labOrderId: after.id, documentType: { $ne: 'invoice' } }), 'credit note / refund voucher');
});

// ---------------------------------------------------------------- DPDP
test('DPDP: notice + consent records, export, deletion grace period then anonymisation that keeps GST records', async () => {
  const { p, orderId } = t.labCase;
  const pr = await p.get('/api/me/privacy');
  assert.equal(pr.status, 200); assert.equal(pr.body.needsNotice, true);
  assert.equal((await p.post('/api/me/consents', { consents: [{ purpose: 'privacy_notice', granted: false }] })).status, 400);
  await p.post('/api/me/consents', { consents: [{ purpose: 'privacy_notice', granted: true }, { purpose: 'marketing', granted: false }], method: 'onboarding' });
  assert.equal((await p.get('/api/me/privacy')).body.needsNotice, false);
  const rows = await M.Consent.find({ userId: p.user.id }).lean();
  assert.ok(rows.some(r => r.purpose === 'privacy_notice' && r.granted && r.version));
  assert.ok(rows.every(r => r.at || r.createdAt));
  assert.equal((await p.post('/api/me/consents', { consents: [{ purpose: 'record_sharing', granted: true }] })).status, 400, 'not directly settable');
  // export
  const ex = await p.get('/api/me/export');
  assert.equal(ex.status, 200);
  assert.match(ex.headers.get('content-disposition'), /attachment/);
  const data = ex.body;
  assert.equal(data.profile?.phone || data.user?.phone, p.user.phone);
  assert.ok(JSON.stringify(data).includes(orderId), 'lab orders exported');
  for (const bad of ['partnerKeyHash', 'otpHash', 'refreshTokenHash', 'tokenHash', 'passwordHash']) assert.ok(!JSON.stringify(data).includes(bad), bad);
  // deletion request with grace period, cancel, request again
  assert.equal((await p.post('/api/me/deletion', { confirm: 'delete' })).status, 400);
  const d1 = await p.post('/api/me/deletion', { confirm: 'DELETE', reason: 'Moving abroad' });
  assert.equal(d1.status, 200, d1.text);
  const days = (new Date(d1.body.deletion.scheduledFor) - Date.now()) / 86400000;
  assert.ok(days > 29 && days <= 30.01, `30-day grace, got ${days}`);
  assert.equal((await p.del('/api/me/deletion')).status, 200);
  assert.equal((await p.post('/api/me/deletion', { confirm: 'DELETE' })).status, 200);
  const upcoming = await h.mkBooking(p.user, { daysFromToday: 3 });
  const ledgerBefore = await M.LedgerTransaction.find({ partyType: 'patient', partyId: p.user.id }).lean();
  assert.ok(ledgerBefore.length > 0);
  // grace period over -> sweep anonymises
  await M.User.updateOne({ id: p.user.id }, { $set: { 'deletion.scheduledFor': new Date(Date.now() - 1000) } });
  const { sweepDeletions } = await import(path.join(ROOT, 'server/lib/privacy.js'));
  assert.equal(await sweepDeletions(), 1);
  const u = await M.User.findOne({ id: p.user.id }).lean();
  assert.equal(u.status, 'deleted'); assert.ok(u.anonymisedAt);
  assert.notEqual(u.phone, p.user.phone); assert.equal(u.familyMembers.length, 0); assert.equal(u.email, '');
  assert.equal(await M.HealthRecord.countDocuments({ userId: p.user.id }), 0, 'health records deleted');
  assert.equal((await M.Booking.findOne({ id: upcoming.id }).lean()).status, 'Cancelled', 'upcoming visit cancelled');
  const ledgerAfter = await M.LedgerTransaction.find({ partyType: 'patient', partyId: p.user.id }).lean();
  assert.equal(ledgerAfter.length, ledgerBefore.length, 'GST records kept');
  for (const l of ledgerAfter) {
    const b = ledgerBefore.find(x => x.id === l.id);
    assert.equal(l.invoiceNumber, b.invoiceNumber); assert.equal(l.totalAmount, b.totalAmount); assert.equal(l.totalTax, b.totalTax);
    assert.notEqual(l.partyName, p.user.name); assert.equal(l.partyPhone, '');
  }
  const lo = await M.LabOrder.findOne({ id: orderId }).lean();
  assert.equal(lo.patientPhone, ''); assert.ok(lo.total > 0 && lo.anonymised);
  // old session no longer works; phone can sign up fresh
  assert.ok([401, 403].includes((await p.get('/api/me')).status), 'old access token refused');
  assert.equal(await M.AuthSession.countDocuments({ kind: 'user', subject: p.user.id, revokedAt: null }), 0, 'all sessions revoked');
  assert.equal(await sweepDeletions(), 0, 'idempotent');
  const fresh = agent(t.base);
  const again = await login(fresh, p.user.phone.replace(/\D/g, '').slice(-10), 'patient', 'New Me');
  assert.notEqual(again.user.id, p.user.id);
});

test('admin can see pending deletions; patients cannot', async () => {
  const r = await admin.get('/api/admin/privacy/deletions');
  assert.equal(r.status, 200, r.text);
  const p = await h.patient('Nosy');
  assert.ok([401, 403].includes((await p.get('/api/admin/privacy/deletions')).status));
});
