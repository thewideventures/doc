// Admin authentication: bcrypt (or legacy plaintext) password, optional TOTP 2FA, per-username lockout,
// short-lived admin JWT (separate secret) + rotating refresh cookie, and an audit trail.
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { AdminLoginState, AdminAuditLog } from '../models/index.js';
import { config } from './config.js';
import { verifyAccess, familyActive, startSession, rotateSession, endSession, revokeFamily } from './sessions.js';
import { verifyTotp } from './totp.js';
import log from './logger.js';

export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function adminToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return typeof req.headers['x-admin-token'] === 'string' ? req.headers['x-admin-token'] : '';
}

export async function requireAdminAuth(req, res, next) {
  try {
    const c = verifyAccess('admin', adminToken(req));
    if (!c || c.role !== 'superadmin' || !(await familyActive(c.fam))) {
      return res.status(401).json({ error: 'Unauthorized: valid admin session required. Please sign in again.', code: 'SESSION_EXPIRED' });
    }
    req.admin = { sub: c.sub, username: c.sub, role: c.role, fam: c.fam };
    next();
  } catch (e) { next(e); }
}

// ------------------------------------------------------------------ audit
export async function audit(req, action, { actor, status = 0, target = '', details = {} } = {}) {
  try {
    await AdminAuditLog.create({
      id: `aud-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`,
      actor: actor ?? req.admin?.username ?? '', action, method: req.method, path: req.originalUrl.split('?')[0].slice(0, 200),
      target: String(target).slice(0, 120), status, ip: req.ip || '', userAgent: String(req.headers['user-agent'] || '').slice(0, 200), details, at: new Date()
    });
  } catch (e) { log.error('Audit log write failed', { err: e.message }); }
}

const REDACT_BODY = /pass|secret|token|otp|totp|key/i;
function summarizeBody(body) {
  if (!body || typeof body !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(body).slice(0, 25)) {
    if (REDACT_BODY.test(k)) { out[k] = '[redacted]'; continue; }
    if (v == null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = typeof v === 'string' ? v.slice(0, 200) : v;
    else out[k] = Array.isArray(v) ? `[array:${v.length}]` : '[object]';
  }
  return out;
}

/** Audit every state-changing admin request after it completes (who / what / when / IP / result). */
export function auditMutations(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const body = summarizeBody(req.body);
  res.on('finish', () => {
    if (!req.admin) return;
    const route = req.route?.path ? `${req.baseUrl || ''}${req.route.path}` : req.originalUrl.split('?')[0];
    audit(req, `${req.method} ${route}`, { status: res.statusCode, target: Object.values(req.params || {}).join('/'), details: { body, params: req.params } });
  });
  next();
}

// ------------------------------------------------------------------ login
const fail = (res, status, error, code, extra = {}) => res.status(status).json({ error, code, ...extra });

async function passwordOk(password) {
  if (config.admin.passwordHash) return bcrypt.compare(password, config.admin.passwordHash);
  await bcrypt.compare(password, '$2b$10$CwTycUXWue0Thq9StjUM0uJ8DPLKXt1FYlwYpaW6Hn3vK0K0pXz5a').catch(() => false); // equalise timing
  return safeEqual(password.trim(), config.admin.password); // legacy plaintext mode (trimmed like before)
}

export async function adminLogin(req, res) {
  const username = String(req.body?.username || '').trim().toLowerCase().slice(0, 120);
  const password = String(req.body?.password || '').slice(0, 200);
  const code = String(req.body?.totp || req.body?.otp || '').trim();
  if (!username || !password) return fail(res, 400, 'Username and password are required', 'VALIDATION_ERROR');
  const key = crypto.createHash('sha256').update(username).digest('hex').slice(0, 32); // do not store attempted usernames verbatim
  const state = (await AdminLoginState.findOne({ username: key })) || new AdminLoginState({ username: key });
  const now = new Date();
  if (state.lockedUntil && state.lockedUntil > now) {
    const mins = Math.ceil((state.lockedUntil - now) / 60000);
    await audit(req, 'auth.login.locked', { actor: username, status: 423 });
    res.setHeader('Retry-After', mins * 60);
    return fail(res, 423, `Too many failed attempts. Admin login is locked for ${mins} more minute(s).`, 'ADMIN_LOCKED');
  }
  const userOk = safeEqual(username, config.admin.username.toLowerCase());
  const passOk = await passwordOk(password);
  const recordFailure = async reason => {
    state.failures = (state.lockedUntil && state.lockedUntil <= now ? 0 : state.failures) + 1;
    state.lastFailureAt = now;
    if (state.failures >= config.admin.maxFailures) { state.lockedUntil = new Date(now.getTime() + config.admin.lockMinutes * 60000); state.failures = 0; }
    await state.save();
    await audit(req, 'auth.login.failed', { actor: username, status: 401, details: { reason } });
    log.warn('Admin login failed', { ip: req.ip, reason });
  };
  if (!userOk || !passOk) { await recordFailure('bad_credentials'); return fail(res, 401, 'Invalid administrator credentials.', 'INVALID_CREDENTIALS'); }
  if (config.admin.totpSecret) {
    if (!code) return fail(res, 401, 'Enter the 6-digit code from your authenticator app.', 'TOTP_REQUIRED', { totpRequired: true });
    const step = verifyTotp(config.admin.totpSecret, code);
    if (!step || step <= (state.lastTotpStep || 0)) { await recordFailure(step ? 'totp_replay' : 'bad_totp'); return fail(res, 401, 'Invalid authenticator code.', 'TOTP_INVALID', { totpRequired: true }); }
    state.lastTotpStep = step;
  }
  state.failures = 0; state.lockedUntil = null; state.lastLoginAt = now;
  await state.save();
  const s = await startSession(req, res, 'admin', { role: 'superadmin', subject: config.admin.username });
  req.admin = { username: config.admin.username };
  await audit(req, 'auth.login', { status: 200 });
  res.json({ success: true, message: 'Admin authentication successful', adminToken: s.accessToken, expiresIn: s.expiresIn, adminUser: { username: config.admin.username, role: 'superadmin', totp: Boolean(config.admin.totpSecret) } });
}

export async function adminRefresh(req, res) {
  try {
    const r = await rotateSession(req, res, 'admin', 'superadmin');
    if (r.session.subject !== config.admin.username) { await revokeFamily(r.session.family, 'admin_changed'); return fail(res, 401, 'Session expired', 'SESSION_EXPIRED'); }
    res.json({ success: true, adminToken: r.accessToken, expiresIn: r.expiresIn, adminUser: { username: r.session.subject, role: 'superadmin', totp: Boolean(config.admin.totpSecret) } });
  } catch (e) {
    if (e.code === 'SESSION_REVOKED') await audit(req, 'auth.refresh.reuse_detected', { actor: '', status: 401 });
    if (e.status) return fail(res, e.status, e.message, e.code);
    throw e;
  }
}

export async function adminLogout(req, res) {
  const c = verifyAccess('admin', adminToken(req));
  if (c?.fam) await revokeFamily(c.fam, 'logout');
  await endSession(req, res, 'admin', 'superadmin');
  if (c) { req.admin = { username: c.sub }; await audit(req, 'auth.logout', { status: 200 }); }
  res.json({ success: true });
}
