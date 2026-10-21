# FindADoc — Changes

Newest first: phase 4, phase 3 (Razorpay, security hardening), phase 2, then the phase 1 admin-panel notes.

# Phase 4: triage, languages, queue, reminders, health record, labs, DPDP

## Breaking changes and what to do after upgrading
1. **Nothing new is required in the 5-key dev `.env`.** The app starts as before. In development:
   - WhatsApp and SMS reminders print to the server console.
   - The scheduler runs every minute.
   - ABHA is off.
   - Signed booking links use a key derived from the JWT secret.
2. **Reviews need a completed booking.** `POST /api/reviews` now requires the `bookingId` of the caller's own **Completed** booking. Only one review is allowed per booking, and it is labelled "Verified visit". Old reviews stay visible.
3. **The patient consent gate.** After their next sign-in, every patient sees the privacy notice once and makes purpose-wise consent choices (stored with timestamps in `Consent`). Health-record uploads and WhatsApp/SMS reminders only happen with the matching consent.
4. **Production refuses unsafe phase-4 modes:**
   - `WHATSAPP_PROVIDER=console` or an unknown provider
   - `ABHA_PROVIDER=mock`
   - Meta, Gupshup or MSG91 WhatsApp without their keys
   - `ABHA_PROVIDER=sandbox` without the ABDM client id/secret
   - `REMINDER_SMS=true` without `SMS_PROVIDER` (and, with MSG91, without `MSG91_REMINDER_TEMPLATE_ID`)
   - invalid `WHATSAPP_TEMPLATES` JSON
   - a weak `BOOKING_LINK_SECRET`
   - Production also warns when `GRIEVANCE_OFFICER_*` is unset or `APP_BASE_URL` is not https.

### Migrations
- They run at startup from `runPhase4Migrations()` and are idempotent, guarded by `Counter` keys `phase4-*`. They log only when they change something.
- What they do:
  - Set the council-registration "verified" badge on doctors who already have a registration number plus an admin-verified registration certificate.
  - Initialise `queueStatus: 'waiting'` on bookings from yesterday onward.
  - Build a unique one-review-per-booking index. If duplicate reviews already exist, the index is skipped and a WARNING is logged; nothing is deleted.
  - Build indexes for the new collections: QueueDay, ScheduledMessage, WaitlistEntry, Prescription, HealthRecord, RecordShare, Lab, LabTest, LabOrder, Consent, AbhaTxn.
- Labs and the test catalogue are not migrated. Add them in **Admin → Labs**; the demo seed adds two demo labs in dev only.

## Features (spec items 1–13)
1. **AI triage**
   - A rule-based multi-step flow asks about duration, severity 1–10, age, sex, pregnancy and existing conditions.
   - Red flags (chest pain, FAST stroke signs, breathing difficulty, severe bleeding, unconsciousness, suicidal thoughts with Tele-MANAS 14416, infant fever and more) open a full-screen emergency banner. It has tel:108 and tel:112 buttons and the nearest 24×7/emergency hospitals (`GET /api/emergency/hospitals`).
   - A "not a diagnosis" disclaimer is shown, followed by the speciality and matching doctors.
2. **Languages (en/ml/hi)**
   - UI dictionaries are in `src/i18n` (656 keys, parity-tested). The switcher's choice is persisted locally and in the patient's `preferredLanguage`.
   - Symptom dictionaries cover English, Malayalam, Hindi, Manglish and Hinglish.
   - Voice input uses en-IN, ml-IN or hi-IN.
3. **Filters:** available today, language, gender, fee range, insurance/cashless (insurers listed by doctors and clinics), video consult, plus the existing distance and speciality filters.
4. **Verification and reviews**
   - The medical council name and registration number appear on profiles. The badge is admin-verified via `POST /api/admin/doctors/:id/registration`.
   - Reviews follow the verified-visit rule above.
5. **Live queue**
   - There is a queue per doctor, location and day.
   - Doctor and clinic panels can start, call next, mark done, skip, recall, pause/resume, set running late and set average consult time.
   - Patients see their token, position and ETA, polled every 20 s (staff panels every 15 s).
6. **Reminders**
   - A `server/lib/messaging` abstraction covers WhatsApp (Meta Cloud API, Gupshup, MSG91, console in dev) and SMS (reusing the phase-3 provider).
   - Messages cover booking confirmation, 24 h and 2 h reminders, "your turn soon" and medicine reminders.
   - A node-cron scheduler sends due `ScheduledMessage`s with retry/backoff.
   - HMAC-signed one-tap links at `/appointment/<token>` let patients view, reschedule or cancel. They expire and go stale after any change.
   - The waitlist works per day: a freed slot is offered first come, first served, with a time-limited hold that rolls over to the next person.
7. **Family profiles:** members have name, relation, DOB, gender and a photo. Patients can book for a member, and records are filtered per member.
8. **Health record**
   - Doctors write a digital prescription per booking: medicines with dosage, frequency and duration, advice, tests, follow-up date and visit notes. Private doctor notes are never shown to patients.
   - The prescription PDF (pdfkit) carries doctor details and council number.
   - Patients upload private lab reports (PDF or images) through the phase-3 secure upload pipeline into `private/` storage, streamed only to authorised users.
   - There is a timeline per patient or member.
   - Sharing with a booking's doctor is consent-based and can be revoked; withdrawing the health-data consent revokes all shares.
9. **Follow-up and medicine reminders:** a follow-up button on the prescription (suggested date) opens booking. Medicine reminders follow the prescription schedule, in-app, plus WhatsApp/SMS on opt-in.
10. **ABHA (optional, never mandatory)**
    - Fields and a link/unlink flow sit behind `server/lib/abha` (disabled | mock (dev) | sandbox ABDM adapter stub).
    - It is env-gated; every transaction is logged in `AbhaTxn` with consent rows.
11. **Earnings and analytics** (doctor and clinic portals)
    - Bookings, revenue, payouts, no-show rate, ratings and charts.
    - GST invoice PDFs for subscription payments and earnings statement PDFs, scoped to the signed-in entity.
12. **Labs**
    - Admins manage labs and partners and the test catalogue (price, MRP, preparation, TAT, home collection, collection windows).
    - Patients book a lab visit or home collection with address and slot, and pay via Razorpay (or mock in dev).
    - Status runs Confirmed → SampleCollected → Processing → ReportReady.
    - The lab or admin uploads the report into the patient's health record.
    - The ledger gets GST and the platform commission (default 20%, commission invoice); a cancel issues a refund and a credit note.
    - The lab partner API at `/api/lab-partner/*` uses the `X-Lab-Key` header; keys are shown once and stored hashed.
