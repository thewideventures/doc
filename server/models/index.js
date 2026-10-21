import mongoose from 'mongoose';

// Unknown filter paths throw instead of being silently dropped (a dropped filter could widen a query).
mongoose.set('strictQuery', 'throw');
mongoose.set('sanitizeFilter', false); // request input is sanitised by lib/security.js before it reaches queries

// Never serialise secrets: any field whose name marks it as a hash / secret / token is removed from toJSON output.
const SENSITIVE_FIELD = /^(passwordHash|tokenHash|codeHash|otpHash|otp|secret|totpSecret|refreshToken|__v)$/;
function stripSensitive(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const k of Object.keys(obj)) {
    if (SENSITIVE_FIELD.test(k)) delete obj[k];
    else if (obj[k] && typeof obj[k] === 'object' && !(obj[k] instanceof Date)) stripSensitive(obj[k]);
  }
  return obj;
}
mongoose.plugin(schema => {
  const prev = schema.get('toJSON') || {};
  schema.set('toJSON', { ...prev, transform: (doc, ret, opts) => stripSensitive(prev.transform ? prev.transform(doc, ret, opts) || ret : ret) });
});
export { stripSensitive };

// Account lifecycle shared by doctors, clinics and users (patients).
// pending   -> registered, awaiting admin verification (not public, no bookings)
// active    -> verified & approved
// rejected  -> admin rejected the verification
// suspended -> admin suspended (reason shown to the account holder)
// deleted   -> soft-deleted by admin (kept so ledger history stays intact)
export const ACCOUNT_STATUSES = ['pending', 'active', 'rejected', 'suspended', 'deleted'];

function accountStatusFields() {
  return {
    status: { type: String, enum: ACCOUNT_STATUSES },
    statusReason: { type: String, default: '' }, // rejection / suspension reason
    statusBeforeSuspension: { type: String, default: '' },
    statusUpdatedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null }
  };
}

// Derive status for legacy records that pre-date the status field.
export function deriveLegacyStatus(doc, fallback = 'pending') {
  if (doc.isSuspended) return 'suspended';
  if (doc.isVerified) return 'active';
  return fallback;
}

function attachStatusSync(schema, fallback) {
  schema.pre('save', function () {
    if (!this.status) this.status = deriveLegacyStatus(this, fallback);
    this.isSuspended = this.status === 'suspended';
    if (this.status === 'suspended') this.suspensionReason = this.statusReason || this.suspensionReason;
    else this.suspensionReason = '';
  });
  schema.index({ status: 1, createdAt: -1 });
  schema.index({ createdAt: -1 });
}


// GeoJSON point. Only set when coordinates are known (2dsphere indexes reject half-filled points).
const PointSchema = new mongoose.Schema({
  type: { type: String, enum: ['Point'], default: 'Point' },
  coordinates: { type: [Number], default: undefined } // [lng, lat]
}, { _id: false });

// Structured postal address (India-first)
const AddressSchema = new mongoose.Schema({
  line: { type: String, default: '' },      // building / street
  area: { type: String, default: '' },      // locality / area
  city: { type: String, default: '' },
  district: { type: String, default: '' },
  state: { type: String, default: '' },
  pincode: { type: String, default: '' },
  landmark: { type: String, default: '' },
  formatted: { type: String, default: '' }  // one-line address from the map provider
}, { _id: false });

// Weekly schedule for a consultation location
const ScheduleSchema = new mongoose.Schema({
  days: { type: [String], default: () => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] }, // Mon..Sun
  sessions: { type: [{ start: String, end: String, _id: false }], default: () => [{ start: '09:00', end: '13:00' }, { start: '16:00', end: '19:00' }] },
  slotMinutes: { type: Number, default: 20 },
  slots: { type: [String], default: () => [] }, // explicit 'HH:MM' list (overrides sessions when non-empty)
  blockedDates: { type: [String], default: () => [] }, // YYYY-MM-DD holidays / leave
  advanceDays: { type: Number, default: 14 }
}, { _id: false });

export const LOCATION_KINDS = ['clinic', 'own_clinic', 'hospital', 'home_visit', 'online'];
export const BOOKING_MODES = ['free', 'paid', 'token'];

