# FindADoc — Admin Panel Changes

## Features
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

## Models (`server/models/index.js`)
- Doctor, Clinic and User gained: `status, statusReason, statusBeforeSuspension, statusUpdatedAt, approvedAt, deletedAt`, plus GST/state fields (`state, stateCode, gstin`; User and Clinic also got `email`). Indexes on `{status, createdAt}` and `createdAt`. The legacy fields `isSuspended`, `suspensionReason` and `isVerified` are kept in sync.
- Review gained: `moderationStatus (visible|flagged|approved|deleted), moderatedAt, moderationNote, deletedAt`.
- PayoutRequest was extended: status `Pending|Approved|Paid|Rejected`, plus `paymentReference, adminNote, rejectionReason`, timestamps and indexes.
- New models: **LedgerTransaction**, **Counter** and **Settings** (key `global`).

## Admin API (`server/routes/admin.js`, all routes need `Authorization: Bearer <admin token>`)
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

## Env keys (see `.env.example`)
These keys are new and optional. They only provide the defaults when the Settings document is first created. After that, change the values in Admin > Settings.
`BUSINESS_NAME, BUSINESS_GSTIN, BUSINESS_STATE_CODE (default 32 = Kerala), GST_RATE (18), DEFAULT_SAC_CODE (998399), INVOICE_PREFIX (FAD)`, plus the dev-only `MEMORY_MONGO_PORT`.
`ADMIN_SECRET_KEY` is now also the HMAC signing key for admin tokens.

## Dependencies
- One new **devDependency**: `mongodb-memory-server` ^11.3.0, used only for a throwaway local test DB.
- No new runtime dependencies. Charts are hand-written SVG and CSS.

## How to run
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

## Migration behaviour (runs on server start, idempotent)
- Existing doctors and clinics get a `status` derived from the legacy flags: suspended → `suspended`, verified → `active`, **unverified → `pending`**. **Unverified legacy doctors and clinics are therefore hidden from the public until an admin approves them in Approvals.**
- Existing reviews get `moderationStatus`. A one-time bad-word backfill flags matching reviews and is guarded by a Counter key.
- The Settings document is created from env defaults if it does not exist yet.

## Assumptions and known limits
- GST is 18% and prices are GST-inclusive. Booking fee: only the platform fee (₹49, configurable) is the platform's taxable supply. The consultation fee is recorded as pass-through on behalf of the doctor.
- B2CL threshold: inter-state, unregistered, invoice value over ₹1,00,000. Ask a CA to check the CSV formats before filing.
- Doctor, clinic and patient sign-in is still the existing phone + mock OTP flow, with no signed session. Status is enforced on the server for every sensitive action. Proper session auth for those portals is recommended.
- Existing admin sessions (the old static token) are invalidated, so admins have to sign in again.
- Doctor registration keeps the original `isPremium` behaviour. Only self-upgrades through a profile edit are blocked.
- The legacy `SubscriptionTransaction` model is left in place but no longer written.
