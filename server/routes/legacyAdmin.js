// Legacy "classic console" admin endpoints (kept for backwards compatibility with the classic AdminPortal view).
// All protected by requireAdminAuth.
import express from 'express';
import { Speciality, Clinic, Doctor, User, Booking, Review, SpecialityRequest } from '../models/index.js';
import { requireAdminAuth } from '../lib/adminAuth.js';
import { recalcDoctorRating } from '../lib/reviews.js';
import { notify } from '../lib/notify.js';
import { effectivePlan, getPlans } from '../lib/plans.js';

const app = express.Router();
export default app;

app.post('/api/specialities', requireAdminAuth, async (req, res) => {
  try {
    const { name, description, icon = 'Stethoscope', color = '#0284c7', keywords = [] } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
    const cleanName = String(name).trim();
    const id = cleanName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (await Speciality.findOne({ id })) return res.status(400).json({ error: 'Speciality already exists' });
    const newSpec = await Speciality.create({ id, name: cleanName, description: description || 'Specialized clinical domain', icon, color, keywords: Array.isArray(keywords) && keywords.length ? keywords : [cleanName.toLowerCase()] });
    res.json({ success: true, speciality: newSpec });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create speciality' });
  }
});

app.get('/api/admin/overview', requireAdminAuth, async (req, res) => {
  try {
    const doctors = (await Doctor.find().lean()).map(d => ({ ...d, documents: (d.documents || []).map(({ key, ...m }) => m) }));
    const clinics = await Clinic.find().lean();
    const bookings = await Booking.find({ status: { $ne: 'Expired' } }).sort({ createdAt: -1 }).limit(500).select('-slotLock -statusHistory').lean();
    const reviews = await Review.find().sort({ createdAt: -1 }).lean();
    const specialityRequests = await SpecialityRequest.find().sort({ createdAt: -1 }).lean();
    const users = await User.find().sort({ createdAt: -1 }).lean();

    // (legacy classic console endpoint — kept for backwards compatibility)
    const totalRevenue = bookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
    const platformRevenue = bookings.reduce((sum, b) => sum + (b.bookingPremiumFee || 49), 0);

    res.json({
      success: true,
      stats: {
        totalUsers: users.length,
        totalDoctors: doctors.length,
        verifiedDoctors: doctors.filter(d => d.isVerified).length,
        pendingDoctors: doctors.filter(d => !d.isVerified).length,
        totalClinics: clinics.length,
        verifiedClinics: clinics.filter(c => c.isVerified).length,
        totalBookings: bookings.length,
        totalReviews: reviews.length,
        totalRevenue,
        platformRevenue,
        pendingSpecialities: specialityRequests.filter(r => r.status === 'pending').length
      },
      users,
      doctors,
      clinics,
      bookings,
      reviews,
      specialityRequests
    });
  } catch (err) {
    console.error('Error fetching admin overview:', err);
    res.status(500).json({ error: 'Failed to load backend overview' });
  }
});

app.post('/api/admin/verify-doctor', requireAdminAuth, async (req, res) => {
  try {
    const { doctorId, verified = true } = req.body;
    const doc = await Doctor.findOne({ id: doctorId });
    if (!doc) return res.status(404).json({ error: 'Doctor not found' });
    doc.isVerified = Boolean(verified);
    if (!['suspended', 'deleted'].includes(doc.status)) {
      doc.status = verified ? 'active' : 'pending';
      doc.statusUpdatedAt = new Date();
      if (verified) doc.approvedAt = new Date();
    }
    await doc.save();
    res.json({ success: true, message: `Doctor ${doc.name} verification updated`, doctor: doc });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update verification' });
  }
});

app.post('/api/admin/verify-clinic', requireAdminAuth, async (req, res) => {
  try {
    const { clinicId, verified = true } = req.body;
    const clinic = await Clinic.findOne({ id: clinicId });
    if (!clinic) return res.status(404).json({ error: 'Clinic not found' });
    clinic.isVerified = Boolean(verified);
    if (!['suspended', 'deleted'].includes(clinic.status)) {
      clinic.status = verified ? 'active' : 'pending';
      clinic.statusUpdatedAt = new Date();
      if (verified) clinic.approvedAt = new Date();
    }
    await clinic.save();
    res.json({ success: true, message: `Clinic ${clinic.name} verification updated`, clinic });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update verification' });
  }
});