13. **DPDP Act 2023**
    - Privacy notice and consent screens: purpose-wise consent for health data, reminders and marketing opt-in, with timestamped consent records and withdrawal.
    - Download my data as JSON.
    - An account deletion request has a 30-day grace period (`DELETION_GRACE_DAYS`) that the user can cancel. After it, the scheduler anonymises the account and revokes sessions. Financial/GST ledger rows and invoices are kept with the name and phone removed.
    - Privacy policy, terms and grievance officer pages are available in en, ml and hi.
    - Admins get a deletion-requests view.

## Fixes found by the phase-4 regression
- The patient Profile page refetched `/api/me` in a loop: an inline parent callback re-triggered the effect, so one open page hit the global rate limit within minutes. The callback is now held in a ref.
- The phone "Add to home screen" banner covered the sticky lab-checkout bar. It is now hidden while the cart bar is shown.

## New dependencies
- `pdfkit` ^0.17.2 for server-side PDFs (prescriptions, GST invoices, statements, lab invoices). No headless browser is used.
- `node-cron` ^4.6.0 for the scheduler (`SCHEDULER_CRON`, default every minute).

## Environment keys (all optional; see `.env.example`)
- **WhatsApp:** `WHATSAPP_PROVIDER` (meta | gupshup | msg91 | disabled; console is dev-only), `META_WA_TOKEN`, `META_WA_PHONE_NUMBER_ID`, `META_WA_API_VERSION`, `GUPSHUP_API_KEY`, `GUPSHUP_SOURCE`, `GUPSHUP_APP_NAME`, `MSG91_WA_NUMBER`, `WHATSAPP_TEMPLATES` (JSON mapping message kinds to approved template names).
- **SMS reminders:** `REMINDER_SMS=true` (uses `SMS_PROVIDER`), `MSG91_REMINDER_TEMPLATE_ID`.
- **Links:** `APP_BASE_URL`, `BOOKING_LINK_SECRET` (≥32 random characters; derived from `USER_JWT_SECRET` when unset).
- **ABHA:** `ABHA_PROVIDER` (sandbox | disabled; mock is dev-only), `ABDM_CLIENT_ID`, `ABDM_CLIENT_SECRET`, `ABDM_BASE_URL`, `ABHA_BASE_URL`, `ABDM_PUBLIC_KEY`.
- **DPDP:** `GRIEVANCE_OFFICER_NAME`, `GRIEVANCE_OFFICER_EMAIL`, `GRIEVANCE_OFFICER_PHONE`, `GRIEVANCE_OFFICER_ADDRESS`, `DELETION_GRACE_DAYS` (0–90, default from Settings: 30).
- **Scheduler:** `SCHEDULER_CRON`, `SCHEDULER_ENABLED` (set `false` on all but one instance).
- **Production minimum for reminders:** a real `WHATSAPP_PROVIDER` with its keys and approved templates, or `REMINDER_SMS=true` with a DLT template. Also set `APP_BASE_URL` (https), `BOOKING_LINK_SECRET` and `GRIEVANCE_OFFICER_NAME`/`EMAIL`.

## Tests
- `npm test`: **98/98 pass** on throwaway in-memory MongoDB.
- New test files:
  - `p4-discovery`: triage, emergency, hospitals, i18n parity, filters, badge, verified reviews, family, follow-up, legal
  - `p4-queue-reminders`: queue plus IDOR, 24 h/2 h reminders plus consent, signed links, waitlist
  - `p4-health`: Rx, PDFs, private notes, private uploads with no static leak, share/revoke, ABHA off
  - `p4-abha`: mock link/unlink
  - `p4-business`: earnings/invoice IDOR, labs end to end with ledger, GST and commission, credit note, DPDP export/deletion/anonymisation
  - `config.test`: production refusals
- Headless Chrome (dist served by Express, CSP on) passed 16/16 flows on mobile and desktop widths with 0 console errors, 0 CSP violations and 0 HTTP errors. The flows covered: home and language switch, emergency and routine triage, filters, legal, doctor profile and booking, patient bookings with the queue card and reschedule, records upload, labs checkout to mock pay to tracking, privacy centre, profile and family, the signed manage link with cancel, doctor queue/earnings/Rx (desktop and mobile), clinic, and every admin section.
- `npm audit`: 0 vulnerabilities.

## Known limits
- The admin console and some older doctor/clinic portal screens are still English only. The patient app and all new panels are translated.
- PDFs use the built-in Latin fonts, so amounts show "Rs." and Malayalam/Hindi names are transliterated in PDFs. Embedding a Noto font would fix this.
- Live updates use polling, not SSE.
- The ABDM sandbox adapter is a documented stub that has not been run against the real ABDM sandbox. Production use needs ABDM onboarding and certification.
- Nearest hospitals come from listed clinics marked 24×7, emergency or hospital, plus a Google Maps search link. No third-party places API is used.


# Phase 3: Razorpay payments and security hardening

## Breaking changes and what to do after upgrading
1. **Everyone signs in again once.** The old `usr.` and admin tokens in localStorage / sessionStorage are ignored and removed.
   - Sessions now use a 15-minute access token held in memory, plus an httpOnly refresh cookie.
2. **Online payments are OFF in development until you choose a mode.** With the existing 5-key `.env`, paid bookings and subscription checkout answer **503 "Payments not configured"**. Free bookings and pay-at-clinic bookings still work. To get payments back, add one of these:
   - `PAYMENTS_MODE=mock` for the fake checkout used in phase 2 (development only), or
   - Razorpay **test** keys (see below).
3. **Demo OTP.** OTP 123456 still works in development when no `SMS_PROVIDER` is set, with a loud warning at startup. It is refused in production.
4. **Production refuses to start** when secrets are missing or weak, or when an unsafe mode is set. The message names the key; no values are printed. Required:
   - `USER_JWT_SECRET` and `ADMIN_JWT_SECRET`: ≥32 random characters each, and different from each other (`openssl rand -hex 32`)
   - `ADMIN_USERNAME`, plus `ADMIN_PASSWORD_HASH` (or a plaintext `ADMIN_PASSWORD` of ≥12 characters)
   - `SMS_PROVIDER` (msg91 or twilio)
   - `CORS_ORIGINS`
   - `MONGODB_URI`
   - Razorpay keys plus `RAZORPAY_WEBHOOK_SECRET` when payments are on
   - Refused outright: `OTP_DEMO_MODE=true`, `PAYMENTS_MODE=mock`, `SMS_PROVIDER=console`, and `*` in CORS.
