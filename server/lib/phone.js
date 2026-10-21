// Indian mobile number helpers. Stored canonical form for new records: +91XXXXXXXXXX.
// Older records may contain spaces / no country code, so lookups match on the last 10 digits.
export function phoneDigits(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return d.slice(2);
  if (d.length === 11 && d.startsWith('0')) return d.slice(1);
  return d;
}

export function isValidMobile(p) {
  return /^[6-9]\d{9}$/.test(phoneDigits(p));
}

export function canonicalPhone(p) {
  const d = phoneDigits(p);
  return d.length === 10 ? `+91${d}` : String(p || '').trim();
}

/** Mongo condition matching any stored format of the same number. */
export function phoneMatch(p) {
  const d = phoneDigits(p);
  if (d.length !== 10) return { $in: [String(p || '').trim()] };
  return { $regex: new RegExp(`(^|\\D)(\\+?91)?\\D*${d.split('').join('\\D*')}$`) };
}

export async function findByPhone(Model, p, extra = {}) {
  const d = phoneDigits(p);
  const exact = [String(p || '').trim(), d, `+91${d}`, `+91 ${d}`, `+91 ${d.slice(0, 5)} ${d.slice(5)}`];
  return (await Model.findOne({ phone: { $in: exact }, ...extra })) || (d.length === 10 ? Model.findOne({ phone: phoneMatch(d), ...extra }) : null);
}

export function maskPhone(p) {
  const d = phoneDigits(p);
  return d.length === 10 ? `+91 ${d.slice(0, 2)}XXXXXX${d.slice(8)}` : '';
}
