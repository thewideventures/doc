// Minimal structured logger. One JSON line per event in production, readable lines in development.
// Redacts secrets / tokens / OTPs and masks phone numbers so logs never carry credentials or raw PII.
import { config } from './config.js';

const SECRET_KEY = /pass(word)?|secret|token|otp|authorization|cookie|signature|hash|key_secret|api[-_]?key/i;
const PHONE = /(\+?91[\s-]?)?([6-9]\d{4})[\s-]?(\d{5})\b/g;

export function maskPhone(v) {
  const d = String(v || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `+91 ${d.slice(0, 2)}xxxxxx${d.slice(-2)}` : '';
}

function scrub(v, depth = 0) {
  if (v == null || depth > 4) return v;
  if (typeof v === 'string') return v.replace(PHONE, (m, p, a, b) => `${p || ''}${a.slice(0, 2)}xxxxxx${b.slice(-2)}`).slice(0, 2000);
  if (v instanceof Error) return { message: scrub(v.message), name: v.name, ...(config.isProd ? {} : { stack: v.stack?.split('\n').slice(0, 4).join(' | ') }) };
  if (Array.isArray(v)) return v.slice(0, 20).map(x => scrub(x, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = SECRET_KEY.test(k) ? '[redacted]' : scrub(x, depth + 1);
    return o;
  }
  return v;
}

function emit(level, msg, meta) {
  const rec = { t: new Date().toISOString(), level, msg: scrub(String(msg)), ...(meta ? scrub(meta) : {}) };
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (config.isProd) out(JSON.stringify(rec));
  else if (!config.isTest || level === 'error' || process.env.LOG_TESTS === 'true') out(`[${level}] ${rec.msg}${meta ? ' ' + JSON.stringify(scrub(meta)) : ''}`);
}

export const log = {
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta)
};
export default log;
