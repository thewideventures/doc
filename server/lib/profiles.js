// Projections & helpers for doctor / clinic / patient profiles.
// Public projections never include phone numbers of doctors, documents, balances, GSTIN or internal status fields.
import { latLng, formatAddress, directionsUrl } from './geo.js';
import { planSummary } from './plans.js';
import { maskPhone } from './phone.js';

export const DEFAULT_DOCTOR_PHOTO = 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=600&auto=format&fit=crop&q=80';

export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^dr\.?\s+/, 'dr-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'doctor';
}

export function doctorSlug(doc) {
  return `${slugify(doc.name)}-${String(doc.id).replace(/[^a-z0-9]/gi, '').slice(-6).toLowerCase()}`;
}

export function publicLocation(loc, extra = {}) {
  const ll = latLng(loc.location);
  return {
    id: loc.id, kind: loc.kind, name: loc.name, clinicId: loc.clinicId || '', speciality: loc.speciality || '',
    // business numbers are masked in public responses (anti-harvesting); the full number is revealed per request
    phone: loc.kind === 'clinic' || loc.kind === 'hospital' ? maskPhone(loc.phone) : '',
    hasPhone: (loc.kind === 'clinic' || loc.kind === 'hospital') && Boolean(loc.phone),
    address: loc.kind === 'online' ? null : {
      line: loc.address?.line || '', area: loc.address?.area || '', city: loc.address?.city || '', district: loc.address?.district || '',
      state: loc.address?.state || '', pincode: loc.address?.pincode || '', landmark: loc.address?.landmark || ''
    },
    addressText: loc.kind === 'online' ? 'Online video consultation' : formatAddress(loc.address),
    lat: ll?.lat ?? null, lng: ll?.lng ?? null,
    directionsUrl: loc.kind === 'online' ? '' : directionsUrl(loc.location),
    serviceRadiusKm: loc.serviceRadiusKm || 0,
    schedule: { days: loc.schedule?.days || [], sessions: loc.schedule?.sessions || [], slotMinutes: loc.schedule?.slotMinutes || 20, slots: loc.schedule?.slots || [], advanceDays: loc.schedule?.advanceDays || 14 },
    fee: loc.fee || 0, bookingMode: loc.bookingMode || 'free', tokenAmount: loc.bookingMode === 'token' ? loc.tokenAmount || 0 : 0,
    notes: loc.notes || '',
    ...extra
  };
}

// Clinic locations of clinics that are not active (pending / suspended / deleted) are hidden from
// patients. The set is refreshed by refreshInactiveClinics() (called per public request, 30 s TTL).
let inactiveClinics = new Set();
let inactiveAt = 0;
export async function refreshInactiveClinics(ClinicModel, force = false) {
  if (!force && Date.now() - inactiveAt < 30000) return inactiveClinics;
  const rows = await ClinicModel.find({ status: { $ne: 'active' } }, { id: 1 }).lean();
  inactiveClinics = new Set(rows.map(r => r.id));
  inactiveAt = Date.now();
  return inactiveClinics;
}
export function invalidateInactiveClinics() { inactiveAt = 0; }

export function activeLocations(doc) {
  return (doc.consultationLocations || []).filter(l => l.isActive !== false && !(l.clinicId && inactiveClinics.has(l.clinicId)));
}

export function publicDoctor(doc, ep, extra = {}) {
  const locs = activeLocations(doc).map(l => publicLocation(l));
  const fees = locs.map(l => l.fee).filter(f => f >= 0);
  const ll = latLng(doc.location);
  return {
    id: doc.id, slug: doc.slug || doctorSlug(doc), name: doc.name, title: doc.title, photo: doc.photo || DEFAULT_DOCTOR_PHOTO,
    qualifications: doc.qualifications, experienceYears: doc.experienceYears, sector: doc.sector, gender: doc.gender || '',
    rating: doc.rating, reviewCount: doc.reviewCount, isVerified: doc.status === 'active',
    isPremium: ep ? ep.tier > 0 : Boolean(doc.isPremium),
    plan: ep ? { code: ep.code, name: ep.plan.name, verifiedBadge: Boolean(ep.limits.verifiedBadge), featured: Boolean(ep.limits.featuredInAi) } : null,
    registrationNumber: doc.registrationNumber || '', councilName: doc.councilName || '',
    specialities: doc.specialities || [], languages: doc.languages || [], bio: doc.bio || '',
    bookingEnabled: doc.bookingEnabled !== false && locs.length > 0,
    consultationFee: fees.length ? Math.min(...fees) : doc.consultationFee,
    bookingModes: [...new Set(locs.map(l => l.bookingMode))],
    clinics: (doc.clinics || []).filter(c => c.isApproved).map(c => ({ clinicId: c.clinicId, clinicName: c.clinicName, address: c.address, isApproved: true })),
    locations: locs,
    latitude: ll?.lat ?? doc.latitude, longitude: ll?.lng ?? doc.longitude,
    city: doc.addressDetails?.city || locs.find(l => l.address?.city)?.address.city || '',
    availableSlots: doc.availableSlots || [],
    ...extra
  };
}