// A place (or mode) where a doctor consults. 'clinic' locations are linked to a Clinic and managed by it.
const ConsultationLocationSchema = new mongoose.Schema({
  id: { type: String, required: true },
  kind: { type: String, enum: LOCATION_KINDS, default: 'own_clinic' },
  name: { type: String, default: '' },
  clinicId: { type: String, default: '' },
  managedBy: { type: String, enum: ['doctor', 'clinic'], default: 'doctor' },
  speciality: { type: String, default: '' }, // department at a clinic
  phone: { type: String, default: '' },
  address: { type: AddressSchema, default: () => ({}) },
  location: { type: PointSchema, default: undefined },
  serviceRadiusKm: { type: Number, default: 0 }, // home visits
  schedule: { type: ScheduleSchema, default: () => ({}) },
  fee: { type: Number, default: 500 },
  bookingMode: { type: String, enum: BOOKING_MODES, default: 'free' },
  tokenAmount: { type: Number, default: 0 }, // advance for 'token' mode
  autoConfirm: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  notes: { type: String, default: '' }, // shown to patients (e.g. "Bring old prescriptions")
  createdAt: { type: Date, default: Date.now }
}, { _id: false });

// Uploaded verification document (stored privately; served only to owner/admin)
const DocumentSchema = new mongoose.Schema({
  id: { type: String, required: true },
  docType: { type: String, default: 'registration_certificate' },
  label: { type: String, default: '' },
  key: { type: String, required: true },
  originalName: { type: String, default: '' },
  mime: { type: String, default: '' },
  size: { type: Number, default: 0 },
  status: { type: String, enum: ['submitted', 'verified', 'rejected'], default: 'submitted' },
  uploadedAt: { type: Date, default: Date.now }
}, { _id: false });

// Current subscription on a doctor / clinic
const SubscriptionStateSchema = new mongoose.Schema({
  planCode: { type: String, default: 'basic' },
  planName: { type: String, default: 'Basic' },
  startedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null }, // null = no expiry (free / legacy / admin grant)
  source: { type: String, default: 'default' }, // default | purchase | admin | legacy
  lastOrderId: { type: String, default: '' }
}, { _id: false });

// Speciality Schema
const SpecialitySchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  icon: { type: String, default: 'Stethoscope' },
  color: { type: String, default: '#0284c7' },
  keywords: [{ type: String }]
}, { timestamps: true });

// Clinic Schema
const ClinicSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { type: String, default: 'Multi-Speciality Clinic' },
  sector: { type: String, enum: ['Private', 'Government'], default: 'Private' },
  address: { type: String, required: true },
  city: { type: String, default: 'Metropolis' },
  latitude: { type: Number, default: 28.6139 },
  longitude: { type: Number, default: 77.2090 },
  phone: { type: String, required: true },
  isVerified: { type: Boolean, default: false }, // Must be approved by admin
  isPremium: { type: Boolean, default: false },
  isSuspended: { type: Boolean, default: false },
  suspensionReason: { type: String, default: '' },
  ...accountStatusFields(),
  email: { type: String, default: '' },
  state: { type: String, default: '' }, // State name, used for GST place of supply
  stateCode: { type: String, default: '' }, // 2-digit GST state code
  gstin: { type: String, default: '' },
  claimPendingFee: { type: Number, default: 0 }, // Available balance for payout
  payoutPendingFee: { type: Number, default: 0 }, // Locked in an open payout request
  claimedFee: { type: Number, default: 0 }, // Total paid out
  photo: { type: String, default: '' }, // logo
  coverPhoto: { type: String, default: '' },
  gallery: [{ type: String }],
  about: { type: String, default: '' },
  website: { type: String, default: '' },
  addressDetails: { type: AddressSchema, default: () => ({}) },
  location: { type: PointSchema, default: undefined },
  timings: {
    type: [{ day: String, open: String, close: String, closed: Boolean, _id: false }],
    default: () => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => ({ day: d, open: '09:00', close: '20:00', closed: d === 'Sun' }))
  },
  is24x7: { type: Boolean, default: false },
  subscription: { type: SubscriptionStateSchema, default: () => ({}) },
  facilities: [{ type: String }],
  doctorIds: [{ type: String }],
  doctorAssignments: [{ doctorId: String, speciality: String, addedAt: Date, source: String, _id: false }],
  invites: [{
    id: String, doctorId: String, doctorName: String, phone: String, speciality: String,
    status: { type: String, default: 'invited' }, // invited | accepted | declined | cancelled
    createdAt: Date, respondedAt: Date, _id: false
  }],
  pendingRequests: [{
    doctorId: String,
    doctorName: String,
    qualifications: String,
    specialities: [String],
    requestedAt: String
  }]
}, { timestamps: true });

