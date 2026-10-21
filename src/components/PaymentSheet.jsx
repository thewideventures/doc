import React, { useState } from 'react';
import { CreditCard, Loader2, ShieldCheck, X, FlaskConical } from 'lucide-react';
import { inr } from '../lib/api';

let rzpPromise = null;
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (rzpPromise) return rzpPromise;
  rzpPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.async = true;
    s.onload = () => resolve(window.Razorpay);
    s.onerror = () => { rzpPromise = null; reject(new Error('Could not load Razorpay checkout. Check your connection.')); };
    document.body.appendChild(s);
  });
  return rzpPromise;
}


/**
 * Pay for a server-created PaymentOrder.
 * payment: { orderId, providerOrderId, amount, currency, provider: 'mock'|'razorpay', keyId? }
 * Calls POST /payments/verify on success, /payments/fail on cancel.
 */
export default function PaymentSheet({ payment, client, title = 'Complete payment', description, breakdown = [], prefill = {}, onSuccess, onCancel }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!payment) return null;

  const verify = async (paymentId, signature = '') => {
    const r = await client.post('/payments/verify', { orderId: payment.orderId, paymentId, signature });
    onSuccess?.(r);
  };
  const cancel = async (reason = 'Payment cancelled by user') => {
    setBusy(true);
    try { await client.post('/payments/fail', { orderId: payment.orderId, reason }); } catch { /* order may already be expired */ }
    setBusy(false);
    onCancel?.();
  };

  // DEV ONLY (PAYMENTS_MODE=mock): the server simulates the checkout and signs a test payment
  const payMock = async () => {
    setBusy(true); setError('');
    try {
      const a = await client.post('/payments/mock/authorize', { orderId: payment.orderId });
      await verify(a.paymentId, a.signature);
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const payRazorpay = async () => {
    setBusy(true); setError('');
    try {
      if (!payment.keyId || !payment.providerOrderId) throw new Error('Payments are not configured right now.');
      const Razorpay = await loadRazorpay(); // checkout.js is loaded only when the user actually pays
      const secondsLeft = payment.holdExpiresAt ? Math.floor((new Date(payment.holdExpiresAt).getTime() - Date.now()) / 1000) : 0;
      if (payment.holdExpiresAt && secondsLeft < 30) throw new Error('The slot hold has expired. Please pick the slot again.');
      const rzp = new Razorpay({
        key: payment.keyId, amount: Math.round(payment.amount * 100), currency: payment.currency || 'INR', order_id: payment.providerOrderId,
        ...(secondsLeft > 0 ? { timeout: Math.max(60, secondsLeft - 15) } : {}),
        retry: { enabled: true, max_count: 3 },
        name: 'FindADoc', description: description || title,
        prefill: { name: prefill.name || '', contact: prefill.phone || '' },
        theme: { color: '#0284c7' },
        handler: async resp => {
          try { await verify(resp.razorpay_payment_id, resp.razorpay_signature); } catch (e) { setError(e.message); setBusy(false); }
        },
        modal: { ondismiss: () => setBusy(false) }
      });
      rzp.on('payment.failed', r => { setError(r?.error?.description || 'Payment failed. Please try again.'); setBusy(false); });
      rzp.open();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const isMock = payment.provider === 'mock';
  return (
    <div className="fx-overlay fx-overlay-top">
      <div className="fx-sheet fx-pay" role="dialog" aria-modal="true" aria-label={title}>
        <div className="fx-sheet-head">
          <h3><CreditCard size={18} /> {title}</h3>
          <button className="adm-icon-btn" onClick={() => cancel()} disabled={busy} aria-label="Cancel payment"><X size={18} /></button>
        </div>
        <div className="fx-sheet-body">
          {description && <p className="adm-muted adm-small">{description}</p>}
          {breakdown.length > 0 && (
            <dl className="fx-breakdown">
              {breakdown.map(r => <div key={r.label} className={r.strong ? 'strong' : ''}><dt>{r.label}</dt><dd>{typeof r.value === 'number' ? inr(r.value) : r.value}</dd></div>)}
            </dl>
          )}
          <div className="fx-pay-total"><span>Pay now</span><strong>{inr(payment.amount)}</strong></div>
          {isMock && <p className="fx-note fx-note-info"><FlaskConical size={14} /> Development test mode (PAYMENTS_MODE=mock) — no real money is charged. Production always uses Razorpay.</p>}
          {error && <p className="fx-error" role="alert">{error}</p>}
          <p className="fx-secure"><ShieldCheck size={14} /> Payments are verified on our server before your booking is confirmed.</p>
        </div>
        <div className="adm-modal-foot">
          <button className="btn-secondary adm-btn" onClick={() => cancel()} disabled={busy}>Cancel</button>
          <button className="btn-primary adm-btn" onClick={isMock ? payMock : payRazorpay} disabled={busy} data-testid="pay-now">
            {busy ? <Loader2 size={15} className="adm-spin" /> : <CreditCard size={15} />} {isMock ? `Pay ${inr(payment.amount)} (test)` : `Pay ${inr(payment.amount)}`}
          </button>
        </div>
      </div>
    </div>
  );
}
