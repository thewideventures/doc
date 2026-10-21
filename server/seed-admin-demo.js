/* eslint-disable no-console */
// =============================================================================
// DEV-ONLY demo data for the admin panel. NEVER run against production.
// Not imported or auto-run by the server.
//
//   MONGODB_URI=mongodb://127.0.0.1:27999/findadoc_test node server/seed-admin-demo.js          # seed
//   MONGODB_URI=mongodb://127.0.0.1:27999/findadoc_test node server/seed-admin-demo.js --clean  # remove demo rows
//
// Safety: this script does NOT load .env, requires MONGODB_URI to be set explicitly,
// and refuses any host other than localhost / 127.0.0.1 (pass --i-know-this-is-not-prod to override).
// All demo rows use ids starting with "demo-" so --clean removes exactly them.
// =============================================================================
import mongoose from 'mongoose';
import { Doctor, Clinic, User, Review, Booking, LedgerTransaction, PayoutRequest, PaymentOrder, Notification } from './models/index.js';
import { ensurePlans } from './lib/plans.js';
import { toPoint } from './lib/geo.js';
import { istInstant, todayIST, addDays } from './lib/time.js';
import { recordLedgerTransaction } from './lib/gst.js';
import { getSettings } from './lib/settings.js';
import { screenReviewText } from './lib/moderation.js';
import { recalcDoctorRating } from './lib/reviews.js';

const uri = process.env.MONGODB_URI;
const args = new Set(process.argv.slice(2));
if (!uri) { console.error('Set MONGODB_URI explicitly (a local throwaway database).'); process.exit(1); }
let host = '';
try { host = new URL(uri).hostname; } catch { /* ignore */ }
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !args.has('--i-know-this-is-not-prod')) {
  console.error('Refusing to seed a non-local MongoDB host. This script is for local/dev databases only.');
  process.exit(1);
}

const DEMO = /^demo-/;
const daysAgo = n => new Date(Date.now() - n * 86400000);
const pick = (arr, i) => arr[i % arr.length];

async function clean() {
  const r = await Promise.all([
    Doctor.deleteMany({ id: DEMO }), Clinic.deleteMany({ id: DEMO }), User.deleteMany({ id: DEMO }),
    Review.deleteMany({ id: DEMO }), Booking.deleteMany({ id: DEMO }),
    LedgerTransaction.deleteMany({ $or: [{ partyId: DEMO }, { bookingId: DEMO }] }),
    PayoutRequest.deleteMany({ id: DEMO }),
    PaymentOrder.deleteMany({ $or: [{ partyId: DEMO }, { refId: DEMO }] }),
    Notification.deleteMany({ recipientId: DEMO })
  ]);
  console.log('Removed demo rows:', r.map(x => x.deletedCount).join(' / '), '(doctors/clinics/users/reviews/bookings/txns/payouts/orders/notifications)');
}

async function setCreated(Model, id, date) {
  await Model.collection.updateOne({ id }, { $set: { createdAt: date } });
}