// Doctor Schema
const DoctorSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  title: { type: String, default: '' },
  photo: { type: String, default: '' },
  qualifications: { type: String, required: true },
  experienceYears: { type: Number, default: 1 },
  sector: { type: String, enum: ['Private', 'Government'], default: 'Private' },
  rating: { type: Number, default: 5.0 },
  reviewCount: { type: Number, default: 0 },
  isVerified: { type: Boolean, default: false }, // Must be approved by admin
  isPremium: { type: Boolean, default: false },
  isSuspended: { type: Boolean, default: false },
  suspensionReason: { type: String, default: '' },
  ...accountStatusFields(),
  state: { type: String, default: '' },
  stateCode: { type: String, default: '' },
  gstin: { type: String, default: '' },
  bookingEnabled: { type: Boolean, default: true },
  consultationFee: { type: Number, default: 500 },
  claimPendingFee: { type: Number, default: 0 },
  payoutPendingFee: { type: Number, default: 0 },
  claimedFee: { type: Number, default: 0 },
  specialities: [{ type: String }],
  clinics: [{
    clinicId: String,
    clinicName: String,
    address: String,
    isApproved: Boolean
  }],
  latitude: { type: Number, default: 28.6139 },
  longitude: { type: Number, default: 77.2090 },
  phone: { type: String, required: true },
  email: { type: String, default: '' },
  bio: { type: String, default: '' },
  availableSlots: [{ type: String }],
  // Onboarding / profile completeness
  slug: { type: String },
  gender: { type: String, default: '' },
  registrationNumber: { type: String, default: '' }, // medical council registration no.
  councilName: { type: String, default: '' },        // e.g. Travancore-Cochin Medical Council / NMC
  registrationYear: { type: Number, default: null },
  languages: [{ type: String }],
  addressDetails: { type: AddressSchema, default: () => ({}) },
  location: { type: PointSchema, default: undefined },
  consultationLocations: { type: [ConsultationLocationSchema], default: () => [] },
  documents: { type: [DocumentSchema], default: () => [] },
  subscription: { type: SubscriptionStateSchema, default: () => ({}) },
  createdByClinicId: { type: String, default: '' },
  profileCompletedAt: { type: Date, default: null }
}, { timestamps: true });

// User Schema (Patients, Doctors, Clinics, Admins)
const UserSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  name: { type: String, default: 'User' },
  role: { type: String, enum: ['patient', 'doctor', 'clinic', 'admin'], default: 'patient' },
  doctorId: { type: String, default: null },
  clinicId: { type: String, default: null },
  isVerified: { type: Boolean, default: false },
  isSuspended: { type: Boolean, default: false },
  suspensionReason: { type: String, default: '' },
  ...accountStatusFields(),
  email: { type: String, default: '' },
  state: { type: String, default: '' },
  stateCode: { type: String, default: '' },
  dob: { type: String, default: '' }, // YYYY-MM-DD
  gender: { type: String, default: '' },
  bloodGroup: { type: String, default: '' },
  photo: { type: String, default: '' },
  addressDetails: { type: AddressSchema, default: () => ({}) },
  location: { type: PointSchema, default: undefined },
  familyMembers: {
    type: [{ id: String, name: String, relation: String, dob: String, gender: String, _id: false }],
    default: () => []
  },
  lastLoginAt: { type: Date, default: null },
  registeredAt: { type: String, default: () => new Date().toISOString().split('T')[0] }
}, { timestamps: true });

