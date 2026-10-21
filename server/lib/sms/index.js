// SMS provider abstraction for OTP delivery. SMS_PROVIDER = msg91 | twilio | console (dev only).
import { config } from '../config.js';
import log, { maskPhone } from '../logger.js';

const TIMEOUT = 8000;
async function post(url, { headers = {}, body }) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { method: 'POST', headers, body, signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw Object.assign(new Error(`SMS provider HTTP ${r.status}`), { detail: text.slice(0, 200) });
    return text;
  } finally { clearTimeout(t); }
}

const providers = {
  // MSG91 Flow API (DLT-approved template with an ##otp## / {{otp}} variable)
  async msg91(digits, code) {
    await post('https://control.msg91.com/api/v5/flow', {
      headers: { authkey: process.env.MSG91_AUTH_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ template_id: process.env.MSG91_TEMPLATE_ID, short_url: '0', recipients: [{ mobiles: `91${digits}`, otp: code, [process.env.MSG91_OTP_VAR || 'otp']: code }] })
    });
  },
  async twilio(digits, code) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const form = new URLSearchParams({ To: `+91${digits}`, Body: `${code} is your FindADoc verification code. It expires in 5 minutes. Do not share it with anyone.` });
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
    else form.set('From', process.env.TWILIO_FROM);
    await post(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
  },
  // Development only: prints the code to the server console (refused in production by config.js)
  async console(digits, code) {
    if (config.isProd) throw new Error('console SMS provider is disabled in production');
    log.warn(`[DEV SMS] OTP for ${maskPhone(digits)}: ${code}`);
  }
};

export function smsConfigured() { return Boolean(providers[config.otp.provider]); }

export async function sendOtpSms(digits, code) {
  const fn = providers[config.otp.provider];
  if (!fn) throw Object.assign(new Error('SMS OTP is not configured on this server.'), { status: 503, code: 'SMS_NOT_CONFIGURED' });
  try { await fn(digits, code); }
  catch (e) {
    log.error('OTP SMS delivery failed', { provider: config.otp.provider, phone: maskPhone(digits), err: e.message });
    throw Object.assign(new Error('Could not send the OTP right now. Please try again in a minute.'), { status: 502, code: 'SMS_FAILED' });
  }
}

// ---------------------------------------------------------------- reminder / notification SMS
// Uses the same provider as OTP SMS (REMINDER_SMS=true to enable in production). In development without a
// provider, texts are printed to the console (phone masked). MSG91 needs a DLT template with a ##message## var.
const notifyProviders = {
  async msg91(digits, text) {
    await post('https://control.msg91.com/api/v5/flow', {
      headers: { authkey: process.env.MSG91_AUTH_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ template_id: process.env.MSG91_REMINDER_TEMPLATE_ID, short_url: '0', recipients: [{ mobiles: `91${digits}`, message: text.slice(0, 300) }] })
    });
  },
  async twilio(digits, text) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const form = new URLSearchParams({ To: `+91${digits}`, Body: text.slice(0, 600) });
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
    else form.set('From', process.env.TWILIO_FROM);
    await post(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      headers: { Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    });
  },
  async console(digits, text) {
    if (config.isProd) throw new Error('console SMS provider is disabled in production');
    log.info(`[DEV SMS] -> ${maskPhone(digits)}: ${text}`);
  }
};

export function reminderSmsConfigured() { return config.reminderSms.enabled && Boolean(notifyProviders[config.reminderSms.provider]); }

export async function sendNotificationSms(digits, text) {
  const fn = config.reminderSms.enabled ? notifyProviders[config.reminderSms.provider] : null;
  if (!fn) throw Object.assign(new Error('Reminder SMS is not configured'), { code: 'SMS_NOT_CONFIGURED', permanent: true });
  try { await fn(digits, text); }
  catch (e) {
    log.error('Reminder SMS failed', { provider: config.reminderSms.provider, phone: maskPhone(digits), err: e.message });
    throw e;
  }
}