async function seed() {
  await clean();
  await ensurePlans();
  const settings = await getSettings({ fresh: true });
  const CITY = { Kochi: [9.9312, 76.2673, 'Ernakulam', '6820'], Bengaluru: [12.9716, 77.5946, 'Bengaluru Urban', '5600'], Chennai: [13.0827, 80.2707, 'Chennai', '6000'], Mumbai: [19.076, 72.8777, 'Mumbai', '4000'], Delhi: [28.6139, 77.209, 'New Delhi', '1100'] };
  const ALL_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const wide = { days: ALL_DAYS, sessions: [{ start: '07:00', end: '13:00' }, { start: '14:00', end: '22:00' }], slotMinutes: 30, slots: [], blockedDates: [], advanceDays: 14 };
  const specs = ['Cardiologist', 'Dermatologist', 'Pediatrician', 'ENT Specialist', 'Neurologist', 'General Physician', 'Orthopedic Surgeon'];
  const firstNames = ['Anil', 'Meera', 'Rahul', 'Fathima', 'Joseph', 'Lakshmi', 'Arjun', 'Sneha', 'Vikram', 'Nisha', 'Imran', 'Divya', 'Suresh', 'Ayesha', 'Kiran'];
  const lastNames = ['Nair', 'Menon', 'Sharma', 'Pillai', 'Khan', 'Iyer', 'Thomas', 'Reddy', 'Varghese', 'Gupta'];
  const statuses = ['active', 'active', 'active', 'pending', 'active', 'rejected', 'suspended', 'active', 'pending', 'active'];
  const states = [['Kerala', '32'], ['Karnataka', '29'], ['Tamil Nadu', '33'], ['Maharashtra', '27'], ['Delhi', '07']];

  // Clinics
  const clinics = [];
  for (let i = 0; i < 10; i++) {
    const [state, code] = pick(states, i);
    const status = pick(['active', 'active', 'pending', 'active', 'suspended', 'active', 'pending', 'active', 'rejected', 'active'], i);
    const c = await Clinic.create({
      id: `demo-clinic-${i + 1}`, name: `${pick(['Lifeline', 'Sunrise', 'Amrita', 'Hope', 'Green Valley'], i)} ${pick(['Clinic', 'Hospital', 'Medical Centre'], i)} ${i + 1}`,
      type: pick(['Multi-Speciality Clinic', 'Hospital', 'Diagnostic Centre'], i), sector: i % 4 === 0 ? 'Government' : 'Private',
      address: `${10 + i} MG Road`, city: pick(['Kochi', 'Bengaluru', 'Chennai', 'Mumbai', 'Delhi'], i), state, stateCode: code,
      gstin: i % 3 === 0 ? `${code}AABCD${String(1000 + i).padStart(4, '0')}E1Z${i}` : '',
      phone: `+91 90000 1${String(i).padStart(4, '0')}`, email: `clinic${i + 1}@demo.test`,
      status, isVerified: status === 'active' || status === 'suspended', statusReason: status === 'suspended' ? 'Unpaid dues and licence renewal pending' : status === 'rejected' ? 'Registration documents unreadable' : '',
      claimPendingFee: 2000 + i * 750,
      addressDetails: (() => { const city = pick(['Kochi', 'Bengaluru', 'Chennai', 'Mumbai', 'Delhi'], i); return { line: `${10 + i} MG Road`, area: pick(['Central', 'North', 'East'], i), city, district: CITY[city][2], state, pincode: `${CITY[city][3]}${String(10 + i).padStart(2, '0')}`, formatted: '' }; })(),
      location: (() => { const city = pick(['Kochi', 'Bengaluru', 'Chennai', 'Mumbai', 'Delhi'], i); return toPoint(CITY[city][0] + i * 0.004, CITY[city][1] + i * 0.003); })(),
      facilities: ['Pharmacy', 'Lab', 'Parking', 'Wheelchair access'].slice(0, 2 + (i % 3)),
      subscription: i % 3 === 0 ? { planCode: 'pro', planName: 'Clinic Pro', startedAt: daysAgo(10), expiresAt: new Date(Date.now() + 20 * 86400000), source: 'demo' } : { planCode: 'basic', planName: 'Clinic Basic', source: 'default' },
      isPremium: i % 3 === 0
    });
    await setCreated(Clinic, c.id, daysAgo(170 - i * 15));
    clinics.push(c);
  }

  // Doctors
  const doctors = [];
  for (let i = 0; i < 25; i++) {
    const [state, code] = pick(states, i + 1);
    const status = pick(statuses, i);
    const clinic = pick(clinics, i);
    const d = await Doctor.create({
      id: `demo-doc-${i + 1}`, name: `Dr. ${pick(firstNames, i)} ${pick(lastNames, i * 3)}`,
      title: `Consultant ${pick(specs, i)}`, qualifications: pick(['MBBS, MD', 'MBBS, MS', 'MBBS, DNB', 'MBBS'], i),
      experienceYears: 3 + (i % 20), sector: i % 5 === 0 ? 'Government' : 'Private', specialities: [pick(specs, i)],
      clinics: [{ clinicId: clinic.id, clinicName: clinic.name, address: clinic.address, isApproved: true }],
      phone: `+91 90000 2${String(i).padStart(4, '0')}`, email: `doctor${i + 1}@demo.test`, consultationFee: 400 + (i % 6) * 100,
      state, stateCode: code, gstin: i % 7 === 0 ? `${code}AAAPL${String(2000 + i).padStart(4, '0')}F1Z${i % 9}` : '',
      status, isVerified: status === 'active' || status === 'suspended', isPremium: i % 4 === 0,
      statusReason: status === 'suspended' ? 'Repeated no-shows reported by patients' : status === 'rejected' ? 'Medical council registration number could not be verified' : '',
      claimPendingFee: status === 'active' ? 1500 + i * 220 : 0,
      photo: '', bio: 'Demo profile for testing. Experienced consultant focused on evidence-based, patient-friendly care.',
      registrationNumber: `TCMC-${40000 + i}`, councilName: 'Travancore-Cochin Medical Council', languages: ['English', pick(['Malayalam', 'Hindi', 'Tamil', 'Kannada'], i)],
      gender: i % 2 ? 'female' : 'male', slug: `demo-doctor-${i + 1}`,
      subscription: i % 4 === 0 ? { planCode: i % 8 === 0 ? 'premium' : 'pro', planName: i % 8 === 0 ? 'Doctor Premium' : 'Doctor Pro', startedAt: daysAgo(5), expiresAt: new Date(Date.now() + 25 * 86400000), source: 'demo' } : { planCode: 'basic', planName: 'Doctor Basic', source: 'default' }
    });
    const cityName = clinic.addressDetails.city;
    const [clat, clng] = CITY[cityName];
    const locs = [{
      id: `demo-loc-${i + 1}-c`, kind: 'clinic', name: clinic.name, clinicId: clinic.id, managedBy: 'clinic', speciality: pick(specs, i), phone: clinic.phone,
      address: clinic.addressDetails, location: clinic.location, schedule: wide, fee: d.consultationFee,
      bookingMode: clinic.subscription.planCode === 'pro' ? pick(['paid', 'token'], i) : 'free', tokenAmount: 100, autoConfirm: true, isActive: true
    }];
    if (d.isPremium) {
      locs.push({ id: `demo-loc-${i + 1}-o`, kind: 'own_clinic', name: `${d.name.replace('Dr. ', '')} Family Clinic`, managedBy: 'doctor', address: { line: `${20 + i} Temple Road`, area: 'West', city: cityName, district: CITY[cityName][2], state: clinic.addressDetails.state, pincode: `${CITY[cityName][3]}${String(30 + i).padStart(2, '0')}` }, location: toPoint(clat + 0.02 + i * 0.001, clng - 0.015), schedule: wide, fee: d.consultationFee + 100, bookingMode: 'paid', autoConfirm: i % 8 !== 0, isActive: true });
      locs.push({ id: `demo-loc-${i + 1}-t`, kind: 'online', name: 'Online video consultation', managedBy: 'doctor', schedule: wide, fee: d.consultationFee, bookingMode: 'token', tokenAmount: 150, autoConfirm: true, isActive: true });
    } else if (i % 3 === 1) {
      locs.push({ id: `demo-loc-${i + 1}-h`, kind: 'home_visit', name: 'Home visit', managedBy: 'doctor', address: { city: cityName, state: clinic.addressDetails.state, area: 'Within 8 km' }, location: toPoint(clat + 0.01, clng + 0.01), serviceRadiusKm: 8, schedule: { ...wide, sessions: [{ start: '16:00', end: '20:00' }], slotMinutes: 60 }, fee: d.consultationFee + 300, bookingMode: 'free', autoConfirm: false, isActive: true });
    }
    d.consultationLocations = locs;
    d.location = locs[0].location;
    await d.save();
    if (['active', 'suspended'].includes(status)) {
      clinic.doctorIds.push(d.id);
      clinic.doctorAssignments.push({ doctorId: d.id, speciality: pick(specs, i), addedAt: daysAgo(30), source: 'demo' });
      await clinic.save();
    }
    await setCreated(Doctor, d.id, daysAgo(175 - i * 7));
    doctors.push(d);
  }

  // Patients
  const patients = [];
  for (let i = 0; i < 40; i++) {
    const [state, code] = pick(states, i % 7 === 0 ? 1 : 0);
    const u = await User.create({
      id: `demo-user-${i + 1}`, phone: `+91 90000 3${String(i).padStart(4, '0')}`, name: `${pick(firstNames, i + 5)} ${pick(lastNames, i)}`,
      email: `patient${i + 1}@demo.test`, role: 'patient', isVerified: true, state, stateCode: code,
      status: i === 3 ? 'suspended' : i === 9 ? 'deleted' : 'active', statusReason: i === 3 ? 'Abusive messages sent to doctors' : '',
      gender: i % 2 ? 'female' : 'male', dob: new Date(1960 + (i % 40), i % 12, 1 + (i % 27)),
      familyMembers: i < 5 ? [{ id: `demo-fm-${i}-1`, name: `${pick(firstNames, i + 2)} ${pick(lastNames, i)}`, relation: 'Child', dob: new Date(2015, 3, 3), gender: 'female' }, { id: `demo-fm-${i}-2`, name: `${pick(firstNames, i + 7)} ${pick(lastNames, i)}`, relation: 'Parent', dob: new Date(1955, 5, 5), gender: 'male' }] : []
    });
    await setCreated(User, u.id, daysAgo(180 - i * 4));
    patients.push(u);
  }

  // Reviews (some with bad words in English / Hindi / Malayalam transliteration)
  const comments = [
    [5, 'Excellent doctor, explained everything patiently.'], [4, 'Good experience, short waiting time.'], [2, 'Waited 2 hours, not happy with the service.'],
    [1, 'This doctor is a total idiot, worst experience.'], [5, 'Very caring, highly recommend!'], [3, 'Average consultation, okay.'],
    [1, 'Bloody chutiya clinic, looted me.'], [2, 'Staff was rude and the bill was high.'], [1, 'Myre doctor, never again.'],
    [4, 'Helpful and knowledgeable.'], [1, 'What a f*cking waste of money'], [5, 'Saved my child, thank you doctor!'],
    [3, 'Doctor was fine but clinic was crowded.'], [1, 'Thayoli mone, fraud doctor'], [5, 'Best pediatrician in town.']
  ];
  const activeDocs = doctors.filter(d => d.status === 'active');
  for (let i = 0; i < 30; i++) {
    const [rating, comment] = pick(comments, i);
    const p = pick(patients, i);
    const screen = screenReviewText(comment, settings);
    const r = await Review.create({
      id: `demo-rev-${i + 1}`, doctorId: pick(activeDocs, i).id, userName: p.name, userPhone: p.phone, isVerifiedBooking: i % 2 === 0,
      rating, comment, ...screen, sentiment: screen.isFlagged ? 'flagged' : rating >= 4 ? 'positive' : rating === 3 ? 'neutral' : 'negative',
      moderationStatus: screen.isFlagged ? 'flagged' : 'visible'
    });
    await setCreated(Review, r.id, daysAgo(60 - i * 2));
  }
  for (const d of activeDocs) await recalcDoctorRating(d.id);

  // Ledger: subscriptions + booking fees over ~6 months, inserted in date order (sequential invoices)
  const events = [];
  doctors.filter(d => d.isPremium || d.status === 'active').slice(0, 10).forEach((d, i) => events.push({ kind: 'dsub', d, at: daysAgo(160 - i * 15), plan: i % 3 === 0 ? 'annual' : 'monthly' }));
  clinics.filter(c => c.status === 'active').forEach((c, i) => events.push({ kind: 'csub', c, at: daysAgo(150 - i * 20), plan: i % 2 ? 'annual' : 'monthly' }));
  for (let i = 0; i < 45; i++) events.push({ kind: 'fee', d: pick(activeDocs, i), p: pick(patients, i), at: daysAgo(150 - i * 3.3) });
  events.sort((a, b) => a.at - b.at);
  for (const [n, e] of events.entries()) {
    if (e.kind === 'dsub') {
      await recordLedgerTransaction({ type: 'subscription', category: 'doctor_subscription', partyType: 'doctor', partyId: e.d.id, partyName: e.d.name, partyPhone: e.d.phone, partyGstin: e.d.gstin, partyStateCode: e.d.stateCode, amount: e.plan === 'annual' ? 9999 : 999, plan: e.plan, description: `Doctor PRO subscription (${e.plan})`, txnDate: e.at, paymentReference: `pay_demo${n}` }, settings);
    } else if (e.kind === 'csub') {
      await recordLedgerTransaction({ type: 'subscription', category: 'clinic_subscription', partyType: 'clinic', partyId: e.c.id, partyName: e.c.name, partyPhone: e.c.phone, partyGstin: e.c.gstin, partyStateCode: e.c.stateCode, amount: e.plan === 'annual' ? 24999 : 2499, plan: e.plan, description: `Clinic PRO subscription (${e.plan})`, txnDate: e.at, paymentReference: `pay_demo${n}` }, settings);
    } else {
      const bookingId = `demo-book-${n}`;
      const loc = e.d.consultationLocations[0];
      const date = new Date(e.at.getTime() + 330 * 60000).toISOString().slice(0, 10);
      await Booking.create({ id: bookingId, bookingCode: `FAD-D${n}`, doctorId: e.d.id, doctorName: e.d.name, clinicId: loc.clinicId, clinicName: loc.name, locationId: loc.id, locationKind: loc.kind, locationName: loc.name, patientUserId: e.p.id, patientName: e.p.name, patientPhone: e.p.phone, date, timeSlot: '11:00', slotStart: istInstant(date, '11:00'), source: 'online', bookingMode: 'paid', fee: e.d.consultationFee, bookingPremiumFee: 49, totalAmount: e.d.consultationFee + 49, amountPayableOnline: e.d.consultationFee + 49, amountPaidOnline: e.d.consultationFee + 49, amountDueAtClinic: 0, payeeType: 'clinic', payeeId: loc.clinicId, paymentStatus: 'paid', status: n % 9 === 0 ? 'NoShow' : 'Completed', invoiceNumber: '' });
      await setCreated(Booking, bookingId, e.at);
      await recordLedgerTransaction({ type: 'patient_fee', category: 'booking_fee', partyType: 'patient', partyId: e.p.id, partyName: e.p.name, partyPhone: e.p.phone, partyStateCode: e.p.stateCode, amount: 49, passThroughAmount: e.d.consultationFee, bookingId, doctorId: e.d.id, description: `Booking FAD-D${n} with ${e.d.name}`, txnDate: e.at, paymentReference: `pay_demo${n}` }, settings);
    }
  }

  // Payout requests in all states (balances adjusted consistently)
  const payoutPlan = [['Pending', 0], ['Pending', 1], ['Approved', 2], ['Paid', 3], ['Rejected', 4], ['Pending', 5], ['Paid', 6]];
  for (const [i, [status, k]] of payoutPlan.entries()) {
    const isClinic = i % 3 === 2;
    const ent = isClinic ? clinics.filter(c => c.status === 'active')[k % 6] : activeDocs[k];
    const amount = 500 + i * 250;
    const at = daysAgo(20 - i * 2);
    ent.claimPendingFee = Math.max(0, (ent.claimPendingFee || 0) - (status === 'Rejected' ? 0 : amount));
    if (['Pending', 'Approved'].includes(status)) ent.payoutPendingFee = (ent.payoutPendingFee || 0) + amount;
    if (status === 'Paid') ent.claimedFee = (ent.claimedFee || 0) + amount;
    await ent.save();
    await PayoutRequest.create({
      id: `demo-pay-${i + 1}`, referenceCode: `PR-DEMO${i + 1}`, entityType: isClinic ? 'clinic' : 'doctor', entityId: ent.id, entityName: ent.name, entityPhone: ent.phone,
      amount, status, bankDetails: 'HDFC • A/C XXXX12' + i + ' • IFSC HDFC0000123', requestedAt: at,
      approvedAt: ['Approved', 'Paid'].includes(status) ? at : null, paidAt: status === 'Paid' ? at : null, paymentReference: status === 'Paid' ? `UTR2026DEMO${i}` : '',
      rejectedAt: status === 'Rejected' ? at : null, rejectionReason: status === 'Rejected' ? 'Bank account name mismatch' : ''
    });
    await PayoutRequest.collection.updateOne({ id: `demo-pay-${i + 1}` }, { $set: { createdAt: at } });
  }
  // A few upcoming pay-at-clinic bookings so the doctor / clinic panels have data today & tomorrow
  const today = todayIST();
  for (let k = 0; k < 6; k++) {
    const d = activeDocs[k % activeDocs.length];
    const loc = d.consultationLocations[0];
    const p = patients[k + 10];
    const date = addDays(today, k % 2 ? 1 : 2);
    const time = `${String(9 + k).padStart(2, '0')}:00`;
    await Booking.create({ id: `demo-up-${k}`, bookingCode: `FAD-U${k}`, doctorId: d.id, doctorName: d.name, clinicId: loc.clinicId, clinicName: loc.name, locationId: loc.id, locationKind: loc.kind, locationName: loc.name, patientUserId: p.id, patientName: p.name, patientPhone: p.phone, date, timeSlot: time, slotStart: istInstant(date, time), slotLock: `${d.id}|${date}|${time}`, source: 'online', bookingMode: 'free', fee: loc.fee, bookingPremiumFee: 0, totalAmount: loc.fee, amountDueAtClinic: loc.fee, payeeType: 'clinic', payeeId: loc.clinicId, paymentStatus: 'pay_at_clinic', isPaid: false, status: k % 3 === 0 ? 'Pending' : 'Confirmed', invoiceNumber: '' });
  }
  console.log(`Seeded demo data: ${clinics.length} clinics, ${doctors.length} doctors, ${patients.length} patients, 30 reviews, ${events.length} ledger transactions, ${payoutPlan.length} payout requests.`);
}

await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
try {
  if (args.has('--clean')) await clean(); else await seed();
} finally {
  await mongoose.disconnect();
}