// Booking Schema with GST & Platform Fee details
const BOOKING_STATUSES = ['AwaitingPayment', 'Pending', 'Confirmed', 'Completed', 'Cancelled', 'NoShow', 'Expired'];
export const ACTIVE_BOOKING_STATUSES = ['AwaitingPayment', 'Pending', 'Confirmed'];
const BookingSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  bookingCode: { type: String, required: true },
  invoiceNumber: { type: String, default: '' },
  doctorId: { type: String, required: true },
  doctorName: { type: String, required: true },
  clinicName: { type: String, default: '' },
  clinicId: { type: String, default: '' }, // set for bookings at a clinic location (visible to clinic + doctor)
  locationId: { type: String, default: '' },
  locationKind: { type: String, default: '' },
  locationName: { type: String, default: '' },
  locationAddress: { type: String, default: '' },
  locationPoint: { type: PointSchema, default: undefined },
  patientUserId: { type: String, default: '' },
  patientName: { type: String, required: true },
  patientPhone: { type: String, required: true },
  forMember: { id: String, name: String, relation: String },
  patientNote: { type: String, default: '' },
  date: { type: String, required: true },     // YYYY-MM-DD (legacy rows may hold free text)
  timeSlot: { type: String, required: true }, // HH:MM 24h (legacy rows may hold '10:00 AM')
  slotStart: { type: Date, default: null },   // absolute start time (IST-aware)
  slotLock: { type: String },                 // unique while active: doctorId|date|time (prevents double booking)
  source: { type: String, enum: ['online', 'clinic', 'doctor', 'legacy'], default: 'online' },
  // Money
  bookingMode: { type: String, enum: ['free', 'paid', 'token', 'offline', 'legacy'], default: 'legacy' },
  fee: { type: Number, required: true }, // consultation fee
  tokenAmount: { type: Number, default: 0 },
  bookingPremiumFee: { type: Number, default: 0 }, // platform fee (taxable)
  taxablePlatformFee: { type: Number, default: 0 },
  cgst: { type: Number, default: 0 },
  sgst: { type: Number, default: 0 },
  igst: { type: Number, default: 0 },
  amountPayableOnline: { type: Number, default: 0 },
  amountPaidOnline: { type: Number, default: 0 },
  amountDueAtClinic: { type: Number, default: 0 },
  totalAmount: { type: Number, default: function () { return (this.fee || 0) + (this.bookingPremiumFee || 0); } },
  payeeType: { type: String, enum: ['doctor', 'clinic', ''], default: 'doctor' },
  payeeId: { type: String, default: '' },
  paymentStatus: { type: String, enum: ['not_required', 'pending', 'paid', 'failed', 'refunded', 'partially_refunded', 'pay_at_clinic'], default: 'paid' },
  paymentOrderId: { type: String, default: '' },
  paymentId: { type: String, default: '' },
  refundAmount: { type: Number, default: 0 },
  refundStatus: { type: String, enum: ['none', 'pending', 'processed', 'failed', 'not_eligible'], default: 'none' },
  refundReference: { type: String, default: '' },
  refundLedgerNumber: { type: String, default: '' },
  sacCode: { type: String, default: '998311' },
  status: { type: String, enum: BOOKING_STATUSES, default: 'Confirmed' },
  statusHistory: [{ status: String, at: Date, by: String, note: String, _id: false }],
  cancelledBy: { type: String, default: '' }, // patient | doctor | clinic | admin | system
  cancelReason: { type: String, default: '' },
  cancelledAt: { type: Date, default: null },
  confirmedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  isPaid: { type: Boolean, default: true },
  claimStatus: { type: String, enum: ['Pending', 'Claimed'], default: 'Pending' }
}, { timestamps: true });
BookingSchema.index({ slotLock: 1 }, { unique: true, sparse: true });
BookingSchema.index({ doctorId: 1, date: 1, status: 1 });
BookingSchema.index({ clinicId: 1, date: 1, status: 1 });
BookingSchema.index({ patientPhone: 1, createdAt: -1 });
BookingSchema.index({ status: 1, createdAt: -1 });

// Review Schema with Automated Bad Word / Profanity Screen
const ReviewSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  doctorId: { type: String, required: true },
  userName: { type: String, required: true },
  userPhone: { type: String, default: '' },
  isVerifiedBooking: { type: Boolean, default: false },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, required: true },
  isFlagged: { type: Boolean, default: false }, // If contains bad words, flagged and hidden from public
  flagReason: { type: String, default: '' },
  badWordsFound: [{ type: String }],
  sentiment: { type: String, enum: ['positive', 'neutral', 'negative', 'flagged'], default: 'positive' },
  // Moderation: 'visible' (clean, public) | 'flagged' (hidden, bad words) | 'approved' (flagged but admin-approved, public) | 'deleted' (soft-deleted)
  moderationStatus: { type: String, enum: ['visible', 'flagged', 'approved', 'deleted'] },
  moderatedAt: { type: Date, default: null },
  moderationNote: { type: String, default: '' },
  deletedAt: { type: Date, default: null },
  date: { type: String, default: () => new Date().toISOString().split('T')[0] }
}, { timestamps: true });

