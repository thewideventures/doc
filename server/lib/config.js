// Central runtime configuration + secret validation.
// - production (NODE_ENV=production): fail fast on missing / weak secrets and unsafe modes.
// - development: derive stable dev-only defaults so an existing minimal .env keeps working, and warn loudly.
// Secret VALUES are never logged — only whether they are set.
import crypto from 'crypto';

const env = process.env;
export const IS_PROD = env.NODE_ENV === 'production';
export const IS_TEST = env.NODE_ENV === 'test';

const WEAK = [/^change[-_ ]?me/i, /^replace[-_ ]?with/i, /^secret$/i, /^password$/i, /^findadoc_/i, /^your[-_]/i, /^xxx/i];
const isWeak = v => !v || v.length < 32 || WEAK.some(r => r.test(v)) || new Set(v).size < 8;

const problems = []; // fatal in production
const warnings = []; // printed loudly in development

// Dev-only derivation: stable across restarts when ADMIN_SECRET_KEY exists (so dev sessions survive a restart),
// random per process otherwise. Never used in production.
const devSeed = env.ADMIN_SECRET_KEY || env.USER_TOKEN_SECRET || '';
const processRandom = crypto.randomBytes(32).toString('hex');
function devSecret(label) {
  if (!devSeed) return crypto.createHash('sha256').update(`${label}:${processRandom}`).digest('hex');
  return crypto.createHmac('sha256', devSeed).update(`findadoc-dev:${label}`).digest('hex');
}

function secret(name, label, { legacy } = {}) {
  const v = env[name] || (legacy ? env[legacy] : '');
  if (v && !isWeak(v)) return v;
  if (IS_PROD) {
    problems.push(v ? `${name} is too weak (use at least 32 random characters, e.g. \`openssl rand -hex 32\`)` : `${name} is required (generate one with \`openssl rand -hex 32\`)`);
    return v || '';
  }
  warnings.push(`${name} ${v ? 'is weak' : 'is not set'} — using a derived DEV-ONLY secret. Set it before deploying (openssl rand -hex 32).`);
  return devSecret(label);
}

function list(v) { return String(v || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean); }

// ---------------------------------------------------------------- secrets
const USER_JWT_SECRET = secret('USER_JWT_SECRET', 'user-jwt', { legacy: 'USER_TOKEN_SECRET' });
const ADMIN_JWT_SECRET = secret('ADMIN_JWT_SECRET', 'admin-jwt');
if (IS_PROD && USER_JWT_SECRET && USER_JWT_SECRET === ADMIN_JWT_SECRET) problems.push('USER_JWT_SECRET and ADMIN_JWT_SECRET must be different');

// ---------------------------------------------------------------- admin
const ADMIN_USERNAME = env.ADMIN_USERNAME || (IS_PROD ? '' : 'admin@findadoc.com');
const ADMIN_PASSWORD_HASH = env.ADMIN_PASSWORD_HASH || '';
const ADMIN_PASSWORD = env.ADMIN_PASSWORD || (IS_PROD ? '' : 'SuperAdmin@2026');
if (!env.ADMIN_USERNAME) (IS_PROD ? problems : warnings).push('ADMIN_USERNAME is not set' + (IS_PROD ? '' : ' — using the built-in dev default admin@findadoc.com'));
if (ADMIN_PASSWORD_HASH && !/^\$2[aby]\$\d{2}\$.{53}$/.test(ADMIN_PASSWORD_HASH)) problems.push('ADMIN_PASSWORD_HASH is not a valid bcrypt hash (generate with `npm run admin:hash`)');
if (!ADMIN_PASSWORD_HASH) {
  if (!env.ADMIN_PASSWORD) (IS_PROD ? problems : warnings).push('ADMIN_PASSWORD_HASH / ADMIN_PASSWORD not set' + (IS_PROD ? '' : ' — using the built-in dev default password'));
  else {
    warnings.push('Admin password is configured in plaintext (ADMIN_PASSWORD). Prefer ADMIN_PASSWORD_HASH (bcrypt) — run `npm run admin:hash`.');
    if (IS_PROD && env.ADMIN_PASSWORD.length < 12) problems.push('ADMIN_PASSWORD must be at least 12 characters in production (or use ADMIN_PASSWORD_HASH)');
  }
}
const ADMIN_TOTP_SECRET = (env.ADMIN_TOTP_SECRET || '').replace(/\s+/g, '').toUpperCase();
if (ADMIN_TOTP_SECRET && !/^[A-Z2-7]{16,}=*$/.test(ADMIN_TOTP_SECRET)) problems.push('ADMIN_TOTP_SECRET must be base32 (generate with `npm run admin:totp`)');
if (IS_PROD && !ADMIN_TOTP_SECRET) warnings.push('ADMIN_TOTP_SECRET is not set — admin 2FA is OFF. Strongly recommended in production.');

