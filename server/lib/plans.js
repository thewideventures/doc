import { SubscriptionPlan } from '../models/index.js';

// Default plans (seeded once; afterwards editable in Admin > Subscriptions). Prices in INR, GST-inclusive by default.
// Limits: -1 = unlimited.
export const DEFAULT_PLANS = [
  {
    id: 'doctor_basic', audience: 'doctor', code: 'basic', tier: 0, name: 'Basic', tagline: 'Get listed and take free bookings',
    price: 0, durationDays: 0, sortOrder: 1,
    features: ['1 consultation location', 'Up to 2 specialities', 'Free online bookings (patient pays at clinic)', 'Booking panel & in-app notifications', 'Standard search listing'],
    limits: { maxLocations: 1, maxSpecialities: 2, maxDoctors: 0, maxGalleryImages: 0, onlinePayments: false, analytics: false, verifiedBadge: false, listingPriority: 0, featuredInAi: false }
  },
  {
    id: 'doctor_pro', audience: 'doctor', code: 'pro', tier: 1, name: 'Pro', tagline: 'Collect fees online and grow your practice',
    price: 999, durationDays: 30, sortOrder: 2, highlight: true,
    features: ['Up to 3 consultation locations', 'Up to 4 specialities', 'Collect full fee or booking amount online', 'Booking analytics', 'PRO verified badge', 'Priority search listing'],
    limits: { maxLocations: 3, maxSpecialities: 4, maxDoctors: 0, maxGalleryImages: 0, onlinePayments: true, analytics: true, verifiedBadge: true, listingPriority: 1, featuredInAi: false }
  },
  {
    id: 'doctor_premium', audience: 'doctor', code: 'premium', tier: 2, name: 'Premium', tagline: 'Maximum visibility across every channel',
    price: 2499, durationDays: 30, sortOrder: 3,
    features: ['Unlimited locations (clinic, hospital, home visit, online)', 'Up to 8 specialities', 'Online payments (full fee / booking amount)', 'Advanced analytics', 'Premium verified badge', 'Top listing + featured in AI symptom search'],
    limits: { maxLocations: -1, maxSpecialities: 8, maxDoctors: 0, maxGalleryImages: 0, onlinePayments: true, analytics: true, verifiedBadge: true, listingPriority: 2, featuredInAi: true }
  },
  {
    id: 'clinic_basic', audience: 'clinic', code: 'basic', tier: 0, name: 'Basic', tagline: 'List your clinic and up to 3 doctors',
    price: 0, durationDays: 0, sortOrder: 1,
    features: ['Up to 3 doctors', '3 gallery photos', 'Free online bookings (pay at clinic)', 'Shared booking panel with doctors', 'Standard listing'],
    limits: { maxLocations: 1, maxSpecialities: 0, maxDoctors: 3, maxGalleryImages: 3, onlinePayments: false, analytics: false, verifiedBadge: false, listingPriority: 0, featuredInAi: false }
  },
  {
    id: 'clinic_pro', audience: 'clinic', code: 'pro', tier: 1, name: 'Pro', tagline: 'For growing multi-doctor clinics',
    price: 2999, durationDays: 30, sortOrder: 2, highlight: true,
    features: ['Up to 15 doctors', '12 gallery photos', 'Collect fees / booking amount online', 'Clinic analytics', 'Verified clinic badge', 'Priority listing'],
    limits: { maxLocations: 1, maxSpecialities: 0, maxDoctors: 15, maxGalleryImages: 12, onlinePayments: true, analytics: true, verifiedBadge: true, listingPriority: 1, featuredInAi: false }
  },
  {
    id: 'clinic_premium', audience: 'clinic', code: 'premium', tier: 2, name: 'Premium', tagline: 'Hospitals and large clinics',
    price: 6999, durationDays: 30, sortOrder: 3,
    features: ['Unlimited doctors', '30 gallery photos', 'Online payments', 'Advanced analytics', 'Premium verified badge', 'Top listing + featured in AI symptom search'],
    limits: { maxLocations: 1, maxSpecialities: 0, maxDoctors: -1, maxGalleryImages: 30, onlinePayments: true, analytics: true, verifiedBadge: true, listingPriority: 2, featuredInAi: true }
  }
];

let cache = null;
let cacheAt = 0;

export async function ensurePlans() {
  for (const p of DEFAULT_PLANS) {
    await SubscriptionPlan.updateOne({ id: p.id }, { $setOnInsert: p }, { upsert: true });
  }
  invalidatePlans();
}

export function invalidatePlans() { cache = null; }

export async function getPlans() {
  if (cache && Date.now() - cacheAt < 30000) return cache;
  const list = await SubscriptionPlan.find().sort({ audience: 1, sortOrder: 1 }).lean();
  cache = list.length ? list : DEFAULT_PLANS;
  cacheAt = Date.now();
  return cache;
}

export const isUnlimited = n => n === -1 || n === null || n === undefined;
export const withinLimit = (count, max) => isUnlimited(max) || count < max;

/** Effective plan for a doctor/clinic document (expired paid plans fall back to Basic). */
export async function effectivePlan(entity, audience) {
  const plans = await getPlans();
  const list = plans.filter(p => p.audience === audience);
  const basic = list.find(p => p.code === 'basic') || DEFAULT_PLANS.find(p => p.audience === audience && p.code === 'basic');
  const sub = entity?.subscription || {};
  let code = sub.planCode || (entity?.isPremium ? 'pro' : 'basic');
  const expired = Boolean(code !== 'basic' && sub.expiresAt && new Date(sub.expiresAt) < new Date());
  if (expired) code = 'basic';
  const plan = list.find(p => p.code === code) || basic;
  return {
    plan,
    code: plan.code,
    tier: plan.tier,
    limits: { ...basic.limits, ...(plan.limits || {}) },
    expired,
    expiresAt: expired ? null : sub.expiresAt || null,
    subscribedCode: sub.planCode || 'basic',
    source: sub.source || 'default'
  };
}

export function planSummary(ep) {
  return { code: ep.code, name: ep.plan.name, tier: ep.tier, expiresAt: ep.expiresAt, expired: ep.expired, limits: ep.limits };
}
