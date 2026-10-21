// Phase 4: triage + 108 banner data, i18n dictionaries, search filters, verified-visit reviews, family booking, follow-up.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, agent, login, pickSlot } from './helpers.mjs';
import { p4 } from './p4-helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let t, M, h;
before(async () => { t = await boot({ PAYMENTS_MODE: 'mock' }); M = t.models; h = p4(t); });
after(async () => { await t?.close(); });

// ---------------------------------------------------------------- triage
test('red-flag symptoms return the emergency stage with 108/112 (no doctor list)', async () => {
  const a = agent(t.base);
  for (const text of ['severe chest pain spreading to left arm and sweating', 'നെഞ്ചുവേദന', 'seene mein dard', 'face drooping and slurred speech']) {
    const r = await a.post('/api/ai-symptom-triage', { symptomsText: text });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.stage, 'emergency', text);
    assert.equal(r.body.urgencyLevel, 'emergency');
    const nums = r.body.emergencyNumbers.map(n => n.number);
    assert.ok(nums.includes('108') && nums.includes('112'), text);
    assert.ok(!r.body.matchingDoctors?.length, 'no doctors in an emergency');
  }
  // suicidal ideation adds the Tele-MANAS helpline
  const s = await a.post('/api/ai-symptom-triage', { symptomsText: 'I want to kill myself' });
  assert.equal(s.body.stage, 'emergency');
  assert.ok(s.body.emergencyNumbers.some(n => n.id === 'telemanas'));
  // a ticked warning sign in the checklist also escalates
  const w = await a.post('/api/ai-symptom-triage', { symptomsText: 'fever and cough', answers: { warning: ['breathing'] } });
  assert.equal(w.body.stage, 'emergency');
});

test('non-emergency triage asks follow-up questions, then returns a specialist (Manglish + Hindi)', async () => {
  const a = agent(t.base);
  const q = await a.post('/api/ai-symptom-triage', { symptomsText: 'pani and chuma for two days' });
  assert.equal(q.body.stage, 'questions');
  assert.ok(q.body.questions.includes('warning'));
  const r = await a.post('/api/ai-symptom-triage', { symptomsText: 'pani and chuma for two days', answers: { warning: [], duration: '1to3d', severity: 4, age: 30, sex: 'male', conditions: ['none'] } });
  assert.equal(r.body.stage, 'result', r.text);
  assert.ok(r.body.detectedIllnessCategory);
  assert.equal(r.body.urgencyLevel, 'routine');
  const hi = await a.post('/api/ai-symptom-triage', { symptomsText: 'घुटनों में दर्द', skipQuestions: true, lang: 'hi' });
  assert.equal(hi.body.stage, 'result');
  assert.match(hi.body.detectedIllnessCategory, /Ortho/i);
  // high severity => priority
  const p = await a.post('/api/ai-symptom-triage', { symptomsText: 'stomach pain', answers: { warning: [], duration: 'lt1d', severity: 9, age: 40, sex: 'female', pregnancy: 'no', conditions: [] } });
  assert.equal(p.body.urgencyLevel, 'priority');
});

test('nearest hospitals endpoint for the emergency banner', async () => {
  const r = await agent(t.base).get('/api/emergency/hospitals?lat=9.97&lng=76.28');
  assert.equal(r.status, 200, r.text);
  assert.ok(Array.isArray(r.body.hospitals));
  assert.match(r.body.mapsSearchUrl, /^https:\/\/www\.google\.com\/maps/);
  for (const x of r.body.hospitals) { assert.ok(typeof x.distanceKm === 'number'); assert.ok(x.directionsUrl.startsWith('https://')); }
  assert.equal((await agent(t.base).get('/api/emergency/hospitals?lat=999&lng=1')).status, 400);
});

// ---------------------------------------------------------------- i18n
const load = async l => (await import(path.join(ROOT, `src/i18n/${l}.js`))).default;
test('i18n: en/ml/hi have identical keys and placeholders; every static t() key exists', async () => {
  const [en, ml, hi] = await Promise.all(['en', 'ml', 'hi'].map(load));
  const ph = s => (String(s).match(/\{\w+\}/g) || []).sort().join();
  for (const [name, d] of [['ml', ml], ['hi', hi]]) {
    assert.deepEqual(Object.keys(d).sort(), Object.keys(en).sort(), `${name} keys`);
    for (const k of Object.keys(en)) assert.equal(ph(d[k]), ph(en[k]), `${name} placeholders for ${k}`);
  }
  const used = new Set();
  const walk = dir => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.jsx?$/.test(f.name)) for (const m of fs.readFileSync(p, 'utf8').matchAll(/\b(?:t|tr)\('([a-zA-Z0-9_.]+)'/g)) used.add(m[1]); } };
  walk(path.join(ROOT, 'src'));
  const missing = [...used].filter(k => !(k in en));
  assert.deepEqual(missing, [], 'keys used in src but missing from en.js');
  const { LEGAL } = await import(path.join(ROOT, 'src/i18n/legal.js'));
  for (const l of ['en', 'ml', 'hi']) for (const k of ['privacy', 'terms', 'grievance']) assert.ok(LEGAL[l][k].length >= 3, `${l}.${k}`);
  assert.notEqual(ml['nav.doctors'], en['nav.doctors']);
  assert.notEqual(hi['nav.doctors'], en['nav.doctors']);
});

