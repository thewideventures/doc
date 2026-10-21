// One-tap signed links for reschedule / cancel (sent in reminders). Token = base64url(payload).hmac
// payload: { b: bookingId, v: linkVersion, e: expiry (unix seconds) }. Bumping booking.linkVersion (reschedule,
// cancel) invalidates every earlier link. The secret is BOOKING_LINK_SECRET or derived from USER_JWT_SECRET.
import crypto from 'crypto';
import { config } from './config.js';

const b64 = buf => Buffer.from(buf).toString('base64url');
const mac = data => crypto.createHmac('sha256', config.bookingLinkSecret).update(`booking-link:${data}`).digest('base64url');

export function signBookingLink(b, { ttlSeconds } = {}) {
  const slot = b.slotStart ? new Date(b.slotStart).getTime() : Date.now();
  const exp = Math.floor((ttlSeconds ? Date.now() + ttlSeconds * 1000 : Math.min(slot + 2 * 3600000, Date.now() + 45 * 86400000)) / 1000);
  const data = b64(JSON.stringify({ b: b.id, v: b.linkVersion || 0, e: exp }));
  return `${data}.${mac(data)}`;
}

export function verifyBookingLink(token) {
  const [data, sig] = String(token || '').split('.');
  if (!data || !sig || data.length > 300) return null;
  const expected = mac(data);
  const a = Buffer.from(sig), e = Buffer.from(expected);
  if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || typeof p.b !== 'string' || typeof p.v !== 'number' || typeof p.e !== 'number') return null;
  if (p.e * 1000 < Date.now()) return { expired: true, bookingId: p.b };
  return { bookingId: p.b, version: p.v };
}

export const bookingLinkUrl = b => `${config.appBaseUrl}/appointment/${signBookingLink(b)}`;