// Speciality Request Schema
const SpecialityRequestSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  category: { type: String, default: 'General Medicine' },
  description: { type: String, default: '' },
  requestedByDoctorId: { type: String, required: true },
  doctorName: { type: String, required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  createdAt: { type: String, default: () => new Date().toISOString().split('T')[0] }
}, { timestamps: true });

// Subscription Transactions Schema (Doctor & Clinic Subscriptions + GST)
const SubscriptionTransactionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  invoiceNumber: { type: String, required: true },
  type: { type: String, enum: ['doctor_subscription', 'clinic_subscription'], required: true },
  entityId: { type: String, required: true },
  entityName: { type: String, required: true },
  plan: { type: String, enum: ['monthly', 'annual'], required: true },
  baseAmount: { type: Number, required: true },
  gstRate: { type: Number, default: 18 },
  cgst: { type: Number, required: true },
  sgst: { type: Number, required: true },
  totalAmount: { type: Number, required: true },
  sacCode: { type: String, default: '998311' },
  paymentStatus: { type: String, default: 'Paid' },
  createdAt: { type: String, default: () => new Date().toISOString() }
}, { timestamps: true });

// Payout Request Schema
const PayoutRequestSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  referenceCode: { type: String, required: true },
  entityType: { type: String, enum: ['doctor', 'clinic'], required: true },
  entityId: { type: String, required: true },
  entityName: { type: String, required: true },
  entityPhone: { type: String, default: '' },
  amount: { type: Number, required: true },
  // Lifecycle: Pending -> Approved -> Paid, or Pending/Approved -> Rejected. 'Completed' kept for legacy rows.
  status: { type: String, enum: ['Pending', 'Approved', 'Paid', 'Rejected', 'Completed'], default: 'Pending' },
  bankDetails: { type: String, default: '' },
  note: { type: String, default: '' }, // Requester note
  adminNote: { type: String, default: '' },
  paymentReference: { type: String, default: '' }, // UTR / bank reference no. when marked paid
  rejectionReason: { type: String, default: '' },
  requestedAt: { type: Date, default: Date.now },
  approvedAt: { type: Date, default: null },
  paidAt: { type: Date, default: null },
  rejectedAt: { type: Date, default: null },
  processedAt: { type: String, default: '' }
}, { timestamps: true });
PayoutRequestSchema.index({ status: 1, createdAt: -1 });
PayoutRequestSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

// Unified GST ledger transaction (subscriptions from doctors/clinics, booking fees from patients)
const LedgerTransactionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  invoiceNumber: { type: String, required: true, unique: true }, // Sequential per financial year, e.g. FAD/26-27/000001
  invoiceSeq: { type: Number, required: true },
  financialYear: { type: String, required: true }, // e.g. 2026-27
  type: { type: String, enum: ['subscription', 'patient_fee', 'refund'], required: true },
  category: { type: String, enum: ['doctor_subscription', 'clinic_subscription', 'booking_fee', 'booking_refund', 'subscription_refund'], required: true },
  documentType: { type: String, enum: ['invoice', 'credit_note', 'refund_voucher'], default: 'invoice' },
  originalInvoiceNumber: { type: String, default: '' }, // for credit notes / refunds
  bookingMode: { type: String, default: '' },
  amountDueAtClinic: { type: Number, default: 0 }, // collected by doctor/clinic directly (not via platform)
  payeeType: { type: String, default: '' },
  payeeId: { type: String, default: '' },
  refundedAmount: { type: Number, default: 0 },
  refundStatus: { type: String, enum: ['none', 'partial', 'full'], default: 'none' },
  paymentOrderId: { type: String, default: '' },
  razorpayOrderId: { type: String, default: '' },
  razorpayPaymentId: { type: String, default: '' },
  razorpayRefundId: { type: String, default: '' },
  partyType: { type: String, enum: ['doctor', 'clinic', 'patient'], required: true },
  partyId: { type: String, default: '' },
  partyName: { type: String, default: '' },
  partyPhone: { type: String, default: '' },
  partyGstin: { type: String, default: '' },
  partyState: { type: String, default: '' },
  partyStateCode: { type: String, default: '' },
  description: { type: String, default: '' },
  plan: { type: String, default: '' },
  bookingId: { type: String, default: '' },
  doctorId: { type: String, default: '' },
  sacCode: { type: String, default: '998399' },
  // Tax computation
  taxableValue: { type: Number, required: true },
  gstRate: { type: Number, required: true },
  supplyType: { type: String, enum: ['intra', 'inter'], required: true },
  placeOfSupply: { type: String, default: '' }, // "32-Kerala"
  cgstRate: { type: Number, default: 0 },
  sgstRate: { type: Number, default: 0 },
  igstRate: { type: Number, default: 0 },
  cgst: { type: Number, default: 0 },
  sgst: { type: Number, default: 0 },
  igst: { type: Number, default: 0 },
  totalTax: { type: Number, default: 0 },
  invoiceValue: { type: Number, required: true }, // taxable + tax (platform's own supply)
  passThroughAmount: { type: Number, default: 0 }, // e.g. consultation fee collected on behalf of doctor (not platform's taxable supply)
  totalAmount: { type: Number, required: true }, // total collected from party = invoiceValue + passThroughAmount
  businessStateCode: { type: String, default: '' },
  businessGstin: { type: String, default: '' },
  status: { type: String, enum: ['paid', 'pending', 'failed', 'refunded'], default: 'paid' },
  paymentMethod: { type: String, default: 'online' },
  paymentReference: { type: String, default: '' },
  txnDate: { type: Date, default: Date.now }
}, { timestamps: true });
LedgerTransactionSchema.index({ type: 1, txnDate: -1 });
LedgerTransactionSchema.index({ txnDate: -1 });
LedgerTransactionSchema.index({ partyType: 1, partyId: 1 });

