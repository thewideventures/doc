import { Settings } from '../models/index.js';
import { STATE_CODES } from './gst.js';

// Defaults may be seeded from env (see .env.example) — DB settings win once saved.
function envDefaults() {
  const code = (process.env.BUSINESS_STATE_CODE || '32').padStart(2, '0');
  return {
    key: 'global',
    businessName: process.env.BUSINESS_NAME || 'FindADoc',
    businessGstin: process.env.BUSINESS_GSTIN || '',
    businessStateCode: code,
    businessState: STATE_CODES[code] || '',
    gstRate: Number(process.env.GST_RATE || 18),
    sacCode: process.env.DEFAULT_SAC_CODE || '998399',
    invoicePrefix: process.env.INVOICE_PREFIX || 'FAD'
  };
}

let memo = null;
let memoAt = 0;

export async function getSettings({ fresh = false } = {}) {
  if (!fresh && memo && Date.now() - memoAt < 10_000) return memo;
  let s = await Settings.findOne({ key: 'global' }).lean();
  if (!s) {
    try {
      s = (await Settings.create(envDefaults())).toObject();
    } catch (e) {
      s = await Settings.findOne({ key: 'global' }).lean(); // race: created concurrently
    }
  }
  memo = s;
  memoAt = Date.now();
  return s;
}

export function invalidateSettings() {
  memo = null;
}