5. **Public phone numbers are masked** in listings and profiles, e.g. `+91 98xxxxxx10`. The full number comes from a rate-limited "Call" tap (`GET /api/doctors/:id/locations/:locId/contact`).
6. **`PAYMENTS_MOCK_ENABLED` is removed.** Use `PAYMENTS_MODE`. `CORS_ORIGIN` and `USER_TOKEN_SECRET` are still read as legacy aliases of `CORS_ORIGINS` and `USER_JWT_SECRET`.
7. **The service worker cache was bumped** (`findadoc-v3`). The inline service-worker registration moved to `/register-sw.js`, so it is not blocked by the CSP.
8. **The payment hold is now 10 minutes.** It was 15. Existing Settings still at 15 are moved to 10 once; any other value is kept.

### Migrations
- They run automatically at startup.
- They are idempotent, guarded by `Counter` keys `phase3-*`, and only touch rows still in the old shape.
- What they do:
  - Hold minutes 15 → 10.
  - Backfill `PaymentOrder.refundedAmount` from the refunds list.
  - Build the unique partial index on `providerPaymentId`. If duplicates already exist, the index is **not** built; a warning is logged instead of crashing, so you can fix them first.
- New collections (they also get TTL indexes):
  - `authsessions`: hashed refresh tokens
  - `otpchallenges`: hashed OTPs
  - `adminloginstates`: lockout state, with a hashed username
  - `adminauditlogs`: kept 2 years
  - `webhookevents`: kept 90 days

## Razorpay (official `razorpay` SDK)
**Flow**
1. The server creates the booking or subscription and computes the price itself; amounts sent by the client are ignored.
2. It then creates a Razorpay **Order**:
   - amount in paise, currency `INR`
   - `receipt` = internal payment order id
   - `notes` = type, booking or plan, party, order id
   - `payment_capture` on
3. The client lazy-loads `checkout.js`. It gets `key_id` from `GET /api/payments/config` or from the order payload, never the secret. The customer's name and phone are prefilled.
4. `POST /api/payments/verify` `{orderId, paymentId, signature}` runs three checks:
   - **HMAC-SHA256** of `order_id|payment_id`, compared with `timingSafeEqual`
   - it **fetches the payment** from Razorpay and checks `order_id`, `amount` (paise), `currency` and status (`captured`; `authorized` payments are captured server-side)
   - it **atomically claims** the order (`created/expired/failed → processing`), so a double submit or webhook race settles once
   `providerPaymentId` is unique, so the same payment can never settle two orders. Ledger rows (GST invoice or pass-through receipt) are written only after a verified payment, and carry `razorpayOrderId` and `razorpayPaymentId`.
5. **Webhook** `POST /api/payments/razorpay/webhook`:
   - mounted with `express.raw` **before** the JSON parser
   - checks `X-Razorpay-Signature` with HMAC over the raw body
   - stores `X-Razorpay-Event-Id` in `webhookevents`, so a replayed event answers `200 {duplicate:true}` and does nothing
   - answers 200 quickly; processing runs in the background and failed events are retried by the 60-second sweep

**Events to subscribe:** `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`.
- `payment.captured` and `order.paid` settle orders whose browser callback never arrived (closed tab, network loss).
- `payment.failed` records the reason and attempt count. The hold is kept so the customer can retry inside the same checkout.
- `refund.processed` confirms a pending refund. A refund made in the Razorpay dashboard is mirrored as a credit note.
- `refund.failed` reverses the credit note, the payout claim and the booking refund status, and notifies the admin.

**Flows**
- **Subscriptions:** purchase, upgrade, renewal (extends from the current expiry) and change. The order stores `meta.kind`.
- **Bookings:**
  - PAID mode: platform fee plus consultation fee online
  - BOOKING-AMOUNT mode: platform fee plus token online; the rest is due at the clinic
- **Slot hold:** **10 minutes**. Abandoned checkouts (`/api/payments/fail` or the dismissed modal) are marked failed and the slot is released. Unpaid holds are expired by the sweep.
- **Late payments** (paid after the hold expired): the booking is revived if the slot is still free. Otherwise the payment is **refunded automatically in full** and the client gets 409 `HOLD_EXPIRED`.

**Refunds**
- Admin can refund in full or in part from **Bookings → Refund…**, **Ledger → Refund** (on an invoice or receipt row) or `POST /api/admin/payments/:orderId/refund`. Each one goes through the Razorpay Refunds API with notes.
- The pass-through (consultation) part is refunded first, then the platform fee.
- The refunded platform-fee part gets a **GST credit note** (`credit` series); the pass-through part gets a refund voucher. Both carry `razorpayRefundId`.
- Over-refunds are refused. Provider errors return 502 and nothing is booked.
- Cancellations by the doctor, clinic or admin refund in full. Patient cancellations follow the phase-2 policy (consultation part only when early enough).

**Payouts to doctors and clinics:** unchanged. They are manual, recorded with the bank UTR. RazorpayX automated payouts are listed as future work in SECURITY.md.

**Modes**
- `PAYMENTS_MODE=razorpay`, or both keys set → Razorpay.
- `mock` → fake checkout. Only when `NODE_ENV` is not production; production refuses to start.
- Otherwise → disabled (503).
- Startup log: `Payments mode: razorpay (TEST keys, webhook secret set)`. The secret is never logged.

### Setting up Razorpay (test mode)
1. Sign up at https://dashboard.razorpay.com. Switch to **Test Mode** (toggle at top) → **Account & Settings → API Keys → Generate Test Key**.
2. Put the keys in `.env`: `RAZORPAY_KEY_ID=rzp_test_…` and `RAZORPAY_KEY_SECRET=…`.
3. **Account & Settings → Webhooks → Add New Webhook**:
   - URL `https://<your-domain>/api/payments/razorpay/webhook` (for local testing use a tunnel such as `ngrok http 5055`)
   - Secret: `openssl rand -hex 32`, and put the same value in `RAZORPAY_WEBHOOK_SECRET`
   - Active events: `payment.captured`, `payment.failed`, `order.paid`, `refund.processed`, `refund.failed`
4. Restart. Test cards and UPI ids: https://razorpay.com/docs/payments/payments/test-card-details/ (for example UPI `success@razorpay`).
5. For live: complete KYC, generate **Live** keys, create a separate live-mode webhook with its own secret, and set `NODE_ENV=production`.

## Security
Full details, threat model and deployment checklist: **SECURITY.md**. Summary:

**Sessions**
- Access JWT (HS256, iss/aud pinned, 15 minutes for users, 10 for admin) kept in memory only.
- Refresh token in an httpOnly, SameSite=Strict, path-scoped cookie (Secure in production). Stored as a SHA-256 hash, **rotated on every use**.
- **Reuse detection:** replaying an old refresh token after a 15-second race grace revokes the whole session family, and access tokens of revoked families stop working.
- User sessions: 30-day idle / 90-day max. Admin sessions use a separate secret and audience: 2-hour idle / 8-hour max.
- `POST /api/auth/logout`, `/api/auth/logout-all` and `/api/admin/auth/logout`.

