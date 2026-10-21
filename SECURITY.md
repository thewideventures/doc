# FindADoc security

This covers how FindADoc is protected, what is still open, and the checklist to run before going live. Report vulnerabilities privately to the platform owner; do not open public issues.

## Assets and threat model
| Asset | Threats | Main controls |
|---|---|---|
| Money: Razorpay orders, payments, refunds | Price tampering, forged "payment succeeded" callbacks, replaying one payment for many orders, webhook forgery or replay, refund abuse | Server-side pricing; HMAC signature **and** a payment fetch (order, amount, currency, status); atomic order claim; unique `providerPaymentId`; webhook HMAC over the raw body plus event-id dedupe; refunds admin-only, capped at the refundable amount, audited |
| Accounts: patient, doctor, clinic | OTP brute force, SMS pumping, session theft, CSRF, IDOR | Hashed OTP, 5 attempts then lock, cooldown, per-phone and per-IP limits; short in-memory access token plus rotating httpOnly refresh cookie with reuse detection; Origin guard and CSRF token; every query scoped to `req.auth` |
| Admin console | Credential stuffing, password leaks, session hijack, insider misuse | bcrypt hash, lockout, TOTP 2FA, a separate JWT secret and audience, 10-minute tokens, 8-hour max session, audit log of every action |
| Patient PII: phones, bookings, family members | Scraping, leaks in logs or responses | Masked public phones with a rate-limited reveal; response scrubber; masked phones in logs; no stack traces |
| Doctor verification documents | Unauthorised download, malicious files | Private storage, owner/admin-only streaming, magic bytes, sharp re-encode, active-PDF rejection, no SVG/HTML |
| Availability | Floods, expensive queries | Tiered rate limits, body limits, depth and size caps, escaped regex, `strictQuery`, pagination caps |

**Trust boundaries**
- **Browser to API:** everything sent by the client is untrusted, including amounts, ids, roles and statuses.
- **Razorpay to API:** webhooks are trusted only after their signature is verified.
- **API to Razorpay or SMS:** outbound HTTPS calls with keys from the environment.
- **API to MongoDB.**

**Not in scope / accepted risks**
- **Admin lockout is per username.** An attacker who knows the admin username can keep the account locked (a denial of service), but can never get in. This is mitigated by: lockout minutes being configurable, the lock state being stored hashed, and the option of putting the admin path behind a VPN or IP allowlist at the proxy. Recovery: delete the `adminloginstates` document or wait.
- **Demo OTP and mock payments exist in the code.** Both are hard-disabled in production; the server refuses to start if they are enabled.
- **PDF documents are not sandboxed** when an admin opens them, because the browser's PDF viewer cannot run sandboxed. They are checked for JavaScript, launch actions and embedded files instead.
- **Single admin identity.** There are no per-person admin accounts yet; the audit log records IP and user-agent.

## Controls in detail
**Sessions**
- Access token:
  - HS256 JWT pinned to `iss=findadoc`, `aud=findadoc-user` or `findadoc-admin`, `typ=access`
  - lifetime 15 minutes for users, 10 for admin
  - sent only as `Authorization: Bearer` and kept in memory; never in localStorage, the URL or a cookie
- Refresh token:
  - format `<id>.<256-bit random>` in an httpOnly, SameSite=Strict cookie scoped to `/api/auth` (or `/api/admin/auth`), Secure in production
  - only its SHA-256 is stored
  - every refresh **rotates** it with an atomic claim; two tabs refreshing at once get `409 REFRESH_RACE` and retry
  - reusing an already-rotated token after a 15-second grace **revokes the whole family**, and access tokens of revoked families are rejected
  - users: idle 30 days, max 90 days; admin: idle 2 hours, max 8 hours
- Suspending or deleting an account invalidates its sessions on the next request or refresh.
- Logout revokes the family; logout-all revokes every family of the user.

