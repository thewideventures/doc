// Clinic portal phase-4 routes (mounted at /api/clinic-portal, clinic session required): live queue for the
// clinic's doctor locations, earnings & invoices.
import express from 'express';
import { Doctor } from '../models/index.js';
import { requireUser } from '../lib/userAuth.js';
import { validate, z, zId, zDate } from '../lib/validate.js';
import { rateLimit, userKey } from '../lib/rateLimit.js';
import { httpError } from '../lib/bookings.js';
import { staffQueue, queueAction } from '../lib/queue.js';
import { todayIST } from '../lib/time.js';
import { mountEarnings } from './earnings.js';
import { queueActionSchema } from './doctorClinical.js';
import { wrap } from './common.js';

const router = express.Router();
router.use(requireUser('clinic'));
export default router;

async function clinicLocation(clinic, doctorId, locationId) {
  const d = await Doctor.findOne({ id: doctorId }).select('id name consultationLocations').lean();
  const loc = d?.consultationLocations?.find(l => l.id === locationId && l.kind === 'clinic' && l.clinicId === clinic.id && l.isActive !== false);
  if (!loc) throw httpError(404, 'Location not found'); // IDOR guard: only this clinic's locations
  return { d, loc };
}

router.get('/queue/locations', wrap(async (req, res) => {
  const c = req.auth.clinic;
  const docs = await Doctor.find({ consultationLocations: { $elemMatch: { kind: 'clinic', clinicId: c.id, isActive: { $ne: false } } } }).select('id name photo consultationLocations').lean();
  res.json({ success: true, locations: docs.flatMap(d => d.consultationLocations.filter(l => l.kind === 'clinic' && l.clinicId === c.id && l.isActive !== false).map(l => ({ doctorId: d.id, doctorName: d.name, photo: d.photo, locationId: l.id, locationName: l.name }))) });
}));
router.get('/queue', validate({ query: z.object({ doctorId: zId, locationId: zId, date: zDate.optional() }) }), wrap(async (req, res) => {
  const { d, loc } = await clinicLocation(req.auth.clinic, req.query.doctorId, req.query.locationId);
  res.json({ success: true, ...(await staffQueue(d.id, loc.id, req.query.date || todayIST(), req.auth.clinic.id)) });
}));
router.post('/queue/:action(start|pause|resume|close|next|done|skip|recall|delay|avg)', rateLimit({ name: 'queue-action', windowMs: 60 * 1000, max: 120, key: userKey }),
  validate({ body: queueActionSchema.extend({ doctorId: zId }) }), wrap(async (req, res) => {
    const { d, loc } = await clinicLocation(req.auth.clinic, req.body.doctorId, req.body.locationId);
    res.json({ success: true, ...(await queueAction({ doctorId: d.id, locationId: loc.id, clinicId: req.auth.clinic.id }, req.params.action, req.body, 'clinic')) });
  }));

mountEarnings(router, async req => ({ type: 'clinic', entity: req.auth.clinic }));
