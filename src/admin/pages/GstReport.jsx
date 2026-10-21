import React, { useEffect, useState } from 'react';
import { Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { Card, PageHeader, ErrorNote, DataTable, BarChart, useToast } from '../ui';
import { inr2 } from '../api';

const currentMonth = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const CAT = { doctor_subscription: 'Doctor subscriptions', clinic_subscription: 'Clinic subscriptions', booking_fee: 'Patient booking fees' };

export default function GstReport({ api }) {
  const [mode, setMode] = useState('month');
  const [month, setMonth] = useState(currentMonth());
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [type, setType] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const params = mode === 'month' ? { month, type } : { from, to, type };
  const load = () => { setLoading(true); api.get('/gst/report', params).then(x => { setD(x); setErr(''); }).catch(e => setErr(e.message)).finally(() => setLoading(false)); };
  useEffect(load, [mode, month, from, to, type]); // eslint-disable-line
  const exp = section => api.download('/gst/export.csv', { ...params, section }).then(() => toast.success('CSV downloaded')).catch(e => toast.error(e.message));
  const t = d?.totals || {};

  return (
    <div>
      <PageHeader title="GST Report" subtitle="Output tax summary for GSTR-1 / GSTR-3B filing. Totals include paid transactions only." actions={<button className="btn-secondary adm-btn" onClick={load}><RefreshCw size={15} className={loading ? 'adm-spin' : ''} /> Refresh</button>} />
      <Card>
        <div className="adm-filters">
          <label className="adm-filter"><span>Period</span>
            <select className="adm-select" value={mode} onChange={e => setMode(e.target.value)}><option value="month">Month</option><option value="range">Date range</option></select>
          </label>
          {mode === 'month'
            ? <label className="adm-filter"><span>Month</span><input type="month" className="adm-select" value={month} onChange={e => setMonth(e.target.value)} /></label>
            : <>
              <label className="adm-filter"><span>From</span><input type="date" className="adm-select" value={from} onChange={e => setFrom(e.target.value)} /></label>
              <label className="adm-filter"><span>To</span><input type="date" className="adm-select" value={to} onChange={e => setTo(e.target.value)} /></label>
            </>}
          <label className="adm-filter"><span>Type</span>
            <select className="adm-select" value={type} onChange={e => setType(e.target.value)}><option value="">All</option><option value="subscription">Subscriptions</option><option value="patient_fee">Patient fees</option></select>
          </label>
        </div>
        {d?.business && <p className="adm-muted adm-small">Supplier: <strong>{d.business.name}</strong> • GSTIN <strong>{d.business.gstin || 'not set'}</strong> • State <strong>{d.business.state || '—'} ({d.business.stateCode || '—'})</strong>. Change in Settings.</p>}
      </Card>
      <ErrorNote error={err} />
      <div className="adm-kpi-grid adm-kpi-grid-sm">
        {[['Invoices', t.count || 0], ['Taxable value', inr2(t.taxableValue)], ['CGST', inr2(t.cgst)], ['SGST', inr2(t.sgst)], ['IGST', inr2(t.igst)], ['Total GST', inr2(t.totalTax)], ['Invoice value', inr2(t.invoiceValue)]].map(([l, v]) => (
          <div key={l} className="adm-stat"><span>{l}</span><strong>{v}</strong></div>
        ))}
      </div>
      <Card title="Export CSV (GSTR-1 style)" actions={null}>
        <div className="adm-export-row">
          <button className="btn-primary adm-btn" onClick={() => exp('register')}><FileSpreadsheet size={15} /> Full invoice register</button>
          <button className="btn-secondary adm-btn" onClick={() => exp('b2b')}><Download size={15} /> B2B (4A)</button>
          <button className="btn-secondary adm-btn" onClick={() => exp('b2cl')}><Download size={15} /> B2CL (5A)</button>
          <button className="btn-secondary adm-btn" onClick={() => exp('b2cs')}><Download size={15} /> B2CS (7)</button>
          <button className="btn-secondary adm-btn" onClick={() => exp('hsn')}><Download size={15} /> HSN/SAC summary (12)</button>
        </div>
        <p className="adm-muted adm-small">B2B = recipients with GSTIN. B2CL = inter-state unregistered invoices above ₹1,00,000. B2CS = all other unregistered supplies (grouped by place of supply & rate). Column headers follow the GST offline tool templates; verify with your CA before filing.</p>
      </Card>
      <div className="adm-grid-2">
        <Card title="By category">
          <DataTable rowKey={r => r._id} rows={d?.byCategory || []} columns={[
            { key: '_id', label: 'Category', render: r => CAT[r._id] || r._id },
            { key: 'count', label: 'Invoices', align: 'right' },
            { key: 'taxableValue', label: 'Taxable', align: 'right', render: r => inr2(r.taxableValue) },
            { key: 'totalTax', label: 'GST', align: 'right', render: r => inr2(r.totalTax) },
            { key: 'invoiceValue', label: 'Value', align: 'right', render: r => inr2(r.invoiceValue) }
          ]} />
        </Card>
        <Card title="By rate & supply type">
          <DataTable rowKey={r => `${r.rate}-${r.supplyType}`} rows={d?.byRate || []} columns={[
            { key: 'rate', label: 'Rate', render: r => `${r.rate}%` },
            { key: 'supplyType', label: 'Supply', render: r => (r.supplyType === 'intra' ? 'Intra-state (CGST+SGST)' : 'Inter-state (IGST)') },
            { key: 'taxableValue', label: 'Taxable', align: 'right', render: r => inr2(r.taxableValue) },
            { key: 'cgst', label: 'CGST', align: 'right', render: r => inr2(r.cgst) },
            { key: 'sgst', label: 'SGST', align: 'right', render: r => inr2(r.sgst) },
            { key: 'igst', label: 'IGST', align: 'right', render: r => inr2(r.igst) }
          ]} />
        </Card>
      </div>
      <div className="adm-grid-2">
        <Card title="GSTR-1 sections">
          <DataTable rowKey={r => r.k} rows={Object.entries(d?.bySection || {}).map(([k, v]) => ({ k, ...v }))} columns={[
            { key: 'k', label: 'Section' },
            { key: 'count', label: 'Invoices', align: 'right' },
            { key: 'taxableValue', label: 'Taxable', align: 'right', render: r => inr2(r.taxableValue) },
            { key: 'totalTax', label: 'GST', align: 'right', render: r => inr2(r.totalTax) }
          ]} />
        </Card>
        <Card title="GST by month">
          <BarChart format={inr2} data={(d?.byMonth || []).map(m => ({ label: m._id, values: m }))} series={[
            { key: 'cgst', label: 'CGST', color: '#0284c7' }, { key: 'sgst', label: 'SGST', color: '#0d9488' }, { key: 'igst', label: 'IGST', color: '#7c3aed' }
          ]} />
        </Card>
      </div>
    </div>
  );
}
