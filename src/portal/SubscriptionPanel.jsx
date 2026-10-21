import React, { useCallback, useEffect, useState } from 'react';
import { Check, Crown, Loader2, Receipt, Sparkles, X } from 'lucide-react';
import { Card, useToast, ErrorNote } from '../admin/ui';
import PaymentSheet from '../components/PaymentSheet';
import { inr, fmtDateLong } from '../lib/api';

const FEATURE_LINES = {
  doctor: l => [
    `${l.maxLocations === -1 ? 'Unlimited' : l.maxLocations} consultation location${l.maxLocations === 1 ? '' : 's'}`,
    `Up to ${l.maxSpecialities === -1 ? 'unlimited' : l.maxSpecialities} specialities`,
    [l.onlinePayments, 'Collect paid / booking-amount bookings online'],
    [l.analytics, 'Booking analytics'],
    [l.verifiedBadge, 'Verified badge on your profile'],
    [l.featuredInAi, 'Featured in AI search suggestions'],
    [(l.listingPriority || 0) > 0, 'Higher ranking in search']
  ],
  clinic: l => [
    `${l.maxDoctors === -1 ? 'Unlimited' : l.maxDoctors} doctors`,
    `${l.maxGalleryImages === -1 ? 'Unlimited' : l.maxGalleryImages} gallery photos`,
    [l.onlinePayments, 'Collect paid / booking-amount bookings online'],
    [l.analytics, 'Booking analytics'],
    [l.verifiedBadge, 'Verified badge'],
    [(l.listingPriority || 0) > 0, 'Higher ranking in search']
  ]
};

/** Plans & upgrade for doctors / clinics. Prices are inclusive of 18% GST; a GST invoice is created on payment. */
export default function SubscriptionPanel({ client, audience, entity, onChanged }) {
  const toast = useToast();
  const [plans, setPlans] = useState([]);
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [checkout, setCheckout] = useState(null);

  const load = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([client.get('/subscriptions/plans', { audience }), client.get('/subscriptions/me')]);
      setPlans(p.plans); setMe(m); setError('');
    } catch (e) { setError(e.message); }
  }, [client, audience]);
  useEffect(() => { load(); }, [load]);

  const choose = async plan => {
    setBusy(plan.code);
    try {
      const r = await client.post('/subscriptions/checkout', { planCode: plan.code });
      if (r.activated) { toast.success(r.message); await load(); onChanged?.(); }
      else setCheckout({ payment: r.payment, plan: r.plan });
    } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  const current = me?.current;
  const sorted = [...plans].sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0));

  return (
    <div>
      <ErrorNote error={error} />
      {current && (
        <div className="fx-plan-current">
          <Crown size={20} />
          <div>
            <strong>{current.name} plan</strong>
            <small>{current.expiresAt ? `${current.expired ? 'Expired' : 'Renews / expires'} on ${fmtDateLong(current.expiresAt)}` : current.code?.endsWith('basic') ? 'Free forever' : 'No expiry'}</small>
          </div>
        </div>
      )}
      <div className="fx-plans">
        {sorted.map(p => {
          const isCurrent = current?.code === p.code;
          const lines = FEATURE_LINES[audience](p.limits || {});
          const base = Math.round((p.price / 1.18) * 100) / 100;
          return (
            <div key={p.code} className={`fx-plan ${isCurrent ? 'current' : ''} ${p.highlight ? 'popular' : ''}`} data-plan={p.code}>
              {p.highlight && <span className="fx-plan-tag"><Sparkles size={12} /> Most popular</span>}
              <h3>{p.name}</h3>
              <div className="fx-plan-price">{p.price > 0 ? <><strong>{inr(p.price)}</strong><span>/ {p.durationDays} days</span></> : <strong>Free</strong>}</div>
              {p.price > 0 && <small className="adm-muted">{inr(base)} + 18% GST {inr(p.price - base)}</small>}
              {(p.tagline || p.description) && <p className="adm-small adm-muted">{p.tagline || p.description}</p>}
              <ul>
                {lines.map((l, i) => {
                  const [ok, text] = Array.isArray(l) ? l : [true, l];
                  return <li key={i} className={ok ? '' : 'off'}>{ok ? <Check size={14} /> : <X size={14} />} {text}</li>;
                })}
              </ul>
              <button className={`adm-btn ${isCurrent ? 'btn-secondary' : 'btn-primary'}`} disabled={isCurrent || busy === p.code} onClick={() => choose(p)} data-testid={`choose-${p.code}`}>
                {busy === p.code && <Loader2 size={15} className="adm-spin" />}
                {isCurrent ? 'Current plan' : p.price > 0 ? (current && (current.tier ?? 0) > (p.tier ?? 0) ? `Switch to ${p.name}` : `Upgrade to ${p.name}`) : 'Switch to Basic'}
              </button>
            </div>
          );
        })}
      </div>
      <p className="adm-small adm-muted" style={{ marginTop: 10 }}>Prices include 18% GST. A GST tax invoice is issued for every payment{entity?.gstin ? ` with your GSTIN ${entity.gstin}` : ' — add your GSTIN in your profile to claim input credit'}. Downgrading takes effect immediately; limits above the new plan block new additions but keep existing data.</p>

      <Card title={<><Receipt size={16} /> Billing history</>} className="fx-mt">
        {!me?.history?.items?.length ? <p className="adm-muted adm-small">No subscription payments yet.</p> : (
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Date</th><th>Plan</th><th>Invoice</th><th style={{ textAlign: 'right' }}>Amount</th><th>Status</th></tr></thead>
              <tbody>
                {me.history.items.map(o => (
                  <tr key={o.id}>
                    <td data-label="Date">{fmtDateLong(o.paidAt || o.createdAt)}</td>
                    <td data-label="Plan">{o.meta?.planName || o.meta?.planCode || '—'}</td>
                    <td data-label="Invoice" className="adm-code">{o.ledgerInvoiceNumber || '—'}</td>
                    <td data-label="Amount" style={{ textAlign: 'right' }}>{inr(o.amount)}</td>
                    <td data-label="Status"><span className={`adm-badge adm-badge-${o.status === 'paid' ? 'green' : 'slate'}`}>{o.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {checkout && (
        <PaymentSheet payment={checkout.payment} client={client} title={`Upgrade to ${checkout.plan.name}`}
          description={`${checkout.plan.durationDays}-day subscription • GST invoice issued on payment`}
          breakdown={[{ label: 'Plan price (excl. GST)', value: Math.round((checkout.plan.price / 1.18) * 100) / 100 }, { label: 'GST @ 18%', value: Math.round((checkout.plan.price - checkout.plan.price / 1.18) * 100) / 100 }]}
          prefill={{ name: entity?.name, phone: entity?.phone }}
          onSuccess={async r => { setCheckout(null); toast.success(r.message); await load(); onChanged?.(); }}
          onCancel={() => { setCheckout(null); toast.info('Payment cancelled'); }} />
      )}
    </div>
  );
}
