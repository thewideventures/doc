import { Doctor, Clinic, User } from '../models/index.js';
import { statusMessage } from './accounts.js';
import { verifyAccess, verifyPhoneProof, familyActive, startSession, signPhoneProof } from './sessions.js';
import log from './logger.js';

// Patient / doctor / clinic authentication.
// Access: short-lived JWT (Authorization: Bearer …) held in memory by the SPA.
// Refresh: rotating httpOnly cookie handled by routes/auth.js.
export const USER_ROLES = ['patient', 'doctor', 'clinic'];

export function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

const deny = (res, status, error, code) => res.status(status).json({ error, code });
const EXPIRED = 'Your session has expired. Please sign in again.';

/** Load and status-check the principal behind verified claims. Returns { auth } or { status, error, code }. */
export async function loadPrincipal({ sub, role, did, cid }) {
  const user = await User.findOne({ id: sub });
  if (!user) return { status: 401, error: EXPIRED, code: 'SESSION_EXPIRED' };
  const um = statusMessage('user', user);
  if (um?.blocking) return { status: 403, error: um.error, code: um.code };
  const auth = { uid: user.id, role, phone: user.phone, user };
  if (role === 'doctor') {
    const doctor = did && user.doctorId === did ? await Doctor.findOne({ id: did }) : null;
    if (!doctor) return { status: 401, error: 'Doctor profile not found. Please sign in again.', code: 'SESSION_EXPIRED' };
    const m = statusMessage('doctor', doctor);
    if (m?.blocking) return { status: 403, error: m.error, code: m.code };
    auth.doctor = doctor;
  } else if (role === 'clinic') {
    const clinic = cid && user.clinicId === cid ? await Clinic.findOne({ id: cid }) : null;
    if (!clinic) return { status: 401, error: 'Clinic not found. Please sign in again.', code: 'SESSION_EXPIRED' };
    const m = statusMessage('clinic', clinic);
    if (m?.blocking) return { status: 403, error: m.error, code: m.code };
    auth.clinic = clinic;
  } else if (role !== 'patient') return { status: 401, error: EXPIRED, code: 'SESSION_EXPIRED' };
  return { auth };
}

async function claimsFromRequest(req) {
  const c = verifyAccess('user', bearer(req));
  if (!c || !USER_ROLES.includes(c.role)) return null;
  if (!(await familyActive(c.fam))) return null; // logged out / revoked
  return c;
}

/**
 * requireUser('doctor') / requireUser('clinic') / requireUser('patient') / requireUser() (any signed-in role).
 * Loads the principal and blocks suspended / deleted accounts with the reason.
 */
export function requireUser(...roles) {
  return async (req, res, next) => {
    try {
      const c = await claimsFromRequest(req);
      if (!c) return deny(res, 401, EXPIRED, 'SESSION_EXPIRED');
      if (roles.length && !roles.includes(c.role)) return deny(res, 403, 'This action is not available for your account type.', 'WRONG_ROLE');
      const r = await loadPrincipal(c);
      if (!r.auth) return deny(res, r.status, r.error, r.code);
      req.auth = { ...r.auth, token: c };
      next();
    } catch (err) {
      log.error('Auth error', { err });
      res.status(500).json({ error: 'Authentication failed' });
    }
  };
}

/** Attach req.auth when a valid token is present; never rejects. */
export async function optionalUser(req, res, next) {
  try {
    const c = await claimsFromRequest(req);
    if (c) {
      const user = await User.findOne({ id: c.sub });
      if (user) req.auth = { uid: user.id, role: c.role, phone: user.phone, user, token: { ...c, uid: c.sub } };
    }
  } catch { /* anonymous */ }
  next();
}

/** Phone verified via OTP: a phone-proof token, or a full session (phone taken from the account, never from the client). */
export async function verifiedPhoneFromRequest(req) {
  const t = bearer(req);
  const proof = verifyPhoneProof(t);
  if (proof?.ph) return proof.ph;
  const c = await claimsFromRequest(req);
  if (!c) return null;
  const user = await User.findOne({ id: c.sub }).select('phone').lean();
  return user?.phone || null;
}

export const issuePhoneProof = phone => signPhoneProof(phone);

/** Create a signed-in session for a user (sets refresh + CSRF cookies). Returns { token, expiresIn }. */
export async function issueUserSession(req, res, { user, role, doctorId = '', clinicId = '' }) {
  const s = await startSession(req, res, 'user', { role, subject: user.id, doctorId, clinicId });
  return { token: s.accessToken, expiresIn: s.expiresIn };
}