**CSRF**
- An Origin / Sec-Fetch-Site guard on every state-changing `/api` call.
- A double-submit `fad_csrf` cookie plus `X-CSRF-Token` header on the cookie-authenticated endpoints (refresh and logout).

**OTP**
- 6 digits from `crypto.randomInt`, stored as an HMAC.
- 5-minute expiry, single use, 5 wrong attempts then a 15-minute lock (counted atomically), 30-second resend cooldown.
- 6 sends per number per hour. HTTP limits per phone and per IP.
- **MSG91** (Flow API) or **Twilio** delivery.

**Admin**
- bcrypt `ADMIN_PASSWORD_HASH` (`npm run admin:hash`), with a plaintext fallback that warns.
- Lockout after `ADMIN_MAX_FAILED_LOGINS` (default 5) for `ADMIN_LOCK_MINUTES` (default 15).
- Optional **TOTP 2FA** (`npm run admin:totp`) with replay protection.
- **Audit log** of every login, failure, lock and admin mutation (secrets redacted), shown in **Admin → Audit log**.

**HTTP**
- helmet with a strict CSP:
  - scripts: self plus `checkout.razorpay.com` (plus Google Maps only when a key is configured)
  - `frame-ancestors 'none'`, `object-src 'none'`
- HSTS (2 years) in production, nosniff, frame DENY, Referrer-Policy, Permissions-Policy, `x-powered-by` off.
- CORS allowlist with credentials (`CORS_ORIGINS`).
- `trust proxy` from `TRUST_PROXY` (hop count, never "all").
- Body limits: 100 kB JSON; uploads limited separately.
- hpp, express-rate-limit tiers (global, auth, payments, uploads, plus per-route limits).
- `Cache-Control: no-store` on the API.

**Input**
- zod schemas on auth, booking, review, payment, refund and patient-profile routes.
- A global sanitiser drops `$`, dotted and `__proto__`/`constructor` keys, and caps depth and size. Query values must be strings.
- Mongoose `strictQuery: 'throw'`.
- Regex input is escaped everywhere. Review and note text is stripped of HTML and control/bidi characters.

**Uploads**
- Magic-byte sniffing (JPG, PNG, WebP, PDF; **no SVG/HTML**).
- Images are **re-encoded with sharp** (EXIF and GPS stripped, pixel limit).
- PDFs with JavaScript, launch actions or embedded files are rejected.
- Random file names and size limits. Verification documents are private, streamed only to the owner doctor or the admin with nosniff and no-store. Public files are served with a sandbox CSP.

**Data**
- A global toJSON plugin and a response scrubber remove hashes, secrets, `__v`, slot locks and storage keys.
- Phone numbers are masked in logs and public payloads.
- Errors never include stack traces.
- Structured JSON logs in production, with secret-looking keys redacted.

**Dependencies:** `npm audit` reports 0 vulnerabilities (production and dev).

## New dependencies
- Runtime: `razorpay`, `helmet`, `express-rate-limit`, `hpp`, `cookie-parser`, `zod`, `sharp`, `bcryptjs`, `jsonwebtoken`
- Dev: `nock@14` (Razorpay and MSG91 HTTP mocks in tests; v14 because v15 needs Node 22)

## Environment keys
See `.env.example`. Nothing new is required for local development. In production:

| Key | Required? | Notes |
|---|---|---|
| `USER_JWT_SECRET`, `ADMIN_JWT_SECRET` | yes | ≥32 random chars, different |
| `ADMIN_USERNAME` | yes | |
| `ADMIN_PASSWORD_HASH` | yes (or a ≥12-char `ADMIN_PASSWORD`) | |
| `SMS_PROVIDER` + MSG91/Twilio keys | yes | |
| `CORS_ORIGINS` | yes | |
| `MONGODB_URI` | yes | |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | yes, to take payments | |
| `ADMIN_TOTP_SECRET` | optional, strongly recommended | |
| `PAYMENTS_MODE`, `TRUST_PROXY`, `COOKIE_SECURE`, `SERVE_DIST`, `RATE_LIMIT_GLOBAL`, `ADMIN_MAX_FAILED_LOGINS`, `ADMIN_LOCK_MINUTES`, `MSG91_OTP_VAR`, `OTP_DEMO_MODE` | optional | |

## Tests
`npm test` runs node:test with an in-memory MongoDB and nock; no real keys and no network are used. There are 64 tests:
- `tests/payments.test.mjs`:
  - order creation (paise, receipt, notes, server price), PAID and BOOKING-AMOUNT modes
  - valid, invalid and tampered signatures; tampered amount; wrong order
  - replayed payment id, double verify, authorised→capture
  - webhook valid, invalid, replayed and tampered; order.paid idempotency; payment.failed and abandon
  - hold expiry and late payments (revive or auto-refund)
  - admin partial and full refunds with credit notes; over-refund; provider failure
  - refund.processed and refund.failed
  - doctor-cancel refund; subscription upgrade, renewal and refund
  - IDOR on payment orders
- `tests/payments-disabled.test.mjs`: the 503 path.
- `tests/auth.test.mjs`:
  - cookie flags, hashed storage
  - rotation, race grace, reuse revocation
  - CSRF header, Origin
  - logout and logout-all
  - alg:none, tampered, wrong-key and legacy tokens
  - cross-role and admin/user separation; suspended accounts
- `tests/otp.test.mjs` (MSG91 mocked): hashed storage, no code in responses, lockout, parallel guessing, cooldown and quota, expiry, single use, provider failure, per-IP limit.
- `tests/security.test.mjs`:
  - headers and CSP, CORS
  - IDOR on bookings, family members and private documents
  - uploads (SVG, HTML, polyglot and active-PDF rejected; EXIF stripped; path traversal)
  - NoSQL and prototype pollution
  - secret-field scrubbing, masked phones, body limit, no stack traces, XSS-safe reviews, rate limits
- `tests/admin.test.mjs`: bcrypt, TOTP and its replay, lockout, audit log and redaction.
- `tests/config.test.mjs`:
  - 11 production fail-fast cases
  - a development start with the legacy 5-key `.env` shape: it starts, warns, and admin login works

---

# Phase 2 — Patient app, portals, bookings, subscriptions

