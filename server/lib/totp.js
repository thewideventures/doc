// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — compatible with Google Authenticator / Authy / 1Password.
import crypto from 'crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Decode(s) {
  const clean = String(s || '').replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function hotp(key, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1e6).padStart(6, '0');
}

export const totpStep = (t = Date.now()) => Math.floor(t / 30000);
export const totpNow = (secret, t = Date.now()) => hotp(base32Decode(secret), totpStep(t));

/** Returns the matched time step (window ±1) or 0 when invalid. */
export function verifyTotp(secret, code, t = Date.now()) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c)) return 0;
  const key = base32Decode(secret);
  const step = totpStep(t);
  for (const s of [step, step - 1, step + 1]) {
    const a = Buffer.from(hotp(key, s)); const b = Buffer.from(c);
    if (crypto.timingSafeEqual(a, b)) return s;
  }
  return 0;
}
