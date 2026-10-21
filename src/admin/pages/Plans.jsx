import React, { useCallback, useEffect, useState } from 'react';
import { Pencil, Loader2, Crown } from 'lucide-react';
import { PageHeader, Card, Modal, DataTable, Pagination, FilterBar, Tabs, useAdminList, useToast, ErrorNote, StatusBadge } from '../ui';
import { inr, fmtDateTime } from '../api';

const LIMIT_FIELDS = {
  doctor: [['maxLocations', 'Consultation locations'], ['maxSpecialities', 'Specialities']],
  clinic: [['maxDoctors', 'Doctors'], ['maxGalleryImages', 'Gallery photos']]
};
const FLAGS = [['onlinePayments', 'Online payments (paid / booking amount)'], ['analytics', 'Analytics'], ['verifiedBadge', 'Verified badge'], ['featuredInAi', 'Featured in AI search']];

function PlanEditor({ plan, onClose, onSaved, api }) {
  const toast = useToast();
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (plan) { setV({ name: plan.name, description: plan.description || plan.tagline || '', price: plan.price, durationDays: plan.durationDays || 30, isActive: plan.isActive !== false, highlight: Boolean(plan.highlight), features: (plan.features || []).join('\n'), limits: { ...plan.limits } }); setError(''); setBusy(false); } }, [plan]);
  if (!plan || !v) return null;
  const setL = (k, val) => setV({ ...v, limits: { ...v.limits, [k]: val } });
  const save = async () => {
    setBusy(true); setError('');
    try { const r = await api.put(`/plans/${plan.id}`, { ...v, price: Number(v.price), durationDays: Number(v.durationDays) }); toast.success(r.message); onSaved(); onClose(); } catch (e) { setError(e.message); setBusy(false); }
  };
  const base = Number(v.price) / 1.18;
  return (
    <Modal open title={`Edit ${plan.audience} plan — ${plan.name}`} onClose={busy ? undefined : onClose} width={640}
      footer={<><button className="btn-secondary adm-btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary adm-btn" onClick={save} disabled={busy} data-testid="plan-save">{busy && <Loader2 size={15} className="adm-spin" />} Save plan</button></>}>
      <div className="adm-form">
        <ErrorNote error={error} />
        <div className="adm-form-row">
          <label className="adm-field"><span>Name</span><input value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></label>
          <label className="adm-field"><span>Price incl. GST (₹)</span><input type="number" min="0" disabled={plan.code === 'basic'} value={v.price} onChange={e => setV({ ...v, price: e.target.value })} /><small className="adm-muted">Taxable {inr(Math.round(base * 100) / 100)} + GST {inr(Math.round((Number(v.price) - base) * 100) / 100)}</small></label>
          <label className="adm-field"><span>Duration (days)</span><input type="number" min="1" max="3650" disabled={plan.code === 'basic'} value={v.durationDays} onChange={e => setV({ ...v, durationDays: e.target.value })} /></label>
        </div>
        <label className="adm-field"><span>Description</span><input value={v.description} onChange={e => setV({ ...v, description: e.target.value })} /></label>
        <div className="adm-form-row">
          {LIMIT_FIELDS[plan.audience].map(([k, label]) => <label key={k} className="adm-field"><span>{label} (-1 = unlimited)</span><input type="number" min="-1" value={v.limits[k] ?? 0} onChange={e => setL(k, e.target.value)} /></label>)}
          <label className="adm-field"><span>Listing priority</span><input type="number" min="0" max="100" value={v.limits.listingPriority ?? 0} onChange={e => setL('listingPriority', e.target.value)} /></label>
        </div>
        {FLAGS.filter(([k]) => plan.audience === 'doctor' || k !== 'featuredInAi').map(([k, label]) => <label key={k} className="adm-check" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={Boolean(v.limits[k])} onChange={e => setL(k, e.target.checked)} /> {label}</label>)}
        <label className="adm-field"><span>Feature bullets (one per line)</span><textarea rows={4} value={v.features} onChange={e => setV({ ...v, features: e.target.value })} /></label>
        <label className="adm-check" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={v.highlight} onChange={e => setV({ ...v, highlight: e.target.checked })} /> Highlight as “Most popular”</label>
        <label className="adm-check" style={{ alignSelf: 'flex-start' }}><input type="checkbox" disabled={plan.code === 'basic'} checked={v.isActive} onChange={e => setV({ ...v, isActive: e.target.checked })} /> Available for purchase</label>
      </div>
    </Modal>
  );
}

