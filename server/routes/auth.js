// Session endpoints for patients / doctors / clinics (cookie-based refresh, CSRF protected).
import express from 'express';
import { rotateSession, endSession, revokeFamily, revokeAllFor, verifyAccess } from '../lib/sessions.js';
import { loadPrincipal, requireUser, bearer, USER_ROLES } from '../lib/userAuth.js';
import { requireCsrf } from '../lib/security.js';
import { rateLimit } from '../lib/rateLimit.js';
import { effectivePlan } from '../lib/plans.js';
import { selfUser, selfDoctor, selfClinic } from '../lib/profiles.js';
import { validate, z, zRole } from '../lib/validate.js';
import { wrap } from './common.js';

const router = express.Router();
export default router;

const refreshLimit = rateLimit({ name: 'auth-refresh', windowMs: 15 * 60 * 1000, max: 300 });
const roleBody = z.object({ role: zRole });

router.post('/refresh', refreshLimit, requireCsrf, validate({ body: roleBody }), wrap(async (req, res) => {
  const { role } = req.body;
  const r = await rotateSession(req, res, 'user', role);
  const p = await loadPrincipal({ sub: r.session.subject, role, did: r.session.doctorId, cid: r.session.clinicId });
  if (!p.auth) {
    await revokeFamily(r.session.family, `principal_${p.code || 'invalid'}`);
    res.clearCookie(`fad_rt_${role}`, { path: '/api/auth' });
    return res.status(p.status).json({ error: p.error, code: p.code });
  }
  const a = p.auth;
  const out = { success: true, token: r.accessToken, expiresIn: r.expiresIn, role, user: selfUser(a.user) };
  if (a.doctor) out.doctor = selfDoctor(a.doctor, await effectivePlan(a.doctor, 'doctor'));
  if (a.clinic) out.clinic = selfClinic(a.clinic, await effectivePlan(a.clinic, 'clinic'));
  res.json(out);
}));

router.post('/logout', requireCsrf, validate({ body: roleBody }), wrap(async (req, res) => {
  const c = verifyAccess('user', bearer(req));
  if (c?.fam) await revokeFamily(c.fam, 'logout');
  await endSession(req, res, 'user', req.body.role);
  res.json({ success: true });
}));

// Sign out everywhere (all devices) for the current account
router.post('/logout-all', requireUser(), wrap(async (req, res) => {
  const n = await revokeAllFor('user', req.auth.uid, 'logout_all');
  for (const role of USER_ROLES) res.clearCookie(`fad_rt_${role}`, { path: '/api/auth' });
  res.json({ success: true, revoked: n });
}));