**CSRF**
- Every non-GET `/api` request with a foreign or `null` Origin, or `Sec-Fetch-Site: cross-site`, is rejected.
- Cookie-authenticated endpoints (refresh, logout) also need the `X-CSRF-Token` header to match the `fad_csrf` cookie (double submit).
- Bearer-token endpoints cannot be forged cross-site, because the token is not ambient.

**OTP**
- `crypto.randomInt` 6-digit code, stored as `HMAC(pepper, phone:code)`.
- 5-minute expiry, single use, compared with timingSafeEqual.
- Attempts are counted atomically before comparing; after 5 wrong codes the number is locked for 15 minutes.
- 30-second resend cooldown, 6 sends per number per hour; HTTP limits of 5 per phone and 30 per IP per 10 minutes.
- Delivery through MSG91 or Twilio. Provider errors are generic to the client and logged with a masked phone.

**Payments**
- See CHANGES.md → Razorpay. Key points:
  - the key secret never leaves the server
  - `/verify` needs a valid signature **and** a Razorpay-fetched payment with matching order, amount and currency
  - the webhook uses the raw body and HMAC with timingSafeEqual, dedupes on event id, and settles through the same idempotent code path
  - ledger rows are created only after verification

**HTTP**
- helmet:
  - CSP `default-src 'self'`; scripts self plus Razorpay checkout (plus Google Maps when configured); no inline scripts
  - `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, upgrade-insecure-requests in production
  - HSTS of 2 years with includeSubDomains in production
  - COOP same-origin-allow-popups (for the Razorpay popup), CORP same-site, Referrer-Policy strict-origin-when-cross-origin, nosniff, X-Frame-Options DENY
- Permissions-Policy allows only camera, microphone and geolocation for self, and payment for self plus Razorpay; usb is off.
- CORS allowlist only, with credentials; `*` is refused.
- `trust proxy` is a hop count, never "all".
- JSON bodies are limited to 100 kB.
- hpp, `x-powered-by` off, `Cache-Control: no-store` on the API.

**Rate limits** (express-rate-limit, per IP or per user/phone)
- Global 1500 per 15 minutes; auth 100 per 15 minutes; payments 120 per 15 minutes; uploads 120 per hour.
- OTP send and verify, booking creation (20 per hour per user), reviews, contact reveal (30 per hour), payouts, admin refunds (60 per hour), registration.
- The limits are in-memory per process. For several instances, use a shared store (Redis) — see Future work.

**Input**
- zod on auth, OTP, booking, review, payments, refunds, the audit-log query and the patient profile.
- A global sanitiser strips `$` and dotted keys and `__proto__`, `constructor` and `prototype`; depth ≤ 8, ≤ 500 keys, strings ≤ 20,000 characters; query values must be strings.
- Mongoose `strictQuery: 'throw'`. Every user-supplied regex is escaped.
- Free text (reviews, notes) is stripped of tags, control and bidi characters and `javascript:`. React escapes on render.

**Uploads**
- Type is decided by magic bytes, not by extension or MIME.
- JPG, PNG and WebP are decoded and re-encoded by sharp: EXIF and GPS stripped, auto-rotate, ≤ 2400 px, a 40 MP decode limit.
- PDFs must be well formed and contain no JavaScript, launch actions, embedded files, XFA or forms.
- Random file names; per-role purposes; size limits (images 3 MB, documents 8 MB).
- Public images are served with `CSP: sandbox` and nosniff. Private documents are served only through authenticated routes.

**Data**
- Secret fields (password, token or code hashes, TOTP secret, slot locks, storage keys) are removed by a global toJSON plugin **and** a response scrubber.
- Phones are masked in logs and public payloads.
- Errors return a generic message and code, never stacks.
- Logs are JSON in production with secret-looking keys redacted. Startup logs say whether secrets are set, never their values.

**Secrets**
- Production fails fast on missing or weak secrets: ≥32 characters, no placeholder patterns, user and admin secrets must differ.
- Production also refuses demo OTP, mock payments, console SMS and wildcard CORS.
- Development derives dev-only secrets from `ADMIN_SECRET_KEY` and prints warnings.

**Dependencies**
- `npm audit` was clean at release.
- Run `npm audit --omit=dev` in CI and before each deploy; keep the `razorpay`, `express`, `mongoose` and `sharp` minor versions current.

## Phase 4 controls
- **The same model applies to every new route:**
  - `requireUser(role)` sessions; ownership checks on bookings, prescriptions, records, shares, queue, waitlist and lab orders (another user's id returns 404, never the data)
  - zod validation of params, query and body
  - per-user and per-IP rate limits
  - the response scrubber (no `passwordHash`, tokens, partner-key hashes, private doctor notes or commission fields to patients)
  - The origin guard and CSRF rules are unchanged.
- **Health data is private by default:**
  - Lab reports and record uploads go through the phase-3 pipeline (magic-byte check, size limits, image re-encode, PDF checks) into `private/` storage.
  - They are streamed only by authorised routes (`sendPrivateFile`) to the owner, the admin, or a doctor holding an active share.
  - They are never under the public `/api/files` static path; tests assert no static leak.
- **Consent first (DPDP):**
  - Uploads, doctor sharing and WhatsApp/SMS reminders each need the matching purpose consent.
  - Consents are timestamped records (purpose, version, method, IP truncated to /24).
  - Withdrawal stops the purpose immediately; withdrawing health-data consent revokes every record share.
  - Sharing is per booking, can be revoked and is logged.
- **Signed booking links:**
  - Links are HMAC-SHA256 over the booking id, version and expiry using `BOOKING_LINK_SECRET` (default derived from `USER_JWT_SECRET`), compared in constant time.
  - Any change to the booking bumps the version, so old links go stale.
  - Links can only view, reschedule or cancel that one booking, and expose no phone numbers or other personal data.
  - They are rate-limited (40 per 10 minutes per IP).
- **Lab partner API:**
  - Keys use the `labk_` prefix and are random. The admin sees them once; only a SHA-256 hash is stored.
  - The key is sent in the `X-Lab-Key` header. The partner is scoped to its own lab's orders, rate-limited, and can be revoked by an admin.
- **Messaging:**
  - Provider adapters (Meta, Gupshup, MSG91) are env-gated. Phone numbers are masked in logs, and message bodies with medical detail are not logged.
  - Templates only carry booking time, doctor, place and the signed link.
  - The console provider is refused in production.
- **ABHA:**
  - Optional and off by default. The mock is refused in production; the sandbox needs ABDM credentials.
  - Link attempts are short-lived `AbhaTxn` rows (10-minute expiry, rate-limited). OTPs are never stored; the sandbox adapter encrypts them for ABDM.
  - The linked ABHA number is returned only to its owner, and it can be unlinked at any time.
- **Account deletion:**
  - There is a grace period (default 30 days). After it, the scheduled sweep anonymises the profile, family, records and consents and revokes all sessions.
  - GST invoices and ledger rows are kept as the law requires (amounts and invoice numbers), with the patient name and phone removed.
- **PDFs** are generated server-side with pdfkit from typed fields (no HTML rendering, so no template injection). They are sent `no-store` with `Content-Disposition: attachment`.
- **CSP:** no new third-party browser hosts. WhatsApp, SMS and ABDM calls are server-side only, and the emergency directions are plain `https://www.google.com/maps` links.