// Atomic counters (sequential invoice numbers)
const CounterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 }
});

// Singleton platform settings (GST config, bad-word overrides)
const SettingsSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'global' },
  businessName: { type: String, default: 'FindADoc' },
  businessGstin: { type: String, default: '' },
  businessState: { type: String, default: '' },
  businessStateCode: { type: String, default: '' },
  gstRate: { type: Number, default: 18 },
  sacCode: { type: String, default: '998399' },
  subscriptionSacCode: { type: String, default: '' },
  bookingFeeSacCode: { type: String, default: '' },
  invoicePrefix: { type: String, default: 'FAD' },
  pricesInclusiveOfGst: { type: Boolean, default: true },
  bookingPlatformFee: { type: Number, default: 49 },
  freeBookingPlatformFee: { type: Number, default: 0 }, // charged online for FREE-mode bookings (0 = nothing collected)
  cancellationWindowHours: { type: Number, default: 4 }, // patient cancels earlier than this => consultation/token refunded
  paymentHoldMinutes: { type: Number, default: 10 },
  extraBadWords: [{ type: String }],
  disabledBadWords: [{ type: String }]
}, { timestamps: true });


// Subscription plans (3 per audience, editable by admin). Price is in INR (GST treatment per Settings).
const PlanLimitsSchema = new mongoose.Schema({
  maxLocations: { type: Number, default: 1 },     // doctor: self-managed consultation locations (-1 = unlimited)
  maxSpecialities: { type: Number, default: 2 },  // doctor
  maxDoctors: { type: Number, default: 3 },       // clinic
  maxGalleryImages: { type: Number, default: 3 }, // clinic
  onlinePayments: { type: Boolean, default: false }, // PAID / BOOKING-AMOUNT modes
  analytics: { type: Boolean, default: false },
  verifiedBadge: { type: Boolean, default: false },
  listingPriority: { type: Number, default: 0 },  // higher = shown first in "Recommended"
  featuredInAi: { type: Boolean, default: false }
}, { _id: false });

const SubscriptionPlanSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true }, // e.g. doctor_pro
  audience: { type: String, enum: ['doctor', 'clinic'], required: true },
  code: { type: String, enum: ['basic', 'pro', 'premium'], required: true },
  tier: { type: Number, default: 0 },
  name: { type: String, required: true },
  tagline: { type: String, default: '' },
  price: { type: Number, default: 0 },
  durationDays: { type: Number, default: 30 },
  features: [{ type: String }],
  limits: { type: PlanLimitsSchema, default: () => ({}) },
  isActive: { type: Boolean, default: true },
  highlight: { type: Boolean, default: false },
  sortOrder: { type: Number, default: 0 }
}, { timestamps: true });
SubscriptionPlanSchema.index({ audience: 1, code: 1 }, { unique: true });

