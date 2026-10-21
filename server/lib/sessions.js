// Signed sessions: short-lived JWT access tokens (kept in memory by the browser) +
// rotating, revocable refresh tokens in httpOnly cookies (only a SHA-256 hash is stored in MongoDB).
// Reuse of an already-rotated refresh token (outside a short race window) revokes the whole session family.
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { AuthSession } from '../models/index.js';
import { config } from './config.js';
import log from './logger.js';

const ISS = 'findadoc';
export const POLICY = {
  user: { accessSec: 15 * 60, refreshIdleMs: 30 * 86400000, refreshMaxMs: 90 * 86400000, cookiePath: '/api/auth', aud: 'findadoc-user' },
  admin: { accessSec: 10 * 60, refreshIdleMs: 2 * 3600000, refreshMaxMs: 8 * 3600000, cookiePath: '/api/admin/auth', aud: 'findadoc-admin' }
};
const PHONE_PROOF_SEC = 15 * 60;
const GRACE_MS = 15 * 1000;
export const CSRF_COOKIE = 'fad_csrf';
export const refreshCookieName = (kind, role) => (kind === 'admin' ? 'fad_rt_admin' : `fad_rt_${role}`);

const secretFor = kind => (kind === 'admin' ? config.adminJwtSecret : config.userJwtSecret);
const sha256 = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const rid = (n = 16) => crypto.randomBytes(n).toString('base64url');

function cookieOpts(kind, maxAgeMs) {
  return { httpOnly: true, secure: config.secureCookies, sameSite: 'strict', path: POLICY[kind].cookiePath, maxAge: maxAgeMs };
}
export function setCsrfCookie(res) {
  const token = rid(24);
  res.cookie(CSRF_COOKIE, token, { httpOnly: false, secure: config.secureCookies, sameSite: 'strict', path: '/', maxAge: 90 * 86400000 });
  return token;
}

// ------------------------------------------------------------------ access tokens
export function signAccess(kind, s) {
  const p = POLICY[kind];
  const claims = { typ: 'access', role: s.role, fam: s.family };
  if (s.doctorId) claims.did = s.doctorId;
  if (s.clinicId) claims.cid = s.clinicId;
  return jwt.sign(claims, secretFor(kind), { algorithm: 'HS256', expiresIn: p.accessSec, issuer: ISS, audience: p.aud, subject: s.subject, jwtid: rid(9) });
}

export function verifyAccess(kind, token) {
  if (!token || typeof token !== 'string' || token.length > 2048) return null;
  try {
    const c = jwt.verify(token, secretFor(kind), { algorithms: ['HS256'], issuer: ISS, audience: POLICY[kind].aud });
    return c.typ === 'access' ? c : null;
  } catch { return null; }
}

/** Short-lived proof that the caller verified a phone number with OTP (used for registration). */
export function signPhoneProof(phone) {
  return jwt.sign({ typ: 'phone', ph: phone }, config.userJwtSecret, { algorithm: 'HS256', expiresIn: PHONE_PROOF_SEC, issuer: ISS, audience: 'findadoc-phone', jwtid: rid(9) });
}
export function verifyPhoneProof(token) {
  if (!token || typeof token !== 'string' || token.length > 2048) return null;
  try {
    const c = jwt.verify(token, config.userJwtSecret, { algorithms: ['HS256'], issuer: ISS, audience: 'findadoc-phone' });
    return c.typ === 'phone' ? c : null;
  } catch { return null; }
}

// ------------------------------------------------------------------ revocation cache
const famCache = new Map(); // family -> { active, at }
const FAM_TTL = 30 * 1000;
setInterval(() => { const now = Date.now(); for (const [k, v] of famCache) if (now - v.at > FAM_TTL) famCache.delete(k); }, 60000).unref();

export async function familyActive(family) {
  if (!family) return false;
  const hit = famCache.get(family);
  if (hit && Date.now() - hit.at < FAM_TTL) return hit.active;
  const active = Boolean(await AuthSession.exists({ family, revokedAt: null, expiresAt: { $gt: new Date() } }));
  famCache.set(family, { active, at: Date.now() });
  return active;
}

