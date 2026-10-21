// WhatsApp provider abstraction. WHATSAPP_PROVIDER = meta | gupshup | msg91 | disabled | console (dev only).
// All providers send pre-approved TEMPLATE messages (required by WhatsApp for business-initiated messages).
// Template name per message kind: WHATSAPP_TEMPLATES JSON override, default "fad_<kind>"; language = user language.
import { config } from '../config.js';
import log, { maskPhone } from '../logger.js';
import { orderedParams } from './templates.js';

const TIMEOUT = 10000;
async function postJson(url, headers, body, form = false) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { method: 'POST', headers, body: form ? body : JSON.stringify(body), signal: ctl.signal });
    const text = await r.text();
    if (!r.ok) throw Object.assign(new Error(`WhatsApp provider HTTP ${r.status}`), { detail: text.slice(0, 200) });
    try { return JSON.parse(text); } catch { return {}; }
  } finally { clearTimeout(t); }
}

const templateName = kind => config.whatsapp.templates[kind] || `fad_${kind}`;
const LANG = { en: 'en', ml: 'ml', hi: 'hi' };

const providers = {
  // Meta WhatsApp Cloud API
  async meta({ phone, kind, lang, params }) {
    const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${encodeURIComponent(process.env.META_WA_PHONE_NUMBER_ID)}/messages`;
    const out = await postJson(url, { Authorization: `Bearer ${process.env.META_WA_TOKEN}`, 'Content-Type': 'application/json' }, {
      messaging_product: 'whatsapp', to: `91${phone}`, type: 'template',
      template: { name: templateName(kind), language: { code: LANG[lang] || 'en' }, components: [{ type: 'body', parameters: orderedParams(kind, params).map(text => ({ type: 'text', text })) }] }
    });
    return out?.messages?.[0]?.id || '';
  },
  // Gupshup template API
  async gupshup({ phone, kind, params }) {
    const form = new URLSearchParams({
      channel: 'whatsapp', source: process.env.GUPSHUP_SOURCE, destination: `91${phone}`,
      'src.name': process.env.GUPSHUP_APP_NAME || 'FindADoc',
      template: JSON.stringify({ id: templateName(kind), params: orderedParams(kind, params) })
    });
    const out = await postJson('https://api.gupshup.io/wa/api/v1/template/msg', { apikey: process.env.GUPSHUP_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded' }, form.toString(), true);
    return out?.messageId || '';
  },
  // MSG91 WhatsApp outbound (bulk endpoint, one recipient)
  async msg91({ phone, kind, lang, params }) {
    const components = {};
    orderedParams(kind, params).forEach((v, i) => { components[`body_${i + 1}`] = { type: 'text', value: v }; });
    const out = await postJson('https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', { authkey: process.env.MSG91_AUTH_KEY, 'Content-Type': 'application/json', accept: 'application/json' }, {
      integrated_number: process.env.MSG91_WA_NUMBER, content_type: 'template',
      payload: { messaging_product: 'whatsapp', type: 'template', template: { name: templateName(kind), language: { code: LANG[lang] || 'en', policy: 'deterministic' }, to_and_components: [{ to: [`91${phone}`], components }] } }
    });
    return out?.request_id || '';
  },
  // Development only: log a one-line summary (phone masked). Refused in production by config.js.
  async console({ phone, kind, text }) {
    if (config.isProd) throw new Error('console WhatsApp provider is disabled in production');
    log.info(`[DEV WHATSAPP] ${kind} -> ${maskPhone(phone)}: ${text}`);
    return `console-${Date.now()}`;
  }
};

export function whatsappConfigured() { return Boolean(providers[config.whatsapp.provider]); }
export function whatsappProviderName() { return config.whatsapp.provider; }

export async function sendWhatsApp({ phone, kind, lang = 'en', params = {}, text = '' }) {
  const fn = providers[config.whatsapp.provider];
  if (!fn) throw Object.assign(new Error('WhatsApp is not configured'), { code: 'WA_NOT_CONFIGURED', permanent: true });
  try { return await fn({ phone, kind, lang, params, text }); }
  catch (e) {
    log.error('WhatsApp delivery failed', { provider: config.whatsapp.provider, phone: maskPhone(phone), kind, err: e.message });
    throw e;
  }
}
