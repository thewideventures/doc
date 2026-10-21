import React, { useEffect, useState } from 'react';
import { IndianRupee, CalendarCheck, UserX, Star, Wallet, Download, Loader2, FileText } from 'lucide-react';
import { Card, KpiCard, BarChart, ErrorNote, PageHeader, DataTable, useToast } from '../admin/ui';
import { inr, fmtDateLong } from '../lib/api';
import { useT } from '../i18n';
import { downloadBlob } from '../patient/PrescriptionModal';

const iso = d => d.toISOString().slice(0, 10);
const PRESETS = {
  month: () => { const n = new Date(Date.now() + 330 * 60000); return { from: `${iso(n).slice(0, 8)}01`, to: iso(n) }; },
  last3: () => { const n = new Date(Date.now() + 330 * 60000); const f = new Date(n); f.setUTCMonth(f.getUTCMonth() - 2, 1); return { from: iso(f), to: iso(n) }; },
  fy: () => { const n = new Date(Date.now() + 330 * 60000); const y = n.getUTCMonth() >= 3 ? n.getUTCFullYear() : n.getUTCFullYear() - 1; return { from: `${y}-04-01`, to: iso(n) }; }
};

/** Doctor / clinic earnings & analytics: bookings, revenue, payouts, no-show rate, ratings, GST invoices + statement PDF. */
export default function EarningsPanel({ client, base }) {
  const t = useT();
  const toast = useToast();
  const [preset, setPreset] = useState('last3');
  const [range, setRange] = useState(PRESETS.last3());
  const [data, setData] = useState(null);
  const [invoices, setInvoices] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  useEffect(() => { setData(null); client.get(`${base}/earnings`, range).then(setData).catch(e => setError(e.message)); }, [client, base, range]);
  useEffect(() => { client.get(`${base}/invoices`).then(r => setInvoices(r.invoices)).catch(() => setInvoices([])); }, [client, base]);
  const dl = async (path, name, key) => { setBusy(key); try { await downloadBlob(client, path, name); } catch (e) { toast.error(e.message); } finally { setBusy(''); } };
  const choose = p => { setPreset(p); setRange(PRESETS[p]()); };

  return (
    <div data-testid="earnings-panel">
      <PageHeader title={t('earn.title')} subtitle={t('earn.subtitle')} actions={
        <div className="fx-row fx-wrap">
          <select className="adm-select" value={preset} onChange={e => choose(e.target.value)} aria-label={t('earn.period')}>
            {Object.keys(PRESETS).map(p => <option key={p} value={p}>{t(`earn.p.${p}`)}</option>)}
          </select>
          <button className="btn-secondary adm-btn" onClick={() => dl(`${base}/earnings/statement.pdf?from=${range.from}&to=${range.to}`, `statement-${range.from}-${range.to}.pdf`, 'stmt')} disabled={busy === 'stmt'} data-testid="statement-pdf">
            {busy === 'stmt' ? <Loader2 size={14} className="adm-spin" /> : <Download size={14} />} {t('earn.statement')}
          </button>
        </div>
      } />
      <ErrorNote error={error} />
      {!data ? <div className="fx-center"><Loader2 className="adm-spin" /></div> : (
        <>
          <div className="adm-kpi-grid">
            <KpiCard icon={IndianRupee} label={t('earn.net')} value={inr(data.revenue.net)} sub={t('earn.netSub', { online: inr(data.revenue.onlineCollected), clinic: inr(data.revenue.atClinic) })} tone="green" />
            <KpiCard icon={CalendarCheck} label={t('earn.bookings')} value={data.bookings.total} sub={t('earn.completed', { n: data.bookings.completed })} tone="blue" />
            <KpiCard icon={UserX} label={t('earn.noShow')} value={`${data.noShowRate}%`} sub={t('earn.noShowSub', { n: data.bookings.noShow })} tone="amber" />
            <KpiCard icon={Star} label={t('earn.rating')} value={Number(data.ratings.average || 0).toFixed(1)} sub={t('doc.reviewsCount', { n: data.ratings.count })} tone="purple" />
            <KpiCard icon={Wallet} label={t('earn.balance')} value={inr(data.payouts.balance.available)} sub={t('earn.paidOut', { amount: inr(data.payouts.paidOut) })} tone="slate" />
          </div>
          <div className="adm-grid-2">
            <Card title={t('earn.revenueByMonth')}>
              <BarChart data={data.series.map(s => ({ label: s.month.slice(2), values: { revenue: s.revenue } }))} series={[{ key: 'revenue', label: t('earn.revenue'), color: '#10b981' }]} format={v => inr(v)} />
            </Card>
            <Card title={t('earn.visitsByMonth')}>
              <BarChart data={data.series.map(s => ({ label: s.month.slice(2), values: { completed: s.completed, noShow: s.noShow } }))} series={[{ key: 'completed', label: t('earn.completedL'), color: '#3b82f6' }, { key: 'noShow', label: t('earn.noShowL'), color: '#f59e0b' }]} />
            </Card>
          </div>
          <div className="adm-grid-2">
            <Card title={t('earn.ratings')}>
              {[5, 4, 3, 2, 1].map(n => {
                const c = (data.ratings.distribution || []).find(d => d.rating === n)?.count || 0;
                const pct = data.ratings.count ? Math.round((c / data.ratings.count) * 100) : 0;
                return <div key={n} className="fx-rating-row"><span>{n}★</span><div className="fx-rating-bar"><i style={{ width: `${pct}%` }} /></div><small>{c}</small></div>;
              })}
            </Card>
            <Card title={t('earn.payouts')}>
              {data.payouts.list.length === 0 ? <p className="adm-muted adm-small">{t('earn.noPayouts')}</p> : (
                <ul className="fx-list">{data.payouts.list.slice(0, 8).map(p => <li key={p.id} className="fx-list-row"><span>{fmtDateLong(p.requestedAt)} • {p.status}</span><b>{inr(p.amount)}</b></li>)}</ul>
              )}
              <p className="adm-small adm-muted">{t('earn.inProcess', { amount: inr(data.payouts.balance.inProcess) })}</p>
            </Card>
          </div>
        </>
      )}
      <Card title={<><FileText size={15} /> {t('earn.invoices')}</>}>
        <DataTable loading={invoices === null} rows={invoices || []} empty={t('earn.noInvoices')} columns={[
          { key: 'n', label: t('earn.invNo'), render: r => <span className="adm-code">{r.invoiceNumber}</span> },
          { key: 'd', label: t('earn.date'), render: r => fmtDateLong(r.txnDate) },
          { key: 'desc', label: t('earn.desc'), render: r => <span>{r.documentType === 'credit_note' ? `${t('earn.creditNote')} • ` : ''}{r.description}</span> },
          { key: 'v', label: t('earn.amount'), render: r => <div className="adm-stack"><b>{inr(r.invoiceValue ?? r.totalAmount)}</b><small>GST {inr(r.totalTax)}</small></div> },
          { key: 'a', label: '', render: r => r.invoiceNumber && <button className="adm-act" onClick={() => dl(`${base}/invoices/${r.id}/pdf`, `${r.invoiceNumber.replace(/\//g, '-')}.pdf`, r.id)} disabled={busy === r.id} data-testid="invoice-pdf"><Download size={12} /> PDF</button> }
        ]} />
      </Card>
    </div>
  );
}