## Deployment checklist
1. **Secrets:**
   - set `NODE_ENV=production`
   - `USER_JWT_SECRET` and `ADMIN_JWT_SECRET` from `openssl rand -hex 32` (two different values)
   - store them in the host's secret manager, not in git
2. **Admin:**
   - `ADMIN_USERNAME`
   - `ADMIN_PASSWORD_HASH` via `npm run admin:hash`, then remove `ADMIN_PASSWORD`
   - `ADMIN_TOTP_SECRET` via `npm run admin:totp`, enrolled in an authenticator
3. **SMS:** `SMS_PROVIDER=msg91` with `MSG91_AUTH_KEY` and a DLT-approved `MSG91_TEMPLATE_ID` (or Twilio). Leave `OTP_DEMO_MODE` unset or false.
4. **Razorpay:**
   - live keys
   - a webhook to `https://<domain>/api/payments/razorpay/webhook` with its own `RAZORPAY_WEBHOOK_SECRET`
   - events: payment.captured, payment.failed, order.paid, refund.processed, refund.failed
   - make one small live payment and refund it to check the setup
5. **Network:**
   - HTTPS only (TLS 1.2+) at the proxy
   - `TRUST_PROXY=1` (or the exact hop count)
   - `CORS_ORIGINS=https://<domain>`
   - leave `COOKIE_SECURE` at its default (true)