export function doctorCompleteness(doc) {
  const locs = activeLocations(doc);
  const items = [
    { key: 'photo', label: 'Profile photo', done: Boolean(doc.photo && doc.photo !== DEFAULT_DOCTOR_PHOTO) },
    { key: 'basics', label: 'Name, title & qualifications', done: Boolean(doc.name && doc.qualifications && doc.title) },
    { key: 'registration', label: 'Medical council registration number', done: Boolean(doc.registrationNumber && doc.councilName) },
    { key: 'experience', label: 'Experience & speciality', done: Boolean(doc.experienceYears >= 0 && doc.specialities?.length) },
    { key: 'languages', label: 'Languages spoken', done: Boolean(doc.languages?.length) },
    { key: 'about', label: 'About you (40+ characters)', done: String(doc.bio || '').trim().length >= 40 },
    { key: 'location', label: 'Consultation location with timings & fee', done: locs.some(l => l.kind === 'online' || (l.location && l.address?.city)) },
    { key: 'document', label: 'Registration certificate uploaded', done: (doc.documents || []).length > 0 }
  ];
  const done = items.filter(i => i.done).length;
  return { percent: Math.round((done / items.length) * 100), items };
}

export function selfDoctor(doc, ep) {
  const o = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  delete o._id; delete o.__v; delete o.statusBeforeSuspension;
  o.documents = (o.documents || []).map(d => ({ id: d.id, docType: d.docType, label: d.label, originalName: d.originalName, mime: d.mime, size: d.size, status: d.status, uploadedAt: d.uploadedAt }));
  o.consultationLocations = (o.consultationLocations || []).map(l => ({ ...publicLocation(l), isActive: l.isActive !== false, managedBy: l.managedBy, autoConfirm: l.autoConfirm !== false, schedule: l.schedule, phone: l.phone || '', createdAt: l.createdAt }));
  const ll = latLng(o.location);
  o.lat = ll?.lat ?? null; o.lng = ll?.lng ?? null;
  o.slug = o.slug || doctorSlug(o);
  if (ep) o.plan = planSummary(ep);
  o.completeness = doctorCompleteness(doc);
  return o;
}

export function publicClinic(c, ep, extra = {}) {
  const ll = latLng(c.location);
  return {
    id: c.id, name: c.name, type: c.type, sector: c.sector, photo: c.photo || '', coverPhoto: c.coverPhoto || '',
    gallery: c.gallery || [], about: c.about || '', website: c.website || '', phone: maskPhone(c.phone), hasPhone: Boolean(c.phone),
    address: c.address, addressDetails: c.addressDetails || {}, city: c.addressDetails?.city || c.city,
    lat: ll?.lat ?? c.latitude ?? null, lng: ll?.lng ?? c.longitude ?? null,
    directionsUrl: directionsUrl(c.location), timings: c.timings || [], is24x7: Boolean(c.is24x7),
    facilities: c.facilities || [], doctorIds: c.doctorIds || [], isVerified: c.status === 'active',
    isPremium: ep ? ep.tier > 0 : Boolean(c.isPremium),
    plan: ep ? { code: ep.code, name: ep.plan.name, verifiedBadge: Boolean(ep.limits.verifiedBadge) } : null,
    ...extra
  };
}

export function selfClinic(c, ep) {
  const o = typeof c.toObject === 'function' ? c.toObject() : { ...c };
  delete o._id; delete o.__v; delete o.statusBeforeSuspension;
  const ll = latLng(o.location);
  o.lat = ll?.lat ?? null; o.lng = ll?.lng ?? null;
  if (ep) o.plan = planSummary(ep);
  return o;
}

export function selfUser(u) {
  const o = typeof u.toObject === 'function' ? u.toObject() : { ...u };
  delete o._id; delete o.__v; delete o.statusBeforeSuspension;
  const ll = latLng(o.location);
  o.lat = ll?.lat ?? null; o.lng = ll?.lng ?? null;
  return o;
}