app.post('/api/admin/toggle-premium', requireAdminAuth, async (req, res) => {
  // Classic console toggle now maps onto subscriptions: ON = Pro granted by admin (30 days), OFF = Basic.
  try {
    const { targetType, id, isPremium } = req.body || {};
    const Model = targetType === 'doctor' ? Doctor : targetType === 'clinic' ? Clinic : null;
    if (!Model) return res.status(400).json({ error: 'Invalid targetType' });
    const doc = await Model.findOne({ id: String(id || '') });
    if (!doc) return res.status(404).json({ error: `${targetType} not found` });
    const ep = await effectivePlan(doc, targetType);
    const on = isPremium !== undefined ? Boolean(isPremium) : ep.tier === 0;
    const plan = (await getPlans()).find(p => p.audience === targetType && p.code === (on ? 'pro' : 'basic'));
    doc.subscription = on
      ? { planCode: 'pro', planName: plan?.name || 'Pro', startedAt: new Date(), expiresAt: new Date(Date.now() + (plan?.durationDays || 30) * 86400000), source: 'admin' }
      : { planCode: 'basic', planName: plan?.name || 'Basic', startedAt: new Date(), expiresAt: null, source: 'admin' };
    doc.isPremium = on;
    await doc.save();
    res.json({ success: true, message: `${doc.name} is now on ${on ? 'Pro' : 'Basic'}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// Classic console delete = soft delete (same as the new console; restorable from Doctors / Clinics / Patients)
app.delete('/api/admin/profile', requireAdminAuth, async (req, res) => {
  try {
    const { targetType, id } = req.body || {};
    const Model = targetType === 'doctor' ? Doctor : targetType === 'clinic' ? Clinic : targetType === 'user' ? User : null;
    if (!Model) return res.status(400).json({ error: 'Invalid targetType' });
    const item = await Model.findOne({ id: String(id || '') });
    if (!item) return res.status(404).json({ error: `${targetType} not found` });
    if (item.role === 'admin') return res.status(400).json({ error: 'Admin accounts cannot be deleted here' });
    if (item.status !== 'deleted') item.statusBeforeSuspension = item.status || '';
    item.status = 'deleted';
    item.statusReason = 'Deleted by FindADoc administrators';
    item.statusUpdatedAt = new Date();
    await item.save();
    res.json({ success: true, message: `${targetType} deleted (restorable from the admin console)` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete profile' });
  }
});

app.post('/api/admin/toggle-suspend', requireAdminAuth, async (req, res) => {
  try {
    const { targetType, id, reason } = req.body;
    const Model = targetType === 'doctor' ? Doctor : targetType === 'clinic' ? Clinic : targetType === 'user' ? User : null;
    if (Model) {
      const item = await Model.findOne({ id });
      if (!item) return res.status(404).json({ error: `${targetType} not found` });
      if (item.status === 'suspended') {
        item.status = item.statusBeforeSuspension && item.statusBeforeSuspension !== 'suspended' ? item.statusBeforeSuspension : (item.isVerified || targetType === 'user' ? 'active' : 'pending');
        item.statusReason = '';
        item.statusBeforeSuspension = '';
      } else {
        item.statusBeforeSuspension = item.status || '';
        item.status = 'suspended';
        item.statusReason = String(reason || 'Suspended by FindADoc administrators. Please contact support.');
      }
      item.statusUpdatedAt = new Date();
      await item.save();
      return res.json({ success: true, message: `${targetType} suspension: ${item.status === 'suspended'}` });
    }
    res.status(400).json({ error: 'Invalid targetType' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle suspension' });
  }
});

app.post('/api/admin/approve-speciality-request', requireAdminAuth, async (req, res) => {
  try {
    const { requestId, action = 'approve' } = req.body;
    const request = await SpecialityRequest.findOne({ id: requestId });
    if (!request) return res.status(404).json({ error: 'Request not found' });

    request.status = action === 'approve' ? 'approved' : 'rejected';
    await request.save();

    if (action === 'approve') {
      const cleanId = request.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
      const existing = await Speciality.findOne({ id: cleanId });
      if (!existing) {
        const newSpec = new Speciality({
          id: cleanId,
          name: request.name,
          description: request.description,
          icon: 'Sparkles',
          color: '#0284c7',
          keywords: [request.name.toLowerCase()]
        });
        await newSpec.save();
      }
    }

    res.json({
      success: true,
      message: `Speciality request ${action}d successfully.`,
      request
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to process request' });
  }
});

app.delete('/api/admin/profile', requireAdminAuth, async (req, res) => {
  try {
    // Soft delete so ledger / booking history stays intact
    const { targetType, id } = req.body;
    const now = new Date();
    if (targetType === 'doctor') {
      await Doctor.updateOne({ id }, { status: 'deleted', isSuspended: false, deletedAt: now, statusUpdatedAt: now, bookingEnabled: false });
    } else if (targetType === 'clinic') {
      await Clinic.updateOne({ id }, { status: 'deleted', isSuspended: false, deletedAt: now, statusUpdatedAt: now });
    } else if (targetType === 'review') {
      const r = await Review.findOneAndUpdate({ id }, { moderationStatus: 'deleted', deletedAt: now }, { returnDocument: 'after' });
      if (r) await recalcDoctorRating(r.doctorId);
    } else if (targetType === 'user') {
      await User.updateOne({ id }, { status: 'deleted', isSuspended: false, deletedAt: now, statusUpdatedAt: now });
    }
    res.json({ success: true, message: `${targetType} deleted` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete item' });
  }
});
