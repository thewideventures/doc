// HTTP hardening: helmet/CSP, CORS allowlist, Origin + double-submit CSRF checks, NoSQL-injection sanitiser.
import crypto from 'crypto';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config.js';
import { CSRF_COOKIE } from './sessions.js';

const PRIVATE_DEV_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

export function originAllowed(origin) {
  if (!origin) return false;
  const o = String(origin).replace(/\/$/, '');
  if (config.allowedOrigins.includes(o)) return true;
  if (!config.isProd) {
    try { const u = new URL(o); return ['http:', 'https:'].includes(u.protocol) && PRIVATE_DEV_HOST.test(u.hostname); } catch { return false; }
  }
  return false;
}

// ------------------------------------------------------------------ helmet / CSP
export function cspDirectives() {
  const maps = config.googleMaps ? ['https://maps.googleapis.com', 'https://maps.gstatic.com'] : [];
  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
    formAction: ["'self'"],
    scriptSrc: ["'self'", 'https://checkout.razorpay.com', ...maps],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org', 'https://tile.openstreetmap.org', 'https://images.unsplash.com', 'https://i.pravatar.cc', 'https://ui-avatars.com', 'https://*.razorpay.com', ...maps],
    connectSrc: ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com', 'https://nominatim.openstreetmap.org', ...maps],
    frameSrc: ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
    workerSrc: ["'self'", 'blob:'],
    manifestSrc: ["'self'"],
    ...(config.isProd ? { upgradeInsecureRequests: [] } : { upgradeInsecureRequests: null })
  };
}

export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: { useDefaults: false, directives: cspDirectives() },
    strictTransportSecurity: config.isProd ? { maxAge: 63072000, includeSubDomains: true, preload: false } : false,
    crossOriginEmbedderPolicy: false, // Razorpay checkout iframe + map tiles
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // Razorpay / UPI popups
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xFrameOptions: { action: 'deny' }
  });
}

export function permissionsPolicy(req, res, next) {
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self), payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com"), usb=(), interest-cohort=()');
  next();
}

export function corsMiddleware() {
  return cors({
    origin: (origin, cb) => cb(null, !origin || originAllowed(origin) ? origin || false : false),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'x-admin-token'],
    maxAge: 600
  });
}

// ------------------------------------------------------------------ CSRF
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global Origin check for state-changing requests: a browser always sends Origin on cross-site POST/PUT/DELETE,
 * so any disallowed Origin is rejected. Also rejects Sec-Fetch-Site: cross-site when Origin is missing.
 * Server-to-server calls (Razorpay webhook) carry no Origin and are authenticated by signature instead.
 */
export function originGuard(req, res, next) {
  if (SAFE.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && origin !== 'null' && !originAllowed(origin) && !sameHost(req, origin)) return res.status(403).json({ error: 'Cross-site request blocked', code: 'CSRF_ORIGIN' });
  if (origin === 'null' || (!origin && req.headers['sec-fetch-site'] === 'cross-site')) return res.status(403).json({ error: 'Cross-site request blocked', code: 'CSRF_ORIGIN' });
  next();
}
function sameHost(req, origin) {
  try { return new URL(origin).host === req.headers.host && (config.isProd ? new URL(origin).protocol === 'https:' : true); } catch { return false; }
}

/** Double-submit token for cookie-authenticated endpoints (refresh / logout). */
export function requireCsrf(req, res, next) {
  const c = req.cookies?.[CSRF_COOKIE];
  const h = req.headers['x-csrf-token'];
  if (!c || !h || typeof h !== 'string' || c.length !== h.length || !crypto.timingSafeEqual(Buffer.from(c), Buffer.from(h))) {
    return res.status(403).json({ error: 'Security check failed. Please reload the page.', code: 'CSRF_TOKEN' });
  }
  if (!req.headers.origin && !req.headers.referer && req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') {
    return res.status(403).json({ error: 'Cross-site request blocked', code: 'CSRF_ORIGIN' });
  }
  next();
}

// ------------------------------------------------------------------ input sanitiser
const MAX_DEPTH = 8;
const MAX_KEYS = 500;
const MAX_STRING = 20000;

/** Removes keys that start with "$" or contain "." (MongoDB operator / path injection) and prototype-pollution keys. */
export function sanitize(value, depth = 0, counter = { n: 0 }) {
  if (depth > MAX_DEPTH) return undefined;
  if (typeof value === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) : value.replace(/\u0000/g, '');
  if (Array.isArray(value)) return value.slice(0, 500).map(v => sanitize(v, depth + 1, counter)).filter(v => v !== undefined);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (++counter.n > MAX_KEYS) break;
      if (k.startsWith('$') || k.includes('.') || k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const v = sanitize(value[k], depth + 1, counter);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return value;
}

export function sanitizeRequest(req, res, next) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) req.body = sanitize(req.body);
  // query values are plain strings (simple parser + hpp); keep only string values, capped
  const q = {};
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k.startsWith('$') || k.includes('.') || k.length > 60) continue;
    const s = Array.isArray(v) ? v[v.length - 1] : v;
    if (typeof s === 'string') q[k] = s.slice(0, 500);
  }
  Object.defineProperty(req, 'query', { value: q, writable: true, configurable: true, enumerable: true });
  for (const [k, v] of Object.entries(req.params || {})) if (typeof v === 'string' && v.length > 200) req.params[k] = v.slice(0, 200);
  next();
}

/** Final safety net on every JSON response: strip secret fields and private storage keys. */
const NEVER = new Set(['passwordHash', 'tokenHash', 'codeHash', 'otpHash', 'totpSecret', 'refreshToken', '__v', 'slotLock']);
function scrubOut(v, depth = 0) {
  if (!v || typeof v !== 'object' || depth > 12) return v;
  if (Array.isArray(v)) { for (const x of v) scrubOut(x, depth + 1); return v; }
  if (v instanceof Date || Buffer.isBuffer(v)) return v;
  for (const k of Object.keys(v)) {
    if (NEVER.has(k)) delete v[k];
    else if (k === 'key' && ('mime' in v || 'docType' in v)) delete v[k]; // private upload storage key
    else if (v[k] && typeof v[k] === 'object') scrubOut(v[k], depth + 1);
  }
  return v;
}
export function responseScrubber(req, res, next) {
  const json = res.json.bind(res);
  res.json = body => {
    try {
      if (body && typeof body === 'object') {
        const plain = JSON.parse(JSON.stringify(body));
        return json(scrubOut(plain));
      }
    } catch { /* fall through */ }
    return json(body);
  };
  next();
}
