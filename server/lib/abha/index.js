// ABHA (Ayushman Bharat Health Account) linking — OPTIONAL, never required for any FindADoc feature.
// ABHA_PROVIDER = sandbox (ABDM sandbox adapter stub) | disabled (default) | mock (development only).
// Flow: init(abhaNumber | abhaAddress) -> OTP sent by ABDM to the ABHA-linked mobile -> confirm(txnId, otp).
// The sandbox adapter follows the ABDM v3 "profile login" APIs. ABDM requires loginId / OTP to be RSA-OAEP
// encrypted with its public key: set ABDM_PUBLIC_KEY (PEM) — without it values are sent as-is (sandbox stub only).
import crypto from 'crypto';
import { config } from '../config.js';

const fail = (status, message, code) => Object.assign(new Error(message), { status, code });
export const ABHA_NUMBER = /^\d{2}-?\d{4}-?\d{4}-?\d{4}$/;
export const ABHA_ADDRESS = /^[a-z0-9][a-z0-9._]{2,31}@(sbx|abdm)$/i;
export const formatAbhaNumber = n => { const d = String(n).replace(/\D/g, ''); return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6, 10)}-${d.slice(10, 14)}`; };

function encrypt(value) {
  const pem = config.abha.publicKey;
  if (!pem) return value;
  return crypto.publicEncrypt({ key: pem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(String(value))).toString('base64');
}

async function call(url, { body, token, headers = {} }) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10000);
  try {
    const r = await fetch(url, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'REQUEST-ID': crypto.randomUUID(), TIMESTAMP: new Date().toISOString(), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw fail(r.status === 401 || r.status === 400 ? 400 : 502, r.status === 400 || r.status === 401 ? 'ABHA verification failed. Check the details / OTP and try again.' : 'ABHA service is unavailable right now. Please try later.', 'ABHA_PROVIDER_ERROR');
    return data;
  } catch (e) {
    if (e.status) throw e;
    throw fail(502, 'ABHA service is unavailable right now. Please try later.', 'ABHA_UNAVAILABLE');
  } finally { clearTimeout(t); }
}

let cachedToken = null;
async function gatewayToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 30000) return cachedToken.value;
  const out = await call(`${config.abha.baseUrl}/api/hiecm/gateway/v3/sessions`, { body: { clientId: config.abha.clientId, clientSecret: config.abha.clientSecret, grantType: 'client_credentials' }, headers: { 'X-CM-ID': 'sbx' } });
  if (!out.accessToken) throw fail(502, 'ABHA service is unavailable right now. Please try later.', 'ABHA_UNAVAILABLE');
  cachedToken = { value: out.accessToken, exp: Date.now() + (Number(out.expiresIn) || 600) * 1000 };
  return cachedToken.value;
}

const providers = {
  sandbox: {
    async init({ abhaNumber, abhaAddress }) {
      const token = await gatewayToken();
      const out = await call(`${config.abha.abhaBaseUrl}/abha/api/v3/profile/login/request/otp`, {
        token,
        body: { scope: ['abha-login', 'aadhaar-verify'], loginHint: abhaNumber ? 'abha-number' : 'abha-address', loginId: encrypt(abhaNumber ? abhaNumber.replace(/-/g, '') : abhaAddress), otpSystem: 'aadhaar' }
      });
      if (!out.txnId) throw fail(502, 'ABHA service did not start the verification', 'ABHA_UNAVAILABLE');
      return { providerTxnId: out.txnId, message: out.message || 'OTP sent to the mobile number linked with your ABHA' };
    },
    async confirm({ providerTxnId, otp }) {
      const token = await gatewayToken();
      const out = await call(`${config.abha.abhaBaseUrl}/abha/api/v3/profile/login/verify`, {
        token, body: { scope: ['abha-login', 'aadhaar-verify'], authData: { authMethods: ['otp'], otp: { txnId: providerTxnId, otpValue: encrypt(otp) } } }
      });
      const acc = out.accounts?.[0] || {};
      const number = acc.ABHANumber || out.ABHANumber || '';
      if (!number) throw fail(400, 'ABHA verification failed. Check the OTP and try again.', 'ABHA_VERIFY_FAILED');
      return { abhaNumber: formatAbhaNumber(number), abhaAddress: acc.preferredAbhaAddress || out.preferredAbhaAddress || '' };
    }
  },
  // Development only (refused in production by config.js): OTP is always 123456
  mock: {
    async init() {
      if (config.isProd) throw fail(503, 'ABHA linking is not available', 'ABHA_DISABLED');
      return { providerTxnId: `mock-${crypto.randomBytes(6).toString('hex')}`, message: 'DEV MOCK: use OTP 123456' };
    },
    async confirm({ otp, abhaNumber, abhaAddress }) {
      if (config.isProd) throw fail(503, 'ABHA linking is not available', 'ABHA_DISABLED');
      if (otp !== '123456') throw fail(400, 'Incorrect OTP', 'ABHA_VERIFY_FAILED');
      return { abhaNumber: abhaNumber ? formatAbhaNumber(abhaNumber) : '91-0000-0000-0000', abhaAddress: abhaAddress || 'demo.patient@sbx' };
    }
  }
};

export function abhaProvider() {
  const p = providers[config.abha.provider];
  if (!p) throw fail(503, 'ABHA linking is not enabled on this server. It is optional — you can keep using FindADoc without it.', 'ABHA_DISABLED');
  return p;
}
export const abhaEnabled = () => Boolean(providers[config.abha.provider]);
