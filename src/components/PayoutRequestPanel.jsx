import React, { useEffect, useState } from 'react';
import { Wallet, Send, CheckCircle2, Clock, XCircle, AlertCircle } from 'lucide-react';

const STATUS_STYLE = {
  Pending: ['#b45309', '#fffbeb', '#fde68a', Clock],
  Approved: ['#1d4ed8', '#eff6ff', '#bfdbfe', CheckCircle2],
  Paid: ['#047857', '#ecfdf5', '#a7f3d0', CheckCircle2],
  Completed: ['#047857', '#ecfdf5', '#a7f3d0', CheckCircle2],
  Rejected: ['#b91c1c', '#fef2f2', '#fecaca', XCircle]
};
const inr = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Doctor / clinic payout request form + history.
 * Balance moves: available -> in process (on request) -> paid out (admin marks paid) or back to available (rejected).
 */
export default function PayoutRequestPanel({ client, entity, accent = '#0284c7', onChange }) {
  const [data, setData] = useState({ payouts: [], balance: null });
  const [amount, setAmount] = useState('');
  const [bank, setBank] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = async () => {
    try { setData(await client.get('/payouts')); } catch { /* handled by client */ }
  };
  useEffect(() => { if (entity?.id) load(); }, [entity?.id]); // eslint-disable-line

  const bal = data.balance || { available: entity.claimPendingFee || 0, inProcess: entity.payoutPendingFee || 0, paidOut: entity.claimedFee || 0 };
  const isActive = !entity.status || entity.status === 'active';

  const submit = async e => {
    e.preventDefault();
    setErr(''); setMsg(''); setBusy(true);
    try {
      const d = await client.post('/payouts/request', { amount: amount === '' ? undefined : Number(amount), bankDetails: bank, note });
      setMsg(d.message); setAmount(''); setNote('');
      await load();
      onChange?.();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  };

  const box = { background: '#ffffff', borderRadius: 18, padding: 18, border: '1px solid #e2e8f0' };
  const input = { width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13 };
  const label = { fontSize: 12, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {[['Available to withdraw', bal.available, accent], ['In process', bal.inProcess, '#d97706'], ['Total paid out', bal.paidOut, '#059669']].map(([l, v, c]) => (
          <div key={l} style={box}>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 800, textTransform: 'uppercase' }}>{l}</span>
            <h3 style={{ fontSize: 26, fontWeight: 800, color: c, margin: '4px 0 0' }}>{inr(v)}</h3>
          </div>
        ))}
      </div>

      <form onSubmit={submit} style={{ ...box, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h4 style={{ fontSize: 15, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 6 }}><Wallet size={17} color={accent} /> Request a payout</h4>
        {!isActive && <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', padding: 10, borderRadius: 10 }}>Payouts are available once your account is verified and active.</div>}
        {err && <div style={{ fontSize: 12, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', padding: 10, borderRadius: 10, display: 'flex', gap: 6 }}><AlertCircle size={15} /> {err}</div>}
        {msg && <div style={{ fontSize: 12, color: '#047857', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: 10, borderRadius: 10, display: 'flex', gap: 6 }}><CheckCircle2 size={15} /> {msg}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
          <label><span style={label}>Amount (₹) — blank = full balance</span>
            <input type="number" min="1" step="0.01" max={bal.available || undefined} value={amount} onChange={e => setAmount(e.target.value)} placeholder={`Up to ${inr(bal.available)}`} style={input} /></label>
          <label><span style={label}>Bank account / UPI for transfer</span>
            <input value={bank} onChange={e => setBank(e.target.value)} placeholder="e.g. HDFC • A/C XXXX9821 • IFSC HDFC0001234" style={input} /></label>
        </div>
        <label><span style={label}>Note (optional)</span><input value={note} onChange={e => setNote(e.target.value)} style={input} /></label>
        <button type="submit" className="btn-primary" disabled={busy || !isActive || !(bal.available > 0)} style={{ alignSelf: 'flex-start', padding: '10px 18px', background: accent, opacity: busy || !isActive || !(bal.available > 0) ? 0.6 : 1 }}>
          <Send size={15} /> {busy ? 'Submitting…' : 'Submit payout request'}
        </button>
        <p style={{ fontSize: 11, color: '#64748b' }}>Requests are reviewed by FindADoc admin. Once transferred, the bank reference number appears below.</p>
      </form>

      <div style={box}>
        <h4 style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Payout history</h4>
        {data.payouts.length === 0 ? <p style={{ fontSize: 13, color: '#64748b' }}>No payout requests yet.</p> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.payouts.map(p => {
              const [c, bg, bd, Icon] = STATUS_STYLE[p.status] || STATUS_STYLE.Pending;
              return (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', padding: 12, borderRadius: 12, border: '1px solid #f1f5f9', background: '#f8fafc' }}>
                  <div>
                    <strong style={{ fontSize: 14 }}>{inr(p.amount)}</strong> <span style={{ fontSize: 12, color: '#64748b' }}>• {p.referenceCode} • {new Date(p.requestedAt || p.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
                    {p.paymentReference && <div style={{ fontSize: 12, color: '#047857' }}>Bank ref / UTR: {p.paymentReference}</div>}
                    {p.rejectionReason && <div style={{ fontSize: 12, color: '#b91c1c' }}>Rejected: {p.rejectionReason}</div>}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 800, color: c, background: bg, border: `1px solid ${bd}`, padding: '3px 10px', borderRadius: 9999, display: 'inline-flex', gap: 4, alignItems: 'center', height: 'fit-content' }}><Icon size={12} /> {p.status}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