export async function revokeFamily(family, reason) {
  await AuthSession.updateMany({ family, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
  famCache.set(family, { active: false, at: Date.now() });
}

export async function revokeAllFor(kind, subject, reason) {
  const fams = await AuthSession.distinct('family', { kind, subject, revokedAt: null });
  await AuthSession.updateMany({ kind, subject, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: reason } });
  for (const f of fams) famCache.set(f, { active: false, at: Date.now() });
  return fams.length;
}

// ------------------------------------------------------------------ refresh sessions
async function createRow(kind, { role, subject, doctorId = '', clinicId = '', family, familyStartedAt, req }) {
  const p = POLICY[kind];
  const id = rid(12);
  const token = `${id}.${rid(32)}`;
  const started = familyStartedAt || new Date();
  const expiresAt = new Date(Math.min(Date.now() + p.refreshIdleMs, started.getTime() + p.refreshMaxMs));
  const row = await AuthSession.create({
    id, family: family || rid(12), kind, role, subject, doctorId, clinicId, tokenHash: sha256(token),
    ip: req?.ip || '', userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 200), familyStartedAt: started, expiresAt
  });
  famCache.set(row.family, { active: true, at: Date.now() });
  return { row, token };
}

/** Start a new session: sets the refresh + CSRF cookies and returns the access token. */
export async function startSession(req, res, kind, principal) {
  const { row, token } = await createRow(kind, { ...principal, req });
  res.cookie(refreshCookieName(kind, principal.role), token, cookieOpts(kind, row.expiresAt.getTime() - Date.now()));
  setCsrfCookie(res);
  return { accessToken: signAccess(kind, row), expiresIn: POLICY[kind].accessSec, sessionId: row.family };
}

const fail = (status, code, error) => Object.assign(new Error(error), { status, code });

/**
 * Rotate the refresh token from the cookie. Returns { accessToken, expiresIn, session }.
 * Throws 401 (no / invalid / expired / revoked), 409 REFRESH_RACE (concurrent rotation; retry), 401 SESSION_REVOKED on reuse.
 */
export async function rotateSession(req, res, kind, role) {
  const name = refreshCookieName(kind, role);
  const raw = req.cookies?.[name];
  const expired = () => fail(401, 'SESSION_EXPIRED', 'Your session has expired. Please sign in again.');
  if (!raw || typeof raw !== 'string' || raw.length > 200 || !raw.includes('.')) throw expired();
  const id = raw.split('.')[0];
  const row = await AuthSession.findOne({ id, kind });
  const ok = row && crypto.timingSafeEqual(Buffer.from(row.tokenHash), Buffer.from(sha256(raw)));
  if (!ok || row.role !== role) { res.clearCookie(name, { path: POLICY[kind].cookiePath }); throw expired(); }
  if (row.revokedAt || row.expiresAt < new Date()) { res.clearCookie(name, { path: POLICY[kind].cookiePath }); throw expired(); }

  const claimed = await AuthSession.findOneAndUpdate({ id, rotatedAt: null, revokedAt: null }, { $set: { rotatedAt: new Date() } }, { returnDocument: 'after' });
  if (!claimed) {
    const fresh = await AuthSession.findOne({ id });
    if (fresh?.rotatedAt && Date.now() - fresh.rotatedAt.getTime() < GRACE_MS) throw fail(409, 'REFRESH_RACE', 'Session is being refreshed, retry');
    await revokeFamily(row.family, 'refresh_token_reuse');
    log.warn('Refresh token reuse detected — session family revoked', { kind, role, subject: kind === 'admin' ? 'admin' : row.subject, ip: req.ip });
    res.clearCookie(name, { path: POLICY[kind].cookiePath });
    throw fail(401, 'SESSION_REVOKED', 'For your security this session was signed out. Please sign in again.');
  }
  // reuse after the grace window: an older token in this family that was already rotated
  const { row: next, token } = await createRow(kind, { role: row.role, subject: row.subject, doctorId: row.doctorId, clinicId: row.clinicId, family: row.family, familyStartedAt: row.familyStartedAt, req });
  await AuthSession.updateOne({ id }, { $set: { replacedBy: next.id } });
  res.cookie(name, token, cookieOpts(kind, next.expiresAt.getTime() - Date.now()));
  if (!req.cookies?.[CSRF_COOKIE]) setCsrfCookie(res);
  return { accessToken: signAccess(kind, next), expiresIn: POLICY[kind].accessSec, session: next };
}

/** Revoke the session behind the refresh cookie (if any) and clear cookies. */
export async function endSession(req, res, kind, role) {
  const name = refreshCookieName(kind, role);
  const raw = req.cookies?.[name];
  if (raw && typeof raw === 'string' && raw.length < 200) {
    const row = await AuthSession.findOne({ id: raw.split('.')[0], kind });
    if (row && crypto.timingSafeEqual(Buffer.from(row.tokenHash), Buffer.from(sha256(raw)))) await revokeFamily(row.family, 'logout');
  }
  res.clearCookie(name, { path: POLICY[kind].cookiePath });
}