## Features
**Admin re-audit**
- Every admin page and API call was re-checked through the Vite proxy (3000 → 5055) after a fresh login: Dashboard, Doctors, Clinics, Patients, Approvals, Bookings, Reviews, Ledger (4 tabs), GST, Plans, Settings, Classic. All of them return 200, show no error box and log no console errors.
- Any 401 from the admin API, including from the classic tab, clears the token, sends you to `/admin` and shows **"Session expired, please log in again"** on the login screen.
- New admin pages:
  - **Bookings:** every booking. Scope tabs, filters (status, mode, location type, refund, visit dates, sort), totals for collected / refunded / due at clinic, a detail view with ledger documents and the payment order, and **Cancel & refund**.
  - **Plans & subscriptions:** edit price, duration, limits, feature flags, the "popular" tag and availability. Also shows subscriber counts and the list of subscription payments.
- Approvals and the entity detail view now show the doctor's **verification documents**. View streams the private file through an authenticated blob; Verify and Reject are available. There is also a **plan card** to grant a complimentary plan.
- **Ledger** has a new **Refunds & credit notes** tab. The patient-fee tab has a refund filter.
- **Dashboard** has new KPIs: appointments today, refunds this month, paid subscriptions, and booking status this month.

**Patient app** (`/`, `/find`, `/clinics`, `/bookings`, `/profile`, `/login`, `/doctors/:slug`)
- **AI sparkle button** inside the right edge of the search bar. It is also in the sidebar and the mobile bottom nav. It opens the AI panel:
  - type or speak; voice uses the Web Speech API with en-IN by default and a language picker
  - when the browser has no speech API, the panel says so and you can type instead
  - an emergency banner for red-flag symptoms
  - suggested specialities
  - each result links to its doctor; "See all X doctors" applies the filter
  The old inline triage block was removed.
- **Add to Home Screen** banner:
  - only on mobile devices (mobile UA, or a coarse pointer plus a small screen)
  - never on desktop, even when the window is narrow
  - never when running standalone
  - can be dismissed for 14 days
  - uses `beforeinstallprompt` where the browser supports it; iOS and Android get help instructions
  - manifest and icons fixed (local 192/512 PNGs); the service worker no longer serves a stale `index.html`
- Search and filters:
  - near-me with a radius
  - speciality and sort
  - filter panel: location type, booking mode, sector, experience, rating, gender, language
- Doctor cards show the nearest location, distance, mode badges, and a directions link.
- **Multi-location booking flow:**
  - steps: location → date and slot → confirm (who it is for, picked from family members) → mock or Razorpay payment when needed → token screen with directions
  - when no date is given, the first day that still has an open slot is chosen, which avoids an empty "today" late in the evening
- **Profile:**
  - photo with crop
  - name, DOB or age, gender, blood group
  - home address on the map
  - family members (add / edit / remove)
  - booking stats
- **My bookings:** tabs, cancel with refund preview, directions, rate the visit.
- **SEO doctor pages** at `/doctors/:slug`: title, meta description, Open Graph tags, canonical link, Physician JSON-LD, location cards with "Book here".

**Doctor portal** (`/doctor`)
- OTP sign-in. An unknown number leads to **registration**, which asks for:
  - name, title, qualifications, experience
  - registration number, council and year
  - specialities, languages, gender, bio
  - a declaration
- The new profile is **pending**. A **"Pending verification" banner** stays until an admin approves it, and the profile is hidden from patients until then.
- **Profile:**
  - photo upload with a **react-easy-crop** step (zoom, rotate, circle or square, exported as WebP with a JPEG fallback)
  - an **optional verification document** (PDF or image, stored privately, visible only to the doctor and admins)
  - a completeness checklist
  - a speciality request
- **Locations (multiple):**
  - types: own clinic / hospital / home visit (with service radius) / online
  - each location has its own map pin plus address, fee, booking mode, booking amount, auto-confirm, weekly schedule (days, sessions, slot length, advance days, blocked dates) and notes
  - locations a clinic manages are read-only here
  - pause / remove
- **Bookings panel:**
  - views: today / upcoming / requests / past / cancelled / all
  - filters for location, mode and search, with pagination
  - actions: accept, complete, no-show, cancel (a reason is required, and the patient gets a full refund)
  - patient phone numbers are tap-to-call
- Also: clinics (invites, join requests, leave), analytics (Pro and above), payouts, subscription, and a notification bell.

**Clinic portal** (`/clinic`)
- Registration with a map pin and address, plus facilities. A new clinic is pending until an admin approves it.
- **Doctors grouped by speciality.** Add a doctor by **inviting** an existing one (by phone or ID), or by **creating a profile** with a photo crop. Created profiles are pending until an admin approves them.
- Per doctor: **schedule, fee and mode** at this clinic. Join requests and pending invites are also shown.
- **Bookings:** walk-in or phone bookings for any active doctor. The same booking appears in the clinic panel and in the doctor's panel. Online bookings at the clinic's locations show up too.
- **Clinic profile:**
  - logo crop (square)
  - gallery (compressed, capped by the plan)
  - details, facilities, timings or 24x7
  - map plus address
- Also: analytics, payouts and subscription.

**Booking engine** (`server/lib/bookings.js`)
- Modes:
  - **FREE:** nothing is paid online. An optional platform fee can be set, default ₹0.
  - **PAID:** the full fee plus a ₹49 platform fee is paid online.
  - **TOKEN:** the booking amount plus the platform fee is paid online, and the rest is paid at the clinic.
  - **offline / walk-in:** booked by the clinic.
- Online payments need a Pro or Premium plan, and the server enforces this.
- **Slot conflicts are prevented** with a unique `slotLock` (doctor | date | time). It applies across all of a doctor's locations, so the same doctor cannot be double-booked anywhere.
- Unpaid bookings hold their slot for 15 minutes, then expire.
- **Refunds:**
  - When the doctor, clinic or admin cancels: a full refund, plus a GST **credit note** for the platform fee.
  - When the patient cancels at least 4 hours ahead (configurable): the consultation fee or booking amount is refunded with a **refund voucher**, and the platform fee is kept.
  - A later cancellation by the patient gets no refund.
- Every online payment writes a GST invoice to the ledger:
  - the platform fee is taxable at 18% (CGST + SGST, or IGST)
  - the consultation fee or booking amount is recorded as pass-through
- **Notifications** (in-app, stored in `Notification`): bookings, status changes, cancellations and refunds, invites, document verification, plan changes.

**Subscriptions** (`server/lib/plans.js`, `server/lib/subscriptions.js`)
- Three plans per audience. Prices **include 18% GST**, and the admin can edit them:

  | Plan | Doctor | Clinic |
  |---|---|---|
  | Basic | ₹0: 1 own location, 2 specialities, free bookings only | ₹0: 3 doctors, 3 photos, free bookings only |
  | Pro (30 days) | ₹999: 3 locations, 4 specialities, online payments, analytics, verified badge, listing boost | ₹2,999: 15 doctors, 12 photos, online payments, analytics, badge, boost |
  | Premium (30 days) | ₹2,499: unlimited locations, 8 specialities, everything in Pro, featured in AI search, top priority | ₹6,999: unlimited doctors, 30 photos, everything in Pro, top priority |