// ---------------------------------------------------------------- OTP / SMS
const SMS_PROVIDER = (env.SMS_PROVIDER || '').toLowerCase();
if (SMS_PROVIDER && !['msg91', 'twilio', 'console'].includes(SMS_PROVIDER)) problems.push(`SMS_PROVIDER "${SMS_PROVIDER}" is not supported (msg91 | twilio${IS_PROD ? '' : ' | console'})`);
if (SMS_PROVIDER === 'msg91' && (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID)) problems.push('SMS_PROVIDER=msg91 needs MSG91_AUTH_KEY and MSG91_TEMPLATE_ID');
if (SMS_PROVIDER === 'twilio' && (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !(env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID))) problems.push('SMS_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID');
if (IS_PROD && SMS_PROVIDER === 'console') problems.push('SMS_PROVIDER=console is development-only');
if (IS_PROD && !SMS_PROVIDER) problems.push('SMS_PROVIDER is required in production (msg91 or twilio)');
let OTP_DEMO = false;
if (env.OTP_DEMO_MODE === 'true') {
  if (IS_PROD) problems.push('OTP_DEMO_MODE=true is not allowed in production');
  else OTP_DEMO = true;
} else if (env.OTP_DEMO_MODE === undefined && !IS_PROD && !SMS_PROVIDER) {
  // Dev convenience so an existing local .env keeps working. Never in production.
  OTP_DEMO = true;
  warnings.push('No SMS_PROVIDER configured — DEMO OTP 123456 is enabled for local development (set OTP_DEMO_MODE=false to disable).');
}

// ---------------------------------------------------------------- payments
const RZP_KEY_ID = env.RAZORPAY_KEY_ID || '';
const RZP_KEY_SECRET = env.RAZORPAY_KEY_SECRET || '';
const RZP_WEBHOOK_SECRET = env.RAZORPAY_WEBHOOK_SECRET || '';
const rawMode = (env.PAYMENTS_MODE || '').toLowerCase();
let PAYMENTS_MODE;
if (rawMode && !['razorpay', 'mock', 'disabled'].includes(rawMode)) { problems.push(`PAYMENTS_MODE "${rawMode}" is invalid (razorpay | mock | disabled)`); PAYMENTS_MODE = 'disabled'; }
else if (rawMode === 'mock') {
  if (IS_PROD) { problems.push('PAYMENTS_MODE=mock is not allowed in production'); PAYMENTS_MODE = 'disabled'; }
  else PAYMENTS_MODE = 'mock';
} else if (rawMode === 'disabled') PAYMENTS_MODE = 'disabled';
else if (rawMode === 'razorpay' || (RZP_KEY_ID && RZP_KEY_SECRET)) {
  PAYMENTS_MODE = RZP_KEY_ID && RZP_KEY_SECRET ? 'razorpay' : 'disabled';
  if (!RZP_KEY_ID || !RZP_KEY_SECRET) (IS_PROD ? problems : warnings).push('PAYMENTS_MODE=razorpay but RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are missing — payments disabled');
  else {
    if (!/^rzp_(test|live)_[A-Za-z0-9]+$/.test(RZP_KEY_ID)) warnings.push('RAZORPAY_KEY_ID does not look like rzp_test_… / rzp_live_…');
    if (IS_PROD && RZP_KEY_ID.startsWith('rzp_test_')) warnings.push('Razorpay TEST keys are configured in production');
    if (!RZP_WEBHOOK_SECRET) (IS_PROD ? problems : warnings).push('RAZORPAY_WEBHOOK_SECRET is not set — the payment webhook will reject every call');
  }
} else {
  PAYMENTS_MODE = 'disabled';
  warnings.push(IS_PROD
    ? 'Online payments are DISABLED (no Razorpay keys). Paid bookings and subscriptions will answer 503 "Payments not configured".'
    : 'Online payments are DISABLED: set RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET (test keys) or PAYMENTS_MODE=mock for local testing.');
}