6. **MongoDB:**
   - a dedicated user with readWrite on the app database only
   - TLS, IP allowlist, backups with point-in-time restore
   - never expose it publicly
7. **Proxy:** limit the request body (e.g. 10 MB for uploads), set sensible timeouts, forward `X-Forwarded-For`. Optionally IP-allowlist `/admin` and `/api/admin`.
8. **Storage:** `UPLOAD_DIR` on persistent disk, outside the web root, not executable, and backed up. Or move to S3 with private ACLs.
9. **Monitoring:**
   - ship the JSON logs
   - alert on `Refresh token reuse detected`, `Refund failed`, `Webhook signature invalid`, repeated `ADMIN_LOCKED`, and 5xx spikes
   - review **Admin → Audit log** weekly
10. **Verify after deploy:**
    - the startup log says `production` and `Payments mode: razorpay (LIVE keys, webhook secret set)`, with no DEMO warnings
    - `curl -I https://<domain>/` shows CSP and HSTS
    - `npm audit --omit=dev` is clean

11. **Phase 4 reminders and links:**
    - `APP_BASE_URL=https://<domain>` and a separate `BOOKING_LINK_SECRET` (`openssl rand -hex 32`)
    - `WHATSAPP_PROVIDER` with its keys and Meta/Gupshup/MSG91-approved templates in `WHATSAPP_TEMPLATES`, and/or `REMINDER_SMS=true` with a DLT template
    - run the scheduler on exactly one instance (`SCHEDULER_ENABLED=false` elsewhere)
12. **DPDP:**
    - set `GRIEVANCE_OFFICER_NAME`, `GRIEVANCE_OFFICER_EMAIL`, `GRIEVANCE_OFFICER_PHONE` and `GRIEVANCE_OFFICER_ADDRESS`
    - have counsel review the privacy policy and terms text in `src/i18n/legal.js`
    - check the deletion sweep in the logs
13. **ABHA:** keep `ABHA_PROVIDER` unset or disabled until ABDM onboarding is complete. The sandbox adapter is for integration testing only.

## Future work
- **RazorpayX payouts.** Automate doctor and clinic settlements through the Payouts API: contacts and fund accounts, idempotency keys, `payout.processed` / `payout.reversed` webhooks, maker-checker approval. Today payouts are manual and recorded with the bank UTR.
- **Shared Redis rate-limit and replay stores** for multi-instance deployments.
- **Per-person admin accounts** with roles (finance, support, verifier) and WebAuthn.
- **Malware scanning** of uploaded PDFs (ClamAV or a cloud scanner), and moving documents to S3 with KMS.
- **Zod coverage** for the remaining portal profile routes. These are currently covered by the global sanitiser plus per-field typing in the handlers.
- **Razorpay Route** for split settlements, if pass-through fees should never touch the platform account.
- **Server-sent events** for the live queue instead of polling, behind the same auth.
- **Unicode PDF fonts** (Noto Sans Malayalam/Devanagari) and translated admin screens.
- **Encrypting health-record files at rest** (per-object keys via KMS) when moving to S3.