- Limits are enforced on the server for locations, specialities, doctors per clinic, gallery size, online payment modes and analytics.
  - Locations a clinic assigns do not count toward a doctor's location limit.
  - Rejected doctors do not take a clinic seat.
- Checkout creates a `PaymentOrder`. `POST /api/payments/verify` activates the plan; renewing extends from the current expiry. A GST invoice is written to the ledger. Expired plans fall back to Basic through a sweep.
- **Payment providers** (`server/lib/payments/`):
  - `razorpay`: Orders API, Checkout.js, an HMAC signature check and the refunds API. It is used automatically once `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` are set.
  - `mock`: used when no Razorpay keys are set. Set `PAYMENTS_MOCK_ENABLED=false` to switch online payments off instead.

**Uploads** (`server/routes/uploads.js`, `server/lib/storage/`)
- multer runs in memory. The real file type is checked from its magic bytes (JPEG / PNG / WebP, plus PDF for documents) and the size is capped.
- Storage is behind a driver interface (`save / url / stream / remove`). The local driver writes to `UPLOAD_DIR`:
  - public images go to `public/` and are served at `/api/files/...`
  - documents go to `private/` and are only streamed to the owner or an admin
  An S3 or Cloudinary driver can be added without touching the routes.
- Purposes: `doctor_photo, clinic_logo, clinic_gallery, patient_photo, doctor_document`. An upload needs a signed doctor, clinic or patient token.

**Security and hygiene**
- Signed user tokens (`usr.<payload>.<HMAC>`, 30 days), and a 30-minute phone-proof token used for registration.
- OTP demo mode (code `123456`) is controlled by `OTP_DEMO_MODE`. There is no SMS gateway yet.
- Rate limits on OTP send and verify, registration, booking, uploads, AI search and payments.
- Input validation on every write.
- **Sensitive fields are never returned:** password hashes and tokens, document storage keys, a doctor's phone in public views, internal balances, and GSTIN in public views.
- Suspended or pending clinics: their consultation locations are hidden from patients.
- Workspaces are code-split: the patient bundle no longer contains the admin, doctor or clinic code. Leaflet loads only when a map is shown.

## New / changed files
- Server, new:
  - `server/lib/{bookings,geo,locations,notify,payments/{index,mock,razorpay},phone,plans,profiles,rateLimit,storage/index,subscriptions,time,userAuth}.js`
  - `server/routes/{clinicPortal,doctorPortal,me,notifications,payments,uploads,common}.js`
- Server, changed: `server/models/index.js`, `server/routes/{public,admin,legacyAdmin}.js`, `server/index.js`, `server/db.js`, `server/lib/{migrations,gst}.js`, `server/seed-admin-demo.js`.
- Client, new:
  - `src/pages/{DoctorApp,ClinicApp,PatientApp,DoctorProfilePage}.jsx`
  - `src/portal/*` (PortalShell, PortalLogin, BookingsPanel, LocationEditor, ScheduleEditor, SubscriptionPanel, fields)
  - `src/patient/{PatientProfile,PatientBookings}.jsx`
  - `src/components/{ImageCropUpload,DocumentUpload,MapPicker,PaymentSheet,NotificationBell,PatientAuthModal,InstallBanner}.jsx`
  - `src/lib/{image,device}.js`, `src/hooks/useSpeechRecognition.js`
  - `src/admin/pages/{Bookings,Plans}.jsx`
- Client, rewritten or changed: BookingModal, DoctorFilters, DoctorCard, DoctorDetailModal, Sidebar, AiSearchModal, ReviewModal, PayoutRequestPanel, AdminPortal, `src/admin/*` (api, layout, Dashboard, EntityList, Ledger, ui), `App.jsx`, `index.css` (fx-* mobile-first styles), `public/{sw.js,manifest.json,icon-192.png,icon-512.png}`, `index.html`.
- Removed: Navbar, DoctorPortal, ClinicPortal, AiSymptomTriage, DoctorRegisterModal, OtpAuthModal, AddToHomeScreenModal, `src/lib/accountStatus.js`.
- Added `.gitignore`: node_modules, dist, .env, and uploads, keeping `server/uploads/.gitkeep`.

## New API (user routes need `Authorization: Bearer <user token>`)
- **Auth**
  - `POST /api/auth/send-otp`
  - `POST /api/auth/verify-otp`: returns a session token, or `PROFILE_NOT_FOUND` with a `phoneToken`
  - `POST /api/auth/verify-phone`
- **Public**
  - `GET /api/doctors`: query `search, speciality, kind, mode, sector, minExp, minRating, gender, language, userLat, userLng, maxKm, sortBy`
  - `GET /api/doctors/:idOrSlug`
  - `GET /api/doctors/:id/availability?locationId&date`
  - `POST /api/doctors/register`
  - `POST /api/clinics/register`
  - `POST /api/bookings`
  - `POST /api/ai-symptom-triage` (AI symptom search)
- **Patient:** `/api/me` (GET/PUT), `/api/me/family` (CRUD), `/api/me/bookings`, `POST /api/me/bookings/:id/cancel`
- **Doctor:** `/api/doctor-portal/` with
  - `me`, `profile`
  - `locations` (CRUD)
  - `bookings`, `bookings/:id/(accept|complete|no-show|cancel)`
  - `analytics`
  - `clinics`, plus invites, requests and leave
  - `documents`
- **Clinic:** `/api/clinic-portal/` with
  - `me`, `profile`
  - `doctors`, plus invite, create, requests and schedule (`PUT doctors/:id`)
  - `doctors/:id/availability`
  - `bookings` (GET/POST) and booking actions
  - `analytics`
- **Payments and subscriptions**
  - `/api/payments/config`, `POST /api/payments/verify`, `POST /api/payments/fail`
  - `/api/subscriptions/plans`, `/api/subscriptions/me`, `POST /api/subscriptions/checkout`
- **Other**
  - `POST /api/uploads` (multipart field `file`, plus `purpose`), `GET /api/uploads/limits`
  - `/api/notifications` (GET, `POST /:id/read`, `POST /read-all`)
- **Admin**
  - `GET /api/admin/bookings`, `GET /api/admin/bookings/:id`, `POST /api/admin/bookings/:id/cancel`
  - `GET /api/admin/plans`, `PUT /api/admin/plans/:id`
  - `GET /api/admin/subscriptions`
  - `POST /api/admin/(doctors|clinics)/:id/plan`
  - `GET /api/admin/doctors/:id/documents/:docId/file`, `POST .../(verify|reject)`