test('i18n: language switch is persisted on the account and validated', async () => {
  const a = agent(t.base); await login(a, '9000041001', 'patient', 'Lang User');
  const r = await a.put('/api/me/preferences', { preferredLanguage: 'ml' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.user.preferredLanguage, 'ml');
  assert.equal((await a.get('/api/me')).body.user.preferredLanguage, 'ml');
  assert.equal((await a.put('/api/me/preferences', { preferredLanguage: 'fr' })).status, 400);
  assert.equal((await agent(t.base).put('/api/me/preferences', { preferredLanguage: 'hi' })).status, 401);
});

// ---------------------------------------------------------------- filters
test('filters: gender, language, fee range, insurer, video, available today', async () => {
  const a = agent(t.base);
  const all = (await a.get('/api/doctors')).body.doctors;
  assert.ok(all.length > 5);
  const g = (await a.get('/api/doctors?gender=female')).body.doctors;
  assert.ok(g.length && g.length < all.length && g.every(d => d.gender === 'female'));
  const ml = (await a.get('/api/doctors?language=malayalam')).body.doctors;
  assert.ok(ml.length && ml.every(d => d.languages.some(l => /^malayalam$/i.test(l))));
  const fee = (await a.get('/api/doctors?minFee=0&maxFee=500')).body.doctors;
  assert.ok(fee.length < all.length);
  for (const d of fee) { const doc = await M.Doctor.findOne({ id: d.id }).lean(); assert.ok(doc.consultationLocations.some(l => l.isActive !== false && (l.fee || 0) <= 500), d.id); }
  const ins = await a.get('/api/insurers');
  assert.ok(ins.body.insurers.includes('Star Health'));
  const si = (await a.get('/api/doctors?insurer=star%20health')).body.doctors;
  assert.ok(si.length > 0 && si.length < all.length);
  const vid = (await a.get('/api/doctors?video=true')).body.doctors;
  for (const d of vid) { const doc = await M.Doctor.findOne({ id: d.id }).lean(); assert.ok(doc.consultationLocations.some(l => l.kind === 'online' && l.isActive !== false)); }
  // available today: a doctor whose every remaining slot today is taken drops out
  const today = (await a.get('/api/doctors?availableToday=true')).body.doctors;
  assert.ok(Array.isArray(today));
  await M.Doctor.updateOne({ id: 'demo-doc-1' }, { $set: { bookingEnabled: false } });
  assert.ok(!(await a.get('/api/doctors?availableToday=true')).body.doctors.some(d => d.id === 'demo-doc-1'));
  await M.Doctor.updateOne({ id: 'demo-doc-1' }, { $set: { bookingEnabled: true } });
  // regex input is escaped (no ReDoS / injection)
  assert.equal((await a.get('/api/doctors?language=' + encodeURIComponent('.*'))).body.doctors.length, 0);
});

test('verified council badge is exposed and toggled only by admin', async () => {
  const a = agent(t.base);
  const d = (await a.get('/api/doctors/demo-doc-1')).body.doctor || (await a.get('/api/doctors/demo-doc-1')).body;
  assert.equal(typeof d.registrationVerified, 'boolean');
  assert.ok(d.registrationNumber && d.councilName);
  const admin = await h.admin();
  const r = await admin.post('/api/admin/doctors/demo-doc-3/registration', { verified: true });
  assert.equal(r.status, 200, r.text);
  assert.equal((await M.Doctor.findOne({ id: 'demo-doc-3' }).lean()).registrationVerified, true);
  const p = agent(t.base); await login(p, '9000041002', 'patient', 'Not Admin');
  assert.ok([401, 403].includes((await p.post('/api/admin/doctors/demo-doc-3/registration', { verified: false })).status));
});

// ---------------------------------------------------------------- verified-visit reviews
test('reviews: only from my own COMPLETED booking, once, labelled verifiedVisit; public view hides ids', async () => {
  const a = await h.patient('Reviewer One');
  const other = await h.patient('Someone Else');
  const done = await h.mkBooking(a.user, { status: 'Completed', daysFromToday: -2 });
  const upcoming = await h.mkBooking(a.user, { status: 'Confirmed', daysFromToday: 2 });
  assert.equal((await a.post('/api/reviews', { doctorId: 'demo-doc-1', rating: 5, comment: 'no booking given' })).status, 400);
  assert.equal((await a.post('/api/reviews', { bookingId: upcoming.id, rating: 5, comment: 'Not visited yet' })).status, 403);
  assert.equal((await other.post('/api/reviews', { bookingId: done.id, rating: 1, comment: 'Not my booking!' })).status, 404);
  const ok = await a.post('/api/reviews', { bookingId: done.id, rating: 4, comment: 'Very kind and on time' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await a.post('/api/reviews', { bookingId: done.id, rating: 3, comment: 'Second try here' })).status, 409);
  const rev = await M.Review.findOne({ bookingId: done.id }).lean();
  assert.equal(rev.verifiedVisit, true);
  await M.Review.updateOne({ id: rev.id }, { $set: { moderationStatus: 'visible' } });
  const pub = await agent(t.base).get('/api/doctors/demo-doc-1');
  const mine = (pub.body.reviews || pub.body.doctor?.reviews).find(r => r.id === rev.id || r.comment === 'Very kind and on time');
  assert.ok(mine, pub.text.slice(0, 300));
  assert.equal(mine.verifiedVisit, true);
  assert.ok(!('userId' in mine) && !('bookingId' in mine) && !('userPhone' in mine));
  const bl = (await a.get('/api/me/bookings')).body;
  assert.equal((bl.bookings || bl.items).find(b => b.id === done.id).reviewed, true);
});

// ---------------------------------------------------------------- family + follow-up
test('family member with photo; booking for the member; other users cannot use the member id', async () => {
  const a = await h.patient('Family Head');
  const up = await h.uploadImage(a, 'member_photo');
  assert.equal(up.status, 200, up.text);
  const photo = up.body.url;
  const m = await a.post('/api/me/family', { name: 'Little Ammu', relation: 'child', gender: 'female', dob: '2019-04-02', photo });
  assert.equal(m.status, 200, m.text);
  assert.equal(m.body.member.photo, photo);
  assert.equal((await a.post('/api/me/family', { name: 'Bad Photo', relation: 'child', photo: 'https://evil.example/x.png' })).status, 400);
  const b = await h.book(a, { memberId: m.body.member.id });
  assert.equal(b.booking.forMember.id, m.body.member.id);
  assert.equal(b.booking.patientName, 'Little Ammu');
  const other = await h.patient('Intruder');
  const slot = await pickSlot(other, 'demo-doc-1', 'demo-loc-1-o', h.used);
  assert.equal((await other.post('/api/bookings', { doctorId: 'demo-doc-1', locationId: 'demo-loc-1-o', ...slot, memberId: m.body.member.id })).status, 400);
});

test('follow-up booking links to my earlier visit with the same doctor and same patient only', async () => {
  const a = await h.patient('Follow Up');
  const prev = await h.mkBooking(a.user, { status: 'Completed', daysFromToday: -7 });
  const b = await h.book(a, { followUpOf: prev.id });
  assert.equal((await M.Booking.findOne({ id: b.booking.id }).lean()).followUpOf, prev.id);
  const other = await h.patient('Not Mine');
  const slot = await pickSlot(other, 'demo-doc-1', 'demo-loc-1-o', h.used);
  assert.equal((await other.post('/api/bookings', { doctorId: 'demo-doc-1', locationId: 'demo-loc-1-o', ...slot, followUpOf: prev.id })).status, 400);
  const d2 = await M.Doctor.findOne({ id: { $ne: 'demo-doc-1' }, status: 'active', bookingEnabled: { $ne: false }, 'consultationLocations.kind': 'own_clinic' }).lean();
  const l2 = d2.consultationLocations.find(l => l.kind === 'own_clinic').id;
  const slot2 = await pickSlot(a, d2.id, l2, h.used);
  assert.equal((await a.post('/api/bookings', { doctorId: d2.id, locationId: l2, ...slot2, followUpOf: prev.id })).status, 400);
});

test('legal contact endpoint (grievance officer) is public', async () => {
  const r = await agent(t.base).get('/api/legal/contact');
  assert.equal(r.status, 200);
  assert.ok(r.body.grievanceOfficer.email);
  assert.equal(r.body.responseTimeDays, 30);
});