// Online payment order (booking or subscription) — provider agnostic (mock / razorpay)
const PaymentOrderSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  purpose: { type: String, enum: ['booking', 'subscription'], required: true },
  refId: { type: String, required: true }, // bookingId or planId
  partyType: { type: String, enum: ['patient', 'doctor', 'clinic'], required: true },
  partyId: { type: String, default: '' },
  amount: { type: Number, required: true }, // INR
  currency: { type: String, default: 'INR' },
  provider: { type: String, default: 'mock' },
  providerOrderId: { type: String, default: '' },
  providerPaymentId: { type: String, default: '' },
  // processing = a verify / webhook call has claimed the order and is applying it (prevents double application)
  status: { type: String, enum: ['created', 'processing', 'paid', 'failed', 'expired', 'refunded', 'partially_refunded', 'disputed'], default: 'created' },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  refunds: [{ id: String, amount: Number, status: String, providerRefundId: String, at: Date, reason: String, by: String, creditNoteNumber: String, _id: false }],
  refundedAmount: { type: Number, default: 0 },
  paymentMethod: { type: String, default: '' },
  failedAttempts: { type: Number, default: 0 },
  claimedAt: { type: Date, default: null },
  ledgerInvoiceNumber: { type: String, default: '' },
  paidAt: { type: Date, default: null },
  failureReason: { type: String, default: '' }
}, { timestamps: true });
PaymentOrderSchema.index({ purpose: 1, status: 1, createdAt: -1 });
PaymentOrderSchema.index({ partyType: 1, partyId: 1, createdAt: -1 });
// One Razorpay payment can settle exactly one order (replay protection). Empty ids (unpaid orders) are excluded.
PaymentOrderSchema.index({ providerPaymentId: 1 }, { unique: true, partialFilterExpression: { providerPaymentId: { $type: 'string', $gt: '' } }, name: 'uniq_provider_payment' });
PaymentOrderSchema.index({ providerOrderId: 1 }, { partialFilterExpression: { providerOrderId: { $type: 'string', $gt: '' } } });

// Refresh-token sessions (patients / doctors / clinics / admin). Only a SHA-256 of the token is stored.
const AuthSessionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },      // session id (also embedded in the cookie)
  family: { type: String, required: true, index: true },   // rotation chain; reuse of an old token revokes the family
  kind: { type: String, enum: ['user', 'admin'], required: true },
  role: { type: String, required: true },
  subject: { type: String, required: true },               // user id or admin username
  doctorId: { type: String, default: '' },
  clinicId: { type: String, default: '' },
  tokenHash: { type: String, required: true },
  replacedBy: { type: String, default: '' },
  rotatedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
  revokedReason: { type: String, default: '' },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  familyStartedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
AuthSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
AuthSessionSchema.index({ kind: 1, subject: 1, revokedAt: 1 });

// OTP challenges (hashed code, expiry, attempt counter, resend cooldown, lockout)
const OtpChallengeSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },   // 10 digits
  codeHash: { type: String, default: '' },
  expiresAt: { type: Date, default: null },
  attempts: { type: Number, default: 0 },
  lastSentAt: { type: Date, default: null },
  sendCount: { type: Number, default: 0 },
  sendWindowStart: { type: Date, default: null },
  lockedUntil: { type: Date, default: null },
  purgeAt: { type: Date, default: () => new Date(Date.now() + 24 * 3600 * 1000) }
}, { timestamps: true });
OtpChallengeSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

// Admin login failures / lockout (per username)
const AdminLoginStateSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  failures: { type: Number, default: 0 },
  lockedUntil: { type: Date, default: null },
  lastFailureAt: { type: Date, default: null },
  lastLoginAt: { type: Date, default: null },
  lastTotpStep: { type: Number, default: 0 } // TOTP replay protection
}, { timestamps: true });

