import React, { useEffect, useState } from 'react';
import { Users, Stethoscope, Building2, Clock, Ban, Flag, IndianRupee, Wallet, Receipt, CalendarCheck, RefreshCw, Activity, Undo2, Crown, CalendarClock } from 'lucide-react';
import { KpiCard, BarChart, Donut, Card, PageHeader, ErrorNote, StatusBadge } from '../ui';
import { inr, fmtDateTime } from '../api';

const monthLabel = m => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });

export default function Dashboard({ api, go }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const load = () => { setLoading(true); api.get('/dashboard').then(x => { setD(x); setErr(''); }).catch(e => setErr(e.message)).finally(() => setLoading(false)); };
  useEffect(load, [api]);
  const k = d?.kpis;
  const thisMonth = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`Platform overview • ${thisMonth}`} actions={<button className="btn-secondary adm-btn" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? 'adm-spin' : ''} /> Refresh</button>} />
      <ErrorNote error={err} />
      {!k ? <div className="adm-muted">Loading…</div> : <>
        <div className="adm-kpi-grid">
          <KpiCard icon={Users} label="Total patients" value={k.patients} tone="blue" onClick={() => go('patients')} />
          <KpiCard icon={Stethoscope} label="Total doctors" value={k.doctors} tone="teal" onClick={() => go('doctors')} />
          <KpiCard icon={Building2} label="Total clinics" value={k.clinics} tone="purple" onClick={() => go('clinics')} />
          <KpiCard icon={Clock} label="Pending approvals" value={k.pendingApprovals} sub={`${k.pendingDoctors} doctors • ${k.pendingClinics} clinics`} tone="amber" onClick={() => go('approvals')} />
          <KpiCard icon={Ban} label="Suspended accounts" value={k.suspended} sub={`${k.suspendedDoctors} dr • ${k.suspendedClinics} clinics • ${k.suspendedPatients} patients`} tone="red" />
          <KpiCard icon={Flag} label="Flagged reviews" value={k.flaggedReviews} sub="Hidden from public" tone="rose" onClick={() => go('reviews')} />
          <KpiCard icon={IndianRupee} label="Revenue this month" value={inr(k.revenueThisMonth.total)} sub="Invoice value incl. GST" tone="green" onClick={() => go('ledger')} />
          <KpiCard icon={Wallet} label="Pending payouts" value={inr(k.pendingPayouts.amount)} sub={`${k.pendingPayouts.count} open requests`} tone="amber" onClick={() => go('ledger/payouts')} />
          <KpiCard icon={Receipt} label="GST collected this month" value={inr(k.gstThisMonth.total)} sub={`CGST ${inr(k.gstThisMonth.cgst)} • SGST ${inr(k.gstThisMonth.sgst)} • IGST ${inr(k.gstThisMonth.igst)}`} tone="blue" onClick={() => go('gst')} />
          <KpiCard icon={CalendarCheck} label="Bookings this month" value={k.bookingsThisMonth} tone="teal" sub={Object.entries(k.bookingStatusThisMonth || {}).map(([s, n]) => `${n} ${s}`).join(' • ') || undefined} onClick={() => go('bookings')} />
          <KpiCard icon={CalendarClock} label="Appointments today" value={k.bookingsToday ?? 0} tone="blue" onClick={() => go('bookings')} />
          <KpiCard icon={Undo2} label="Refunds this month" value={inr(k.refundsThisMonth?.amount || 0)} sub={`${k.refundsThisMonth?.count || 0} refund documents`} tone="rose" onClick={() => go('ledger/refunds')} />
          <KpiCard icon={Crown} label="Paid subscriptions" value={Object.values(k.activeSubscriptions?.doctor || {}).concat(Object.values(k.activeSubscriptions?.clinic || {})).reduce((a, b) => a + b, 0)} sub={`Doctors: ${k.activeSubscriptions?.doctor?.pro || 0} Pro / ${k.activeSubscriptions?.doctor?.premium || 0} Premium • Clinics: ${k.activeSubscriptions?.clinic?.pro || 0} / ${k.activeSubscriptions?.clinic?.premium || 0}`} tone="purple" onClick={() => go('plans')} />
        </div>

        <div className="adm-grid-2">
          <Card title="Revenue this month by type">
            <div className="adm-rev-split">
              {[
                ['Doctor subscriptions', k.revenueThisMonth.doctor_subscription, '#0284c7'],
                ['Clinic subscriptions', k.revenueThisMonth.clinic_subscription, '#7c3aed'],
                ['Patient booking fees', k.revenueThisMonth.booking_fee, '#0d9488']
              ].map(([l, v, c]) => (
                <div key={l} className="adm-rev-row">
                  <span><i style={{ background: c }} />{l}</span>
                  <div className="adm-bar-track"><div style={{ width: `${k.revenueThisMonth.total ? (v.invoiceValue / k.revenueThisMonth.total) * 100 : 0}%`, background: c }} /></div>
                  <strong>{inr(v.invoiceValue)}</strong><small className="adm-muted">{v.count} txns</small>
                </div>
              ))}
            </div>
            <p className="adm-muted adm-small" style={{ marginTop: 8 }}>Booking fees = platform convenience fee (taxable). Consultation fees collected on behalf of doctors are tracked as pass-through in the ledger.</p>
          </Card>
          <Card title="Account status mix">
            <Donut parts={[
              { label: 'Active / other', value: Math.max(0, k.doctors + k.clinics - k.pendingApprovals - k.suspendedDoctors - k.suspendedClinics), color: '#10b981' },
              { label: 'Pending', value: k.pendingApprovals, color: '#f59e0b' },
              { label: 'Suspended', value: k.suspendedDoctors + k.suspendedClinics, color: '#ef4444' }
            ]} center={k.doctors + k.clinics} />
            <p className="adm-muted adm-small">Doctors + clinics</p>
          </Card>
        </div>

        <div className="adm-grid-2">
          <Card title="Revenue — last 6 months">
            <BarChart format={inr} data={d.revenueSeries.map(r => ({ label: monthLabel(r.month), values: r }))} series={[
              { key: 'subscription', label: 'Subscriptions', color: '#0284c7' },
              { key: 'patient_fee', label: 'Patient fees', color: '#0d9488' }
            ]} />
          </Card>
          <Card title="New registrations — last 6 months">
            <BarChart stacked={false} data={d.signupSeries.map(r => ({ label: monthLabel(r.month), values: r }))} series={[
              { key: 'patients', label: 'Patients', color: '#38bdf8' },
              { key: 'doctors', label: 'Doctors', color: '#0d9488' },
              { key: 'clinics', label: 'Clinics', color: '#a78bfa' }
            ]} />
          </Card>
        </div>

        <Card title={<><Activity size={16} style={{ verticalAlign: '-3px' }} /> Recent activity</>}>
          <ul className="adm-activity">
            {d.activity.length === 0 && <li className="adm-muted">No activity yet</li>}
            {d.activity.map(a => (
              <li key={`${a.kind}-${a.id}`}>
                <span className={`adm-dot adm-dot-${a.kind}`} />
                <div style={{ flex: 1, minWidth: 0 }}>{a.text} {a.status && <StatusBadge status={a.status} />}</div>
                <small className="adm-muted">{fmtDateTime(a.at)}</small>
              </li>
            ))}
          </ul>
        </Card>
      </>}
    </div>
  );
}