/** Admin: plan catalogue (editable) + subscription payments. */
export default function Plans({ api }) {
  const [tab, setTab] = useState('plans');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get('/plans').then(setData).catch(e => setError(e.message)), [api]);
  useEffect(() => { load(); }, [load]);
  const subs = useAdminList(api, '/subscriptions', { sort: 'newest' });

  const lim = (n) => (n === -1 ? '∞' : n);
  return (
    <>
      <PageHeader title="Plans & subscriptions" subtitle="Prices include 18% GST. Changes apply to new purchases and to limits immediately." />
      <Tabs tabs={[{ value: 'plans', label: 'Plans' }, { value: 'payments', label: 'Subscription payments', count: subs.data.total }]} value={tab} onChange={setTab} />
      <ErrorNote error={error} />
      {tab === 'plans' && data && ['doctor', 'clinic'].map(aud => (
        <Card key={aud} title={aud === 'doctor' ? 'Doctor plans' : 'Clinic plans'}>
          <div className="adm-table-wrap">
            <table className="adm-table">
              <thead><tr><th>Plan</th><th style={{ textAlign: 'right' }}>Price</th><th>Duration</th><th>Limits</th><th>Features</th><th style={{ textAlign: 'right' }}>Active subscribers</th><th /></tr></thead>
              <tbody>
                {data.items.filter(p => p.audience === aud).sort((a, b) => a.tier - b.tier).map(p => (
                  <tr key={p.id}>
                    <td data-label="Plan"><strong><Crown size={13} /> {p.name}</strong>{p.highlight && <span className="adm-pro">POPULAR</span>}{p.isActive === false && <span className="adm-badge adm-badge-slate">Hidden</span>}</td>
                    <td data-label="Price" style={{ textAlign: 'right' }}>{p.price ? inr(p.price) : 'Free'}</td>
                    <td data-label="Duration">{p.code === 'basic' ? '—' : `${p.durationDays} days`}</td>
                    <td data-label="Limits" className="adm-small">{aud === 'doctor' ? `${lim(p.limits.maxLocations)} locations • ${lim(p.limits.maxSpecialities)} specialities` : `${lim(p.limits.maxDoctors)} doctors • ${lim(p.limits.maxGalleryImages)} photos`}</td>
                    <td data-label="Features" className="adm-small">{FLAGS.filter(([k]) => p.limits[k]).map(([, l]) => l.split(' (')[0]).join(', ') || '—'}</td>
                    <td data-label="Subscribers" style={{ textAlign: 'right' }}>{data.counts[aud]?.[p.code] || 0}</td>
                    <td data-label=""><button className="adm-act adm-act-blue" onClick={() => setEditing(p)} data-testid={`edit-plan-${p.id}`}><Pencil size={13} /> Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      {tab === 'payments' && (
        <>
          <FilterBar fields={[
            { key: 'search', type: 'search', label: 'Name, invoice, payment id' },
            { key: 'partyType', type: 'select', label: 'Type', options: [{ value: '', label: 'All' }, { value: 'doctor', label: 'Doctors' }, { value: 'clinic', label: 'Clinics' }] },
            { key: 'planCode', type: 'select', label: 'Plan', options: [{ value: '', label: 'All' }, { value: 'pro', label: 'Pro' }, { value: 'premium', label: 'Premium' }] },
            { key: 'status', type: 'select', label: 'Status', options: [{ value: '', label: 'All' }, { value: 'paid', label: 'Paid' }, { value: 'failed', label: 'Failed' }, { value: 'expired', label: 'Expired' }, { value: 'refunded', label: 'Refunded' }] },
            { key: 'from', type: 'date', label: 'From' }, { key: 'to', type: 'date', label: 'To' }
          ]} values={subs.params} onChange={subs.update} onReset={subs.reset} />
          <div className="adm-summary-strip"><span>Paid: <strong>{subs.data.totals?.count || 0}</strong> payments • <strong>{inr(subs.data.totals?.amount)}</strong> incl. GST</span></div>
          <ErrorNote error={subs.error} />
          <DataTable rows={subs.data.items} loading={subs.loading} empty="No subscription payments yet" columns={[
            { key: 'date', label: 'Date', render: o => fmtDateTime(o.paidAt || o.createdAt) },
            { key: 'party', label: 'Account', render: o => <div className="adm-stack"><span>{o.meta?.partyName || o.partyId}</span><small>{o.partyType}</small></div> },
            { key: 'plan', label: 'Plan', render: o => o.meta?.planName || o.meta?.planCode },
            { key: 'amount', label: 'Amount', align: 'right', render: o => inr(o.amount) },
            { key: 'inv', label: 'Invoice', render: o => <span className="adm-code">{o.ledgerInvoiceNumber || '—'}</span> },
            { key: 'prov', label: 'Provider', render: o => o.provider },
            { key: 'status', label: 'Status', render: o => <StatusBadge status={o.status} /> }
          ]} />
          <Pagination page={subs.data.page} pages={subs.data.pages} total={subs.data.total} limit={subs.data.limit} onPage={page => subs.update({ page })} onLimit={limit => subs.update({ limit })} />
        </>
      )}
      <PlanEditor plan={editing} api={api} onClose={() => setEditing(null)} onSaved={load} />
    </>
  );
}