// Admin audit log: who did what, when, from where
const AdminAuditLogSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  actor: { type: String, default: '' },
  action: { type: String, required: true },     // e.g. "POST /api/admin/doctors/:id/status" or "auth.login.failed"
  method: { type: String, default: '' },
  path: { type: String, default: '' },
  target: { type: String, default: '' },
  status: { type: Number, default: 0 },
  ip: { type: String, default: '' },
  userAgent: { type: String, default: '' },
  details: { type: mongoose.Schema.Types.Mixed, default: {} },
  at: { type: Date, default: Date.now }
}, { timestamps: false });
AdminAuditLogSchema.index({ at: -1 });
AdminAuditLogSchema.index({ actor: 1, at: -1 });
AdminAuditLogSchema.index({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 730, name: 'audit_ttl_2y' });

// Razorpay webhook deliveries (idempotency by x-razorpay-event-id)
const WebhookEventSchema = new mongoose.Schema({
  eventId: { type: String, required: true, unique: true },
  provider: { type: String, default: 'razorpay' },
  event: { type: String, default: '' },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  status: { type: String, enum: ['received', 'processed', 'ignored', 'failed'], default: 'received' },
  attempts: { type: Number, default: 0 },
  error: { type: String, default: '' },
  processedAt: { type: Date, default: null }
}, { timestamps: true });
WebhookEventSchema.index({ status: 1, updatedAt: 1 });
WebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

// In-app notifications
const NotificationSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  recipientType: { type: String, enum: ['patient', 'doctor', 'clinic', 'admin'], required: true },
  recipientId: { type: String, required: true },
  type: { type: String, default: 'info' }, // booking_new, booking_status, account_status, invite, payout, subscription ...
  title: { type: String, required: true },
  body: { type: String, default: '' },
  link: { type: String, default: '' },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  readAt: { type: Date, default: null }
}, { timestamps: true });
NotificationSchema.index({ recipientType: 1, recipientId: 1, createdAt: -1 });
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 }); // auto-prune after 180 days

attachStatusSync(ClinicSchema, 'pending');
attachStatusSync(DoctorSchema, 'pending');
attachStatusSync(UserSchema, 'active');
UserSchema.index({ role: 1, status: 1, createdAt: -1 });
ReviewSchema.index({ moderationStatus: 1, createdAt: -1 });
ReviewSchema.index({ doctorId: 1, moderationStatus: 1 });
ReviewSchema.pre('save', function () {
  if (!this.moderationStatus) this.moderationStatus = this.isFlagged ? 'flagged' : 'visible';
});
BookingSchema.index({ createdAt: -1 });
DoctorSchema.index({ slug: 1 }, { unique: true, sparse: true });
DoctorSchema.index({ location: '2dsphere' });
DoctorSchema.index({ 'consultationLocations.location': '2dsphere' });
DoctorSchema.index({ phone: 1 });
ClinicSchema.index({ location: '2dsphere' });
ClinicSchema.index({ phone: 1 });

export const PUBLIC_REVIEW_FILTER = { moderationStatus: { $in: ['visible', 'approved'] } };

export const Speciality = mongoose.model('Speciality', SpecialitySchema);
export const Clinic = mongoose.model('Clinic', ClinicSchema);
export const Doctor = mongoose.model('Doctor', DoctorSchema);
export const User = mongoose.model('User', UserSchema);
export const Booking = mongoose.model('Booking', BookingSchema);
export const Review = mongoose.model('Review', ReviewSchema);
export const SpecialityRequest = mongoose.model('SpecialityRequest', SpecialityRequestSchema);
export const SubscriptionTransaction = mongoose.model('SubscriptionTransaction', SubscriptionTransactionSchema);
export const PayoutRequest = mongoose.model('PayoutRequest', PayoutRequestSchema);
export const LedgerTransaction = mongoose.model('LedgerTransaction', LedgerTransactionSchema);
export const Counter = mongoose.model('Counter', CounterSchema);
export const Settings = mongoose.model('Settings', SettingsSchema);
export const SubscriptionPlan = mongoose.model('SubscriptionPlan', SubscriptionPlanSchema);
export const PaymentOrder = mongoose.model('PaymentOrder', PaymentOrderSchema);
export const Notification = mongoose.model('Notification', NotificationSchema);
export const AuthSession = mongoose.model('AuthSession', AuthSessionSchema);
export const OtpChallenge = mongoose.model('OtpChallenge', OtpChallengeSchema);
export const AdminLoginState = mongoose.model('AdminLoginState', AdminLoginStateSchema);
export const AdminAuditLog = mongoose.model('AdminAuditLog', AdminAuditLogSchema);
export const WebhookEvent = mongoose.model('WebhookEvent', WebhookEventSchema);
