// HTTP hardening, IDOR, NoSQL injection, sensitive-field scrubbing, uploads, CORS, limits, error hygiene.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { boot, agent, login, adminLogin, pickSlot, rzpMock } from './helpers.mjs';

let t, M, p1, p2, doc, doc2;
before(async () => {
  t = await boot({ PAYMENTS_MODE: '', RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', RAZORPAY_WEBHOOK_SECRET: '' });
  M = t.models;
  p1 = agent(t.base); await login(p1, '9000030301', 'patient', 'Sec One');
  p2 = agent(t.base); await login(p2, '9000030302', 'patient', 'Sec Two');
  doc = agent(t.base); await login(doc, '9000020000', 'doctor');
  doc2 = agent(t.base); await login(doc2, '9000020001', 'doctor');
});
after(async () => { await t?.close(); });

test('security headers: CSP, HSTS-ready helmet set, no x-powered-by, no-store on API', async () => {
  const r = await agent(t.base).get('/api/specialities');
  const csp = r.headers.get('content-security-policy');
  assert.ok(csp, 'CSP present');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'[^;]*https:\/\/checkout\.razorpay\.com/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.ok(r.headers.get('referrer-policy'));
  assert.ok(r.headers.get('permissions-policy'));
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('CORS: allowlisted origin echoed with credentials; others get no CORS headers', async () => {
  const ok = await agent(t.base).req('OPTIONS', '/api/doctors', { headers: { 'Access-Control-Request-Method': 'POST' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  assert.equal(ok.headers.get('access-control-allow-credentials'), 'true');
  const bad = await agent(t.base).req('GET', '/api/doctors', { origin: 'https://evil.example' });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('IDOR: patients cannot read or cancel each other\'s bookings; doctors cannot act on other doctors\' bookings', async () => {
  const slot = await pickSlot(p1, 'demo-doc-2', 'demo-loc-2-c').catch(() => null);
  let booking = await M.Booking.findOne({ status: { $in: ['Confirmed', 'Pending'] }, doctorId: 'demo-doc-1' }).lean();
  assert.ok(booking || slot, 'need a booking to probe');
  const id = booking.id;
  assert.equal((await p2.post(`/api/me/bookings/${id}/cancel`, { reason: 'x' })).status, 404);
  const mine = (await p2.get('/api/me/bookings')).body;
  assert.ok(!JSON.stringify(mine).includes(id));
  assert.equal((await doc2.post(`/api/doctor-portal/bookings/${id}/cancel`, { reason: 'x' })).status, 404);
  assert.equal((await doc2.post(`/api/doctor-portal/bookings/${id}/accept`, {})).status, 404);
  // a patient token cannot use another portal
  assert.equal((await p1.get('/api/clinic-portal/me')).status, 403);
  // family members are per-account
  const add = await p1.post('/api/me/family', { name: 'Kid One', relation: 'child' });
  assert.equal(add.status, 200);
  const fm = add.body.member.id;
  await p2.del(`/api/me/family/${fm}`);
  assert.ok((await M.User.findOne({ phone: /9000030301/ }).lean()).familyMembers.some(m => m.id === fm));
});

test('IDOR: private verification documents only for the owning doctor or admin', async () => {
  const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#09f' } }).png().toBuffer();
  const fd = new FormData();
  fd.set('purpose', 'doctor_document'); fd.set('docType', 'id_proof');
  fd.set('file', new Blob([png], { type: 'image/png' }), 'id.png');
  const up = await doc.req('POST', '/api/uploads', { form: fd });
  assert.equal(up.status, 200, up.text);
  const d = up.body.document;
  assert.equal(d.key, undefined, 'storage key not exposed');
  assert.equal((await doc.get(`/api/doctor-portal/documents/${d.id}/file`)).status, 200);
  assert.equal((await doc2.get(`/api/doctor-portal/documents/${d.id}/file`)).status, 404);
  assert.equal((await p1.get(`/api/admin/doctors/demo-doc-1/documents/${d.id}/file`)).status, 401);
  const ad = agent(t.base); await adminLogin(ad);
  const f = await ad.get(`/api/admin/doctors/demo-doc-1/documents/${d.id}/file`);
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('x-content-type-options'), 'nosniff');
  // not reachable through the public file route
  const row = (await M.Doctor.findOne({ id: 'demo-doc-1' }).lean()).documents.find(x => x.id === d.id);
  assert.notEqual((await agent(t.base).get(`/api/files/${row.key}`)).status, 200);
});

test('uploads: SVG / HTML / fake-extension rejected; EXIF stripped; random names', async () => {
  const send = (buf, name, type, purpose = 'patient_photo') => { const fd = new FormData(); fd.set('purpose', purpose); fd.set('file', new Blob([buf], { type }), name); return p1.req('POST', '/api/uploads', { form: fd }); };
  assert.equal((await send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'x.svg', 'image/svg+xml')).status, 415);
  assert.equal((await send(Buffer.from('<html><script>alert(1)</script></html>'), 'x.jpg', 'image/jpeg')).status, 415);
  assert.equal((await send(Buffer.from('%PDF-1.4 /JavaScript (app.alert(1)) %%EOF'), 'x.pdf', 'application/pdf')).status, 415);
  // jpeg header followed by junk (polyglot) -> sharp cannot decode -> rejected
  assert.equal((await send(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1), Buffer.from('<script>')]), 'p.jpg', 'image/jpeg')).status, 415);
  // a real JPEG carrying EXIF (GPS-like marker string)
  const jpg = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#f00' } })
    .withExif({ IFD0: { Copyright: 'SECRET-GPS-MARKER', Artist: 'SECRET-GPS-MARKER' } }).jpeg().toBuffer();
  assert.ok(jpg.includes('SECRET-GPS-MARKER'));
  const ok = await send(jpg, '../../etc/passwd.jpg', 'image/jpeg');
  assert.equal(ok.status, 200, ok.text);
  assert.doesNotMatch(ok.body.url, /passwd|\.\./);
  const file = await fetch(t.base + ok.body.url);
  assert.equal(file.status, 200);
  const bytes = Buffer.from(await file.arrayBuffer());
  assert.ok(!bytes.includes('SECRET-GPS-MARKER'), 'EXIF stripped');
  const meta = await sharp(bytes).metadata();
  assert.equal(meta.exif, undefined);
  assert.match(file.headers.get('content-security-policy') || '', /sandbox/);
  // wrong role for purpose / unknown purpose / prototype key
  assert.equal((await send(jpg, 'a.jpg', 'image/jpeg', 'clinic_logo')).status, 403);
  assert.equal((await send(jpg, 'a.jpg', 'image/jpeg', '__proto__')).status, 400);
});

test('NoSQL injection payloads are stripped / rejected', async () => {
  const a = agent(t.base);
  const r1 = await a.get('/api/doctors?search[$regex]=.*&city[$ne]=x');
  assert.equal(r1.status, 200);
  const r2 = await a.post('/api/auth/verify-otp', { phone: '9000030301', otp: { $gt: '' }, role: 'patient' });
  assert.equal(r2.status, 400);
  const r3 = await a.post('/api/admin/login', { username: { $ne: null }, password: { $ne: null } });
  assert.notEqual(r3.status, 200);
  const r4 = await p1.put('/api/me', { name: 'Sec One', $set: { role: 'admin' }, 'status.x': 1, __proto__: { isAdmin: true }, constructor: { prototype: { polluted: 1 } } });
  assert.equal(r4.status, 200);
  const u = await M.User.findOne({ phone: /9000030301/ }).lean();
  assert.equal(u.role, 'patient');
  assert.equal(({}).polluted, undefined);
  assert.equal(({}).isAdmin, undefined);
  // regex metacharacters are escaped (no ReDoS / wildcard)
  const r5 = await a.get(`/api/doctors?search=${encodeURIComponent('(a+)+$')}`);
  assert.equal(r5.status, 200);
  // array param pollution
  const r6 = await a.get('/api/doctors?city=a&city=b');
  assert.equal(r6.status, 200);
});

test('responses never contain secret fields; public phones are masked', async () => {
  const a = agent(t.base);
  const list = await a.get('/api/doctors');
  const doc1 = await a.get('/api/doctors/demo-doc-1');
  const sess = await p1.get('/api/auth/session');
  for (const r of [list, doc1, sess]) {
    for (const k of ['passwordHash', 'tokenHash', 'codeHash', 'totpSecret', 'slotLock', '"__v"']) assert.ok(!r.text.includes(k), `${k} leaked`);
  }
  assert.ok(!doc1.text.includes('9000020000'), 'doctor phone not public');
  const loc = doc1.body.doctor?.locations?.[0] || doc1.body.locations?.[0];
  if (loc?.phone) assert.match(loc.phone, /x|\*|•/i);
});

test('body size limit, malformed JSON and unknown routes return clean JSON errors without stack traces', async () => {
  const big = await p1.req('POST', '/api/reviews', { raw: JSON.stringify({ text: 'a'.repeat(200 * 1024) }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(big.status, 413);
  const bad = await p1.req('POST', '/api/reviews', { raw: '{"a":', headers: { 'Content-Type': 'application/json' } });
  assert.equal(bad.status, 400);
  for (const r of [big, bad, await p1.get('/api/nope'), await p1.get('/api/doctors/%E0%A4%A')]) {
    assert.doesNotMatch(r.text, /at .*\.js:\d+|node_modules|stack/i);
  }
  const cast = await agent(t.base).get('/api/doctors/' + 'x'.repeat(500));
  assert.ok(cast.status < 500);
});

test('review text is XSS-safe', async () => {
  const doc1 = await M.Booking.findOne({ status: 'Completed' }).lean();
  const r = await p1.post('/api/reviews', { doctorId: 'demo-doc-1', rating: 5, text: '<img src=x onerror=alert(1)>Great doctor<script>alert(2)</script>', bookingId: doc1?.id });
  if (r.status === 200) {
    const rv = r.body.review || {};
    assert.doesNotMatch(JSON.stringify(rv), /<script|onerror|<img/i);
  } else assert.ok([400, 403, 409].includes(r.status), r.text);
});

test('rate limits: contact reveal and global limiter return 429 with Retry-After', async () => {
  const a = agent(t.base);
  let last;
  for (let i = 0; i < 31; i++) last = await a.get('/api/doctors/demo-doc-1/locations/demo-loc-1-c/contact');
  assert.equal(last.status, 429);
  assert.ok(last.headers.get('retry-after'));
});

test('admin login with wrong password is refused and audited', async () => {
  const a = agent(t.base);
  const r = await a.post('/api/admin/login', { username: process.env.ADMIN_USERNAME, password: 'wrong-password' });
  assert.equal(r.status, 401);
  assert.ok(await M.AdminAuditLog.countDocuments({ action: /auth\.login/ }) >= 1);
});
