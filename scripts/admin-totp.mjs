// Usage: npm run admin:totp
// Generates a TOTP secret for ADMIN_TOTP_SECRET and an otpauth:// URI to add to Google Authenticator / 1Password / Authy.
import crypto from 'node:crypto';
import { base32Encode } from '../server/lib/totp.js';

const secret = base32Encode(crypto.randomBytes(20));
const label = encodeURIComponent(`FindADoc Admin:${process.env.ADMIN_USERNAME || 'admin'}`);
console.log(`ADMIN_TOTP_SECRET=${secret}`);
console.log(`\notpauth URI (paste into your authenticator, or turn into a QR code locally):\notpauth://totp/${label}?secret=${secret}&issuer=FindADoc&algorithm=SHA1&digits=6&period=30`);
console.log('\nAfter adding ADMIN_TOTP_SECRET to .env and restarting, the admin login asks for the 6-digit code.');
