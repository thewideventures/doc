import mongoose from 'mongoose';
import {
  Speciality,
  Clinic,
  Doctor,
  User,
  Booking,
  Review,
  SpecialityRequest,
  Counter,
  deriveLegacyStatus
} from './models/index.js';
import {
  specialitiesData,
  clinicsData,
  doctorsData,
  reviewsData,
  bookingsData,
  specialityRequestsData,
  usersData
} from './data.js';
import { rescanReviews } from './lib/reviews.js';
import { getSettings } from './lib/settings.js';
import { runPlatformMigrations, runSecurityMigrations, runPhase4Migrations } from './lib/migrations.js';
import { config } from './lib/config.js';
import log from './lib/logger.js';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/findadoc';

// Never print the connection string (may contain credentials)
function describeUri(uri) {
  try {
    const u = new URL(uri);
    return `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`;
  } catch {
    return '(configured MongoDB)';
  }
}

export async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
    });
    console.log(`Connected successfully to MongoDB at ${describeUri(MONGODB_URI)}`);

    // Seed database if empty
    await seedDatabaseIfEmpty();
    await runAdminMigrations();
    try { await runPlatformMigrations(); } catch (err) { console.error('Platform migration error:', err.message); }
    try { for (const m of await runSecurityMigrations()) log.info(`Migration: ${m}`); } catch (err) { log.error('Security migration error', { err: err.message }); }
    try { for (const m of await runPhase4Migrations()) log.info(`Migration: ${m}`); } catch (err) { log.error('Phase-4 migration error', { err: err.message }); }
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    if (config.isProd) { log.error('Cannot start without MongoDB in production'); process.exit(1); }
    console.log('Falling back to local in-memory/embedded data persistence if MongoDB is temporarily unavailable');
  }
}

const withStatus = (rows, fallback) => rows.map(r => ({ ...r, status: r.status || deriveLegacyStatus(r, fallback), statusReason: r.statusReason || r.suspensionReason || '' }));

async function seedDatabaseIfEmpty() {
  try {
    const specCount = await Speciality.countDocuments();
    if (specCount === 0) {
      console.log('🌱 Seeding initial Specialities into MongoDB...');
      await Speciality.insertMany(specialitiesData);
    }

    const clinicCount = await Clinic.countDocuments();
    if (clinicCount === 0) {
      console.log('🌱 Seeding initial Clinics into MongoDB...');
      await Clinic.insertMany(withStatus(clinicsData, 'pending'));
    }

    const docCount = await Doctor.countDocuments();
    if (docCount === 0) {
      console.log('🌱 Seeding initial Doctors into MongoDB...');
      await Doctor.insertMany(withStatus(doctorsData, 'pending'));
    }

    const userCount = await User.countDocuments();
    if (userCount === 0) {
      console.log('🌱 Seeding initial Users into MongoDB...');
      await User.insertMany(withStatus(usersData, 'active'));
    }

    const reviewCount = await Review.countDocuments();
    if (reviewCount === 0) {
      console.log('🌱 Seeding initial Reviews into MongoDB...');
      await Review.insertMany(reviewsData.map(r => ({ ...r, moderationStatus: r.isFlagged ? 'flagged' : 'visible' })));
    }

    const bookingCount = await Booking.countDocuments();
    if (bookingCount === 0) {
      console.log('🌱 Seeding initial Bookings into MongoDB...');
      await Booking.insertMany(bookingsData);
    }

    const reqCount = await SpecialityRequest.countDocuments();
    if (reqCount === 0) {
      console.log('🌱 Seeding initial Speciality Requests into MongoDB...');
      await SpecialityRequest.insertMany(specialityRequestsData);
    }

    console.log('All MongoDB collections verified and seeded!');
  } catch (err) {
    console.error('Error seeding MongoDB collections:', err);
  }
}

// Idempotent migrations for the admin panel:
// 1) give legacy doctors / clinics / users an explicit `status`
//    (isSuspended -> suspended, isVerified -> active, else pending; users default active)
// 2) give legacy reviews a `moderationStatus` and backfill the bad-word screen (once)
async function backfillStatus(Model, fallback) {
  const rows = await Model.find({ $or: [{ status: { $exists: false } }, { status: null }] })
    .select('_id isSuspended isVerified suspensionReason').lean();
  if (!rows.length) return 0;
  await Model.bulkWrite(rows.map(r => ({
    updateOne: {
      filter: { _id: r._id },
      update: { $set: { status: deriveLegacyStatus(r, fallback), statusReason: r.isSuspended ? (r.suspensionReason || '') : '' } }
    }
  })));
  return rows.length;
}

async function runAdminMigrations() {
  try {
    const d = await backfillStatus(Doctor, 'pending');
    const c = await backfillStatus(Clinic, 'pending');
    const u = await backfillStatus(User, 'active');
    if (d || c || u) console.log(`🛠  Backfilled account status: ${d} doctors, ${c} clinics, ${u} users`);

    const flagged = await Review.updateMany({ moderationStatus: { $exists: false }, isFlagged: true }, { $set: { moderationStatus: 'flagged' } });
    const visible = await Review.updateMany({ moderationStatus: { $exists: false } }, { $set: { moderationStatus: 'visible' } });
    if (flagged.modifiedCount || visible.modifiedCount) console.log(`🛠  Backfilled review moderation status on ${flagged.modifiedCount + visible.modifiedCount} reviews`);

    await getSettings({ fresh: true }); // ensure settings document exists

    const done = await Counter.findOne({ key: 'migration:review-badword-backfill-v1' });
    if (!done) {
      const r = await rescanReviews({ unflagCleanAutoFlags: false });
      await Counter.updateOne({ key: 'migration:review-badword-backfill-v1' }, { $set: { seq: 1 } }, { upsert: true });
      console.log(`🛠  Bad-word backfill: scanned ${r.scanned} reviews, ${r.newlyFlagged} newly flagged`);
    }
  } catch (err) {
    console.error('Admin migration error:', err.message);
  }
}
