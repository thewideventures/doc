// OTP challenges stored in MongoDB: HMAC-hashed code, 5-minute expiry, max 5 wrong attempts then a lock,
// resend cooldown and per-phone send quota. Demo code 123456 only when config.otp.demo (never in production).
import crypto from 'crypto';
import { OtpChallenge } from '../models/index.js';
import { config } from './config.js';
import { sendOtpSms } from './sms/index.js';

export const OTP_POLICY = { ttlMs: 5 * 60 * 1000, maxAttempts: 5, lockMs: 15 * 60 * 1000, cooldownMs: 30 * 1000, maxSendsPerHour: 6 };
const pepper = crypto.createHmac('sha256', config.userJwtSecret).update('otp-pepper').digest();
const hashCode = (digits, code) => crypto.createHmac('sha256', pepper).update(`${digits}:${code}`).digest('hex');
const err = (status, code, message, extra = {}) => Object.assign(new Error(message), { status, code, ...extra });

function lockedError(until) {
  const mins = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60000));
  return err(429, 'OTP_LOCKED', `Too many wrong attempts. Try again in ${mins} minute(s).`, { retryAfter: mins * 60 });
}

/** Issue + deliver a new OTP. Returns { demo: boolean, cooldownSec }. */
export async function issueOtp(digits) {
  const now = new Date();
  let ch = await OtpChallenge.findOne({ phone: digits });
  if (ch?.lockedUntil && ch.lockedUntil > now) throw lockedError(ch.lockedUntil);
  if (ch?.lastSentAt && now - ch.lastSentAt < OTP_POLICY.cooldownMs) {
    const wait = Math.ceil((OTP_POLICY.cooldownMs - (now - ch.lastSentAt)) / 1000);
    throw err(429, 'OTP_COOLDOWN', `Please wait ${wait} seconds before requesting another OTP.`, { retryAfter: wait });
  }
  if (!ch) ch = new OtpChallenge({ phone: digits });
  if (!ch.sendWindowStart || now - ch.sendWindowStart > 3600000) { ch.sendWindowStart = now; ch.sendCount = 0; }
  if (ch.sendCount >= OTP_POLICY.maxSendsPerHour) throw err(429, 'RATE_LIMITED', 'Too many OTP requests for this number. Please try again in an hour.', { retryAfter: 3600 });

  const code = config.otp.demo ? config.otp.demoCode : String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  ch.codeHash = hashCode(digits, code);
  ch.expiresAt = new Date(now.getTime() + OTP_POLICY.ttlMs);
  ch.attempts = 0;
  ch.lastSentAt = now;
  ch.sendCount += 1;
  ch.lockedUntil = null;
  ch.purgeAt = new Date(now.getTime() + 24 * 3600000);
  await ch.save();
  if (!config.otp.demo) {
    try { await sendOtpSms(digits, code); }
    catch (e) { await OtpChallenge.updateOne({ phone: digits }, { $set: { codeHash: '', expiresAt: null, lastSentAt: null }, $inc: { sendCount: -1 } }); throw e; }
  }
  return { demo: config.otp.demo, cooldownSec: OTP_POLICY.cooldownMs / 1000, expiresInSec: OTP_POLICY.ttlMs / 1000 };
}

/** Verify (single use). Throws 400 OTP_INVALID / OTP_EXPIRED, 429 OTP_LOCKED. */
export async function verifyOtp(digits, otp) {
  const code = String(otp ?? '').trim();
  if (!/^\d{6}$/.test(code)) throw err(400, 'OTP_INVALID', 'Enter the 6-digit OTP');
  const now = new Date();
  const ch = await OtpChallenge.findOne({ phone: digits });
  if (ch?.lockedUntil && ch.lockedUntil > now) throw lockedError(ch.lockedUntil);
  if (!ch || !ch.codeHash || !ch.expiresAt || ch.expiresAt < now) throw err(400, 'OTP_EXPIRED', 'OTP expired. Please request a new one.');
  // count the attempt atomically before comparing (parallel guesses cannot exceed the limit)
  const counted = await OtpChallenge.findOneAndUpdate({ phone: digits, codeHash: ch.codeHash, attempts: { $lt: OTP_POLICY.maxAttempts } }, { $inc: { attempts: 1 } }, { returnDocument: 'after' });
  if (!counted) {
    await OtpChallenge.updateOne({ phone: digits }, { $set: { lockedUntil: new Date(now.getTime() + OTP_POLICY.lockMs), codeHash: '', expiresAt: null } });
    throw lockedError(new Date(now.getTime() + OTP_POLICY.lockMs));
  }
  const a = Buffer.from(counted.codeHash, 'hex');
  const b = Buffer.from(hashCode(digits, code), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    if (counted.attempts >= OTP_POLICY.maxAttempts) {
      await OtpChallenge.updateOne({ phone: digits }, { $set: { lockedUntil: new Date(now.getTime() + OTP_POLICY.lockMs), codeHash: '', expiresAt: null } });
      throw lockedError(new Date(now.getTime() + OTP_POLICY.lockMs));
    }
    throw err(400, 'OTP_INVALID', `Incorrect OTP. ${OTP_POLICY.maxAttempts - counted.attempts} attempt(s) left.`);
  }
  // single use: consume only if still the same code (prevents a parallel second success)
  const used = await OtpChallenge.updateOne({ phone: digits, codeHash: counted.codeHash }, { $set: { codeHash: '', expiresAt: null, attempts: 0, sendCount: 0, lastSentAt: null } });
  if (!used.modifiedCount) throw err(400, 'OTP_EXPIRED', 'OTP already used. Please request a new one.');
  return true;
}