- **Retired with HTTP 410** (`ENDPOINT_RETIRED`): the old unauthenticated `PUT /api/doctors/:id`, `PUT /api/clinics/:id`, `subscribe-premium`, `request-clinic`, `approve-doctor` and `remove-doctor`. Their replacements are the signed portal routes above.

## Env keys (all optional, see `.env.example`)
- **Storage:** `UPLOAD_DIR` (default `server/uploads`), `STORAGE_DRIVER` (`local`), `UPLOAD_MAX_IMAGE_MB` (3), `UPLOAD_MAX_DOC_MB` (8)
- **Payments:** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `PAYMENTS_MOCK_ENABLED`
- **Auth:** `USER_TOKEN_SECRET` (falls back to a value derived from `ADMIN_SECRET_KEY`), `OTP_DEMO_MODE`
- **Server:** `TRUST_PROXY`, `CORS_ORIGIN`
- **Client:** `VITE_GOOGLE_MAPS_API_KEY`. When it is set, maps use Google (Places autocomplete, draggable marker, geocoder). Otherwise they use Leaflet with OpenStreetMap tiles and Nominatim search and reverse geocoding.

## Dependencies
- Runtime, new: **`leaflet`** ^1.9.4 (lazy-loaded), **`multer`** ^2.4.0, **`react-easy-crop`** ^6.2.4.
- Unchanged: dev-only `mongodb-memory-server` from phase 1.
- No UI kit, map SDK or payment SDK packages were added. Google Maps and Razorpay Checkout load from their CDNs only when configured.

## Migrations (run on server start, idempotent)
- Each legacy doctor gets **consultation locations** built from their clinic affiliations and their address. Locations of **Basic-plan doctors start in FREE mode**.
- **`isPremium` → plan:** legacy premium doctors and clinics become a *legacy Pro* subscription. From now on `isPremium` is derived from the plan.
- Location points are stored as GeoJSON `Point` with 2dsphere indexes. Structured address fields (`line, area, landmark, city, district, state, pincode`) are kept alongside a formatted string.
- The default plans are seeded into `SubscriptionPlan` if they are missing. Admin edits are preserved.
- Legacy bookings keep `bookingMode: 'legacy'`.

## Tests run (on the box, throwaway in-memory MongoDB on port 27999)
- `npm run build` passes.
- API suite: **79 / 79**. It covers OTP auth, all booking modes, refunds, portals, subscriptions, uploads, clinic flows, limits, admin and security.
- Headless Chrome through Vite: **87 / 87**.
  - AI button sits inside the search bar and opens the panel; results link to doctors.
  - A2HS: hidden at 1280px and in a narrow desktop window, shown at 390px with a mobile UA, hidden when standalone.
  - SEO page.
  - Patient OTP login and map fallback; bookings in FREE, PAID and TOKEN modes at three different locations, with mock payment.
  - Doctor onboarding: pending banner, photo crop upload, private document, Leaflet location with GeoJSON.
  - Plan gating; upgrade to Pro; ledger GST row.
  - Clinic create-doctor (pending, in Approvals); clinic limit enforced in the UI and on the server; walk-in visible to the doctor; clinic upgrade.
  - Every admin page; document verify and approve; plan edit; 401 → "Session expired" redirect.

## Known limits / assumptions
- Plan prices above are assumptions. They are editable in Admin → Plans.
- **OTP demo mode is ON unless `OTP_DEMO_MODE=false`.** While it is on, the code `123456` signs anyone in. No SMS gateway is integrated, so with demo mode off you must wire up a provider such as MSG91 or Twilio in `server/routes/public.js` (send-otp) before going to production.
- Razorpay: the adapter covers orders, signature verification and refunds, but it was **not tested against live or test keys** (none on the box). A webhook endpoint (`payment.captured` / `refund.processed`) is recommended next.
- Nominatim's usage policy (about 1 request/second, attribution) is respected client-side. For high traffic, set a Google key or self-host.
- Online consultations are booked like slots; there is no video integration.

# Phase 1 — Admin panel

### Features
- **Admin console** at `/admin/*`. It has a side nav that turns into a hamburger drawer at ≤ 860px. Sections: Dashboard, Doctors, Clinics, Patients, Approvals, Reviews, Ledger (Subscriptions / Patient fees / Payout requests), GST Report, Settings, and "Specialities & Classic", which is the old admin portal kept for managing specialities.
- **Doctors / Clinics / Patients lists.** Pagination is done on the server. You can search by name, email or phone, filter by status, filter by date range, and sort newest or oldest first. A detail modal shows related data such as reviews, bookings, doctors and payouts. Actions: Approve, Reject (reason required), Suspend (reason required), Unsuspend, Delete (soft delete, with a confirm dialog) and Restore.
- **Account status** is one of `pending | active | rejected | suspended | deleted`, and the server enforces it:
  - New doctor and clinic registrations start as **pending**.
  - Only `active` doctors and clinics show up in public listings, search and triage.
  - Bookings need an active doctor and a non-suspended patient.
  - Payout requests need an active account.
  - Profile edits are blocked for suspended, deleted and rejected accounts.
  - Suspended and deleted users or profiles cannot sign in. The suspension reason is shown on the login screen, and also when someone already signed in opens the app (checked through `/api/account/status`).
  - Pending and rejected doctors and clinics can still sign in. They see a banner explaining their status.
- **Review moderation**
  - The built-in word list is in `server/config/profanity.js`. It covers English plus transliterated Hindi and Malayalam.
  - Admins can add extra words or switch off built-in ones in Settings. Saving the list re-scans all reviews.
  - The matcher handles leetspeak, repeated letters and spaced or dotted letters (`m.a.d.a.r.c.h.o.d`). It matches whole words only.
  - Reviews are checked when they are created. Existing reviews were backfilled once at startup by a migration.
  - A flagged review is hidden from the public and does not count toward the doctor's rating.
  - Admin tabs: **Good** (clean, rating ≥ 4), **Flagged**, **Other** and **All**. You can filter by rating and date, sort, and paginate. Actions: approve to public, hide, or delete (soft).
- **Ledger**
  - Every subscription and every patient booking fee writes a `LedgerTransaction` with a sequential GST invoice number.
  - Payout requests: doctors and clinics fill in a request form in their portals. The admin then approves, marks paid (payment reference / UTR required) or rejects (reason required). A rejected amount goes back to the requester's balance.
