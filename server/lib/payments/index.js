// Payment provider selection (see config.js):
//   PAYMENTS_MODE=razorpay (or Razorpay keys present) -> Razorpay
//   PAYMENTS_MODE=mock     -> mock provider, development only (refused in production)
//   otherwise              -> payments disabled: paid flows answer 503 "Payments not configured"
import { config } from '../config.js';
import { mockProvider } from './mock.js';
import { razorpayProvider } from './razorpay.js';

export function getPaymentProvider() {
  if (config.payments.mode === 'razorpay' && razorpayProvider.isConfigured()) return razorpayProvider;
  if (config.payments.mode === 'mock' && !config.isProd) return mockProvider;
  return null;
}

/** Provider for an existing order (only if it is the active one — a mock order can never be settled in Razorpay mode). */
export function getProviderByName(name) {
  const p = getPaymentProvider();
  return p && p.name === name ? p : null;
}

export function paymentsPublicConfig() {
  const p = getPaymentProvider();
  return p ? { enabled: true, ...p.publicConfig() } : { enabled: false, provider: 'none' };
}

export const paymentsNotConfigured = () => Object.assign(new Error('Payments not configured. Online payments are unavailable right now.'), { status: 503, code: 'PAYMENTS_NOT_CONFIGURED' });
