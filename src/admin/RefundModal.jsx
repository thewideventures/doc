import React, { useEffect, useState } from 'react';
import { Undo2, Loader2 } from 'lucide-react';
import { Modal, useToast } from './ui';
import { inr } from './api';

/**
 * Full / partial refund through Razorpay (or the dev mock) with a GST credit note.
 * props: api, endpoint (POST path), orderId (to load refundable amount), title, onDone, onClose
 */
export default function RefundModal({ api, endpoint, orderId, title = 'Refund payment', onDone, onClose }) {
  const toast = useToast();
  const [order, setOrder] = useState(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get(`/payments/${encodeURIComponent(orderId)}`).then(r => { if (live) { setOrder(r.item); setAmount(String(r.item.refundable || '')); } }).catch(e => live && setError(e.message));
    return () => { live = false; };
  }, [api, orderId]);

  const submit = async e => {
    e.preventDefault();
    const amt = Number(amount);
    if (!(amt > 0) || amt > (order?.refundable || 0)) { setError(`Enter an amount between ₹1 and ${inr(order?.refundable || 0)}`); return; }
    if (reason.trim().length < 3) { setError('A refund reason is required'); return; }
    setBusy(true); setError('');
    try {
      const r = await api.post(endpoint, { amount: amt, reason: reason.trim() });
      toast.success(r.message);
      onDone?.(r);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal open title={title} onClose={onClose} width={480}
      footer={<><button className="adm-btn" onClick={onClose} disabled={busy}>Close</button><button className="adm-btn adm-btn-danger" onClick={submit} disabled={busy || !order || !(order.refundable > 0)} data-testid="refund-submit">{busy ? <Loader2 size={14} className="adm-spin" /> : <Undo2 size={14} />} Refund {amount ? inr(Number(amount)) : ''}</button></>}>
      {!order && !error && <p className="adm-muted"><Loader2 size={14} className="adm-spin" /> Loading payment…</p>}
      {order && (
        <form onSubmit={submit} className="adm-form">
          <div className="adm-kv-grid">
            <div className="adm-kv"><span>Paid</span><strong>{inr(order.amount)}</strong></div>
            <div className="adm-kv"><span>Already refunded</span><strong>{inr(order.refundedAmount)}</strong></div>
            <div className="adm-kv"><span>Refundable</span><strong>{inr(order.refundable)}</strong></div>
            <div className="adm-kv"><span>Provider</span><strong>{order.provider} {order.providerPaymentId ? `• ${order.providerPaymentId}` : ''}</strong></div>
          </div>
          <label className="adm-field"><span>Refund amount (₹)</span>
            <input className="adm-input" type="number" min="1" step="0.01" max={order.refundable} value={amount} onChange={e => setAmount(e.target.value)} data-testid="refund-amount" />
          </label>
          <label className="adm-field"><span>Reason (recorded on the credit note)</span>
            <input className="adm-input" value={reason} onChange={e => setReason(e.target.value)} maxLength={300} data-testid="refund-reason" />
          </label>
          <p className="adm-small adm-muted">Consultation / booking amounts are refunded first, then the platform fee (GST credit note). Razorpay refunds usually reach the customer in 5–7 working days.</p>
        </form>
      )}
      {error && <p className="fx-error" role="alert">{error}</p>}
    </Modal>
  );
}