- **GST**
  - Rate is configurable (default 18%). SAC codes are configurable: a default plus separate codes for subscriptions and booking fees. Listed prices are treated as GST-inclusive by default, and this can be changed.
  - If the supplier and the party are in the same state, the invoice uses CGST + SGST. Otherwise it uses IGST. A party whose state is unknown is treated as intra-state, because the place of supply then falls back to the supplier's location.
  - Invoice numbers look like `FAD/26-27/000001`. The counter is atomic and runs per Indian financial year.
  - The party GSTIN is optional and validated.
  - The GST report works by month or date range. It shows totals and breakdowns by category, rate/supply type, SAC, month and GSTR-1 section.
  - CSV exports: the full register, B2B (4A), B2CL (5A), B2CS (7) and the HSN/SAC summary (12).
- **Dashboard**: KPIs for users, pending approvals, suspended accounts, flagged reviews, monthly revenue, GST and pending payouts. Also a recent activity feed and SVG/CSS charts: revenue by type, account status donut, 6-month revenue and 6-month registrations.
- **Hardening**
  - Admin tokens are now signed with HMAC-SHA256 and expire after 12 hours.
  - Login uses a constant-time credential compare and is throttled.
  - The login form no longer prefills credentials.
  - The OTP login no longer falls back to "the first doctor or clinic" when the phone is unknown.
  - Search input is regex-escaped.
  - Users can no longer upgrade themselves to `isPremium` through a profile PUT.
  - Startup logs no longer print the Mongo URI or the admin username.
  - Added `POST /api/clinics/:id/remove-doctor`. The frontend already called it, but it was missing on the server.

### Models (`server/models/index.js`)
- Doctor, Clinic and User gained: `status, statusReason, statusBeforeSuspension, statusUpdatedAt, approvedAt, deletedAt`, plus GST/state fields (`state, stateCode, gstin`; User and Clinic also got `email`). Indexes on `{status, createdAt}` and `createdAt`. The legacy fields `isSuspended`, `suspensionReason` and `isVerified` are kept in sync.
- Review gained: `moderationStatus (visible|flagged|approved|deleted), moderatedAt, moderationNote, deletedAt`.
- PayoutRequest was extended: status `Pending|Approved|Paid|Rejected`, plus `paymentReference, adminNote, rejectionReason`, timestamps and indexes.
- New models: **LedgerTransaction**, **Counter** and **Settings** (key `global`).

### Admin API (`server/routes/admin.js`, all routes need `Authorization: Bearer <admin token>`)
List endpoints return `{ items, total, page, limit, pages }`.
- `GET /api/admin/:entity` (doctors|clinics|patients). Query: `page, limit, search, status, from, to, sort`.
- `GET /api/admin/:entity/:id`. `POST …/:id/approve | reject | suspend | unsuspend | restore`. `DELETE …/:id` (soft delete).
- `GET /api/admin/approvals?type=doctors|clinics`
- `GET /api/admin/reviews?tab=good|flagged|other|all|deleted&rating&sort&search&from&to`. `POST /reviews/:id/approve | hide`. `DELETE /reviews/:id`. `POST /reviews/rescan`.
- `GET /api/admin/ledger/transactions?type=subscription|patient_fee…` and `GET /api/admin/ledger/transactions/:id`
- `GET /api/admin/payouts`. `POST /payouts/:id/approve | mark-paid | reject`.
- `GET /api/admin/gst/report?month=YYYY-MM | from&to` and `GET /api/admin/gst/export.csv?section=register|b2b|b2cl|b2cs|hsn`
- `GET /api/admin/dashboard`, `GET|PUT /api/admin/settings`, `POST /api/admin/moderation/test`, `GET /api/admin/me`

New public endpoints:
- `GET /api/account/status?type=doctor|clinic|patient&id=|phone=`
- `POST /api/payouts/request` and `GET /api/payouts?entityType&entityId`
- `POST /api/clinics/register`
- `POST /api/clinics/:id/remove-doctor`

### Env keys (see `.env.example`)
These keys are new and optional. They only provide the defaults when the Settings document is first created. After that, change the values in Admin > Settings.
`BUSINESS_NAME, BUSINESS_GSTIN, BUSINESS_STATE_CODE (default 32 = Kerala), GST_RATE (18), DEFAULT_SAC_CODE (998399), INVOICE_PREFIX (FAD)`, plus the dev-only `MEMORY_MONGO_PORT`.
`ADMIN_SECRET_KEY` is now also the HMAC signing key for admin tokens.

### Dependencies
- One new **devDependency**: `mongodb-memory-server` ^11.3.0, used only for a throwaway local test DB.
- No new runtime dependencies. Charts are hand-written SVG and CSS.

### How to run
```bash
npm install
npm run dev            # API (PORT, default 5055) + Vite client
npm run build          # production build
```
Throwaway local DB for testing (it never touches the DB in `.env`):
```bash
npm run dev:memory-db                      # prints MEMORY_MONGO_URI (mongodb://127.0.0.1:27999/)
MONGODB_URI=mongodb://127.0.0.1:27999/findadoc_test node server/index.js
# DEV ONLY, never auto-run. Refuses non-localhost hosts:
MONGODB_URI=mongodb://127.0.0.1:27999/findadoc_test npm run seed:admin-demo
MONGODB_URI=mongodb://127.0.0.1:27999/findadoc_test npm run seed:admin-demo -- --clean
```
Note: `dotenv` will not override a variable that is already set in the shell. Alternatively, point `DOTENV_CONFIG_PATH` at a separate test env file.

### Migration behaviour (runs on server start, idempotent)
- Existing doctors and clinics get a `status` derived from the legacy flags: suspended → `suspended`, verified → `active`, **unverified → `pending`**. **Unverified legacy doctors and clinics are therefore hidden from the public until an admin approves them in Approvals.**
- Existing reviews get `moderationStatus`. A one-time bad-word backfill flags matching reviews and is guarded by a Counter key.
- The Settings document is created from env defaults if it does not exist yet.

### Assumptions and known limits
- GST is 18% and prices are GST-inclusive. Booking fee: only the platform fee (₹49, configurable) is the platform's taxable supply. The consultation fee is recorded as pass-through on behalf of the doctor.
- B2CL threshold: inter-state, unregistered, invoice value over ₹1,00,000. Ask a CA to check the CSV formats before filing.
- ~~Doctor, clinic and patient sign-in has no signed session~~ — superseded in phase 2 (signed user tokens, see above).
- Existing admin sessions (the old static token) are invalidated, so admins have to sign in again.
- ~~Doctor registration keeps the original `isPremium` behaviour~~ — superseded in phase 2: `isPremium` is now derived from the subscription plan.
- The legacy `SubscriptionTransaction` model is left in place but no longer written.