// ---------------------------------------------------------------- HTTP
const DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5055', 'http://127.0.0.1:5055'];
const CORS_ORIGINS = list(env.CORS_ORIGINS || env.CORS_ORIGIN);
if (CORS_ORIGINS.includes('*')) problems.push('CORS_ORIGINS must not contain "*" (credentials are used)');
if (IS_PROD && !CORS_ORIGINS.length) problems.push('CORS_ORIGINS is required in production (comma-separated https origins of your site, e.g. https://findadoc.in)');
if (IS_PROD && CORS_ORIGINS.some(o => !o.startsWith('https://'))) warnings.push('CORS_ORIGINS contains non-https origins');
const ALLOWED_ORIGINS = [...new Set([...CORS_ORIGINS.filter(o => o !== '*'), ...(IS_PROD ? [] : DEV_ORIGINS)])];

function trustProxy() {
  const v = env.TRUST_PROXY;
  if (!v || v === 'false') return false;
  if (v === 'true') return 1; // one hop (nginx / load balancer) — never "trust everything"
  if (/^\d+$/.test(v)) return Number(v);
  return v; // e.g. "loopback, 10.0.0.0/8"
}

if (IS_PROD && !env.MONGODB_URI) problems.push('MONGODB_URI is required in production');

export const config = Object.freeze({
  isProd: IS_PROD,
  isTest: IS_TEST,
  port: Number(env.PORT || 5055),
  userJwtSecret: USER_JWT_SECRET,
  adminJwtSecret: ADMIN_JWT_SECRET,
  admin: { username: ADMIN_USERNAME, passwordHash: ADMIN_PASSWORD_HASH, password: ADMIN_PASSWORD_HASH ? '' : ADMIN_PASSWORD, totpSecret: ADMIN_TOTP_SECRET, maxFailures: Number(env.ADMIN_MAX_FAILED_LOGINS || 5), lockMinutes: Number(env.ADMIN_LOCK_MINUTES || 15) },
  otp: { demo: OTP_DEMO, demoCode: '123456', provider: SMS_PROVIDER || (OTP_DEMO ? 'demo' : '') },
  payments: { mode: PAYMENTS_MODE, keyId: RZP_KEY_ID, keySecret: RZP_KEY_SECRET, webhookSecret: RZP_WEBHOOK_SECRET },
  allowedOrigins: ALLOWED_ORIGINS,
  trustProxy: trustProxy(),
  googleMaps: Boolean(env.VITE_GOOGLE_MAPS_API_KEY || env.GOOGLE_MAPS_API_KEY),
  serveDist: env.SERVE_DIST ? env.SERVE_DIST === 'true' : IS_PROD,
  secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : IS_PROD
});

export const configProblems = problems;
export const configWarnings = warnings;

/** Call once at startup. Exits the process in production when the configuration is unsafe. */
export function assertConfig(log = console) {
  for (const w of warnings) log.warn(`[config] WARNING: ${w}`);
  if (problems.length) {
    const msg = `[config] Refusing to start — fix these settings:\n  - ${problems.join('\n  - ')}`;
    if (IS_PROD) { log.error(msg); process.exit(1); }
    for (const p of problems) log.warn(`[config] WARNING (fatal in production): ${p}`);
  }
  if (!IS_PROD && warnings.length) log.warn('[config] ^^^ development defaults in use — NOT safe for production ^^^');
}
