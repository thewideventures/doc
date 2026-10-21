import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard, CalendarCheck, MapPin, UserRound, Building2, BarChart3, Wallet, Crown, CheckCircle2, Circle, Loader2,
  Plus, Pencil, Trash2, Navigation, Lock, Mail, Send, Search, ExternalLink, AlertCircle, Power
} from 'lucide-react';
import { ToastProvider, useToast, useConfirm, Card, KpiCard, BarChart, Donut, ErrorNote, PageHeader, Modal } from '../admin/ui';
import { createClient, getSession, setSession, clearSession, apiFetch, inr, LOCATION_KIND_LABEL, SESSION_EXPIRED_MSG } from '../lib/api';
import PortalShell from '../portal/PortalShell';
import PortalLogin from '../portal/PortalLogin';
import BookingsPanel from '../portal/BookingsPanel';
import SubscriptionPanel from '../portal/SubscriptionPanel';
import LocationEditor from '../portal/LocationEditor';
import { DoctorFields } from '../portal/fields';
import ImageCropUpload from '../components/ImageCropUpload';
import DocumentUpload from '../components/DocumentUpload';
import AccountStatusBanner from '../components/AccountStatusBanner';
import PayoutRequestPanel from '../components/PayoutRequestPanel';
import { ModeBadge, KIND_ICON } from '../components/BookingModal';
import QueuePanel from '../portal/QueuePanel';
import EarningsPanel from '../portal/EarningsPanel';
import PrescriptionEditor from '../portal/PrescriptionEditor';
import SharedRecordsModal from '../portal/SharedRecordsModal';
import { useT } from '../i18n';
import { Pill, FolderOpen, ListOrdered, IndianRupee } from 'lucide-react';

/** Bookings + clinical actions (prescription editor, shared records) for the doctor portal. */
function DoctorBookings({ client, doctor, onChanged }) {
  const t = useT();
  const [rx, setRx] = useState(null);
  const [rec, setRec] = useState(null);
  const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  return (
    <>
      <BookingsPanel client={client} base="/doctor-portal" locations={doctor.consultationLocations} onChanged={onChanged}
        extraActions={b => (
          <>
            {['Confirmed', 'Completed'].includes(b.status) && b.date <= today && <button className="adm-act adm-act-blue" onClick={() => setRx(b)} data-testid="open-rx"><Pill size={13} /> {t('dr.prescription')}</button>}
            {['Pending', 'Confirmed', 'Completed'].includes(b.status) && <button className="adm-act" onClick={() => setRec(b)} data-testid="open-records"><FolderOpen size={13} /> {t('dr.records')}</button>}
          </>
        )} />
      {rx && <PrescriptionEditor client={client} booking={rx} onClose={() => setRx(null)} />}
      {rec && <SharedRecordsModal client={client} booking={rec} onClose={() => setRec(null)} />}
    </>
  );
}

function useSpecialities() {
  const [list, setList] = useState([]);
  useEffect(() => { apiFetch('/api/specialities').then(r => setList(r.specialities.map(s => s.name))).catch(() => {}); }, []);
  return list;
}

const pick = (d, keys) => Object.fromEntries(keys.map(k => [k, d?.[k] ?? '']));
const PROFILE_KEYS = ['name', 'title', 'qualifications', 'experienceYears', 'registrationNumber', 'councilName', 'registrationYear', 'gender', 'specialities', 'languages', 'bio', 'email', 'gstin', 'state', 'sector'];

// ---------------------------------------------------------------------------
// Registration (phone already verified)
// ---------------------------------------------------------------------------
function DoctorRegister({ proof, onDone, onCancel }) {
  const specialities = useSpecialities();
  const [v, setV] = useState({ specialities: [], languages: ['English'], experienceYears: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [agree, setAgree] = useState(false);
  const submit = async e => {
    e.preventDefault();
    if (!agree) { setError('Please confirm the declaration'); return; }
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/api/doctors/register', { method: 'POST', token: proof.phoneToken, body: v });
      onDone(r);
    } catch (err) { setError(err.status === 401 ? 'Your OTP verification expired. Please verify your number again.' : err.message); if (err.status === 401) onCancel(); } finally { setBusy(false); }
  };
  return (
    <div className="fx-auth fx-portal-doctor">
      <form className="fx-auth-card fx-auth-wide" onSubmit={submit}>
        <PageHeader title="Create your doctor profile" subtitle={`Mobile ${proof.phone} verified. Your profile goes live after FindADoc verifies your registration.`} />
        {error && <div className="adm-alert adm-alert-error"><AlertCircle size={16} /> {error}</div>}
        <DoctorFields value={v} onChange={setV} specialities={specialities} maxSpecialities={2} />
        <ol className="fx-next-steps">
          <li>Next you will add your photo (with crop), consultation locations on the map and your registration certificate.</li>
        </ol>
        <label className="adm-check" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /> I confirm I am a registered medical practitioner and these details are true.</label>
        <div className="fx-row fx-between">
          <button type="button" className="btn-secondary adm-btn" onClick={onCancel}>Back</button>
          <button className="btn-primary adm-btn" disabled={busy} data-testid="register-submit">{busy && <Loader2 size={15} className="adm-spin" />} Submit for verification</button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------
function Overview({ doctor, stats, go }) {
  const c = doctor.completeness || { percent: 0, items: [] };
  const target = { photo: 'profile', basics: 'profile', registration: 'profile', experience: 'profile', languages: 'profile', about: 'profile', location: 'locations', document: 'profile' };
  return (
    <>
      <PageHeader title={`Hello, ${doctor.name}`} subtitle={doctor.status === 'active' ? 'Your profile is live on FindADoc.' : 'Complete your profile while we verify your registration.'}
        actions={doctor.status === 'active' && <a className="btn-secondary adm-btn adm-btn-sm" href={`/doctors/${doctor.slug}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> View public profile</a>} />
      <div className="adm-kpi-grid">
        <KpiCard icon={CalendarCheck} label="Today" value={stats.today ?? 0} sub="appointments" tone="blue" onClick={() => go('bookings')} />
        <KpiCard icon={CalendarCheck} label="Upcoming" value={stats.upcoming ?? 0} tone="teal" onClick={() => go('bookings')} />
        <KpiCard icon={AlertCircle} label="Requests" value={stats.pending ?? 0} sub="waiting for you" tone="amber" onClick={() => go('bookings')} />
        <KpiCard icon={Mail} label="Clinic invites" value={stats.invites ?? 0} tone="purple" onClick={() => go('clinics')} />
        <KpiCard icon={Wallet} label="Available payout" value={inr(doctor.claimPendingFee)} tone="green" onClick={() => go('payouts')} />
      </div>
      <div className="adm-grid-2">
        <Card title={`Profile ${c.percent}% complete`}>
          <div className="adm-bar-track" style={{ marginBottom: 12 }}><div style={{ width: `${c.percent}%`, background: 'var(--primary)' }} /></div>
          <ul className="fx-checklist">
            {c.items.map(i => (
              <li key={i.key} className={i.done ? 'done' : ''}>
                {i.done ? <CheckCircle2 size={16} /> : <Circle size={16} />}<span>{i.label}</span>
                {!i.done && <button className="adm-link" onClick={() => go(target[i.key] || 'profile')}>Add</button>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Plan">
          <p><strong>{doctor.plan?.name}</strong> plan</p>
          <p className="adm-muted adm-small">{doctor.plan?.limits?.maxLocations === -1 ? 'Unlimited' : doctor.plan?.limits?.maxLocations} location(s) • {doctor.plan?.limits?.onlinePayments ? 'Online payments enabled' : 'Free bookings only'}</p>
          <button className="btn-primary adm-btn adm-btn-sm fx-mt" onClick={() => go('subscription')}><Crown size={14} /> {doctor.plan?.tier > 0 ? 'Manage plan' : 'Upgrade'}</button>
        </Card>
      </div>
    </>
  );
}

function Locations({ client, doctor, onChanged }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [editing, setEditing] = useState(null); // null | 'new' | location
  const limits = doctor.plan?.limits || {};
  const own = doctor.consultationLocations.filter(l => l.managedBy !== 'clinic');
  const clinicLocs = doctor.consultationLocations.filter(l => l.managedBy === 'clinic');
  const activeOwn = own.filter(l => l.isActive).length;
  const atLimit = limits.maxLocations !== -1 && activeOwn >= limits.maxLocations;

  const save = async payload => {
    const r = editing === 'new' ? await client.post('/doctor-portal/locations', payload) : await client.put(`/doctor-portal/locations/${editing.id}`, payload);
    toast.success(r.message); onChanged(r.doctor);
  };
  const remove = l => confirm({
    title: `Remove ${l.name}?`, danger: true, confirmLabel: 'Remove',
    message: 'If there are upcoming bookings here, the location is deactivated (no new bookings) instead of deleted.',
    onConfirm: async () => { const r = await client.del(`/doctor-portal/locations/${l.id}`); toast.success(r.message); onChanged(r.doctor); }
  });
  const toggle = async l => {
    try { const r = await client.put(`/doctor-portal/locations/${l.id}`, { isActive: !l.isActive }); toast.success(l.isActive ? 'Location paused' : 'Location re-activated'); onChanged(r.doctor); } catch (e) { toast.error(e.message); }
  };

  const LocCard = ({ l, readOnly }) => {
    const I = KIND_ICON[l.kind] || MapPin;
    return (
      <div className={`fx-loc-card ${l.isActive ? '' : 'inactive'}`}>
        <div className="fx-loc-card-head"><span className="fx-loc-icon"><I size={18} /></span><div><strong>{l.name}</strong><small>{LOCATION_KIND_LABEL[l.kind]}{!l.isActive ? ' • paused' : ''}{readOnly ? ' • managed by clinic' : ''}</small></div></div>
        <p className="adm-small">{l.addressText}</p>
        <div className="fx-row fx-wrap"><ModeBadge mode={l.bookingMode} tokenAmount={l.tokenAmount} /><span className="adm-small">Fee {inr(l.fee)}</span><span className="adm-small adm-muted">{(l.schedule?.days || []).join(', ')} • {(l.schedule?.sessions || []).map(s => `${s.start}–${s.end}`).join(', ')}</span></div>
        <div className="adm-actions fx-mt">
          {l.directionsUrl && <a className="adm-act" href={l.directionsUrl} target="_blank" rel="noopener noreferrer"><Navigation size={13} /> Map</a>}
          {!readOnly && <button className="adm-act adm-act-blue" onClick={() => setEditing(l)}><Pencil size={13} /> Edit</button>}
          {!readOnly && <button className="adm-act" onClick={() => toggle(l)}><Power size={13} /> {l.isActive ? 'Pause' : 'Activate'}</button>}
          {!readOnly && <button className="adm-act adm-act-rose" onClick={() => remove(l)}><Trash2 size={13} /> Remove</button>}
        </div>
      </div>
    );
  };

  return (
    <>
      <PageHeader title="Consultation locations" subtitle="Each location has its own address, timings, fee and booking mode. Patients pick one when booking."
        actions={<button className="btn-primary adm-btn" disabled={atLimit} onClick={() => setEditing('new')} data-testid="add-location"><Plus size={15} /> Add location</button>} />
      {atLimit && <div className="adm-alert adm-alert-info"><Lock size={15} /> Your {doctor.plan?.name} plan allows {limits.maxLocations} active location{limits.maxLocations === 1 ? '' : 's'}. Upgrade to add more.</div>}
      {own.length === 0 && clinicLocs.length === 0 ? (
        <Card><p className="adm-muted">No consultation locations yet. Add your clinic, hospital OP, home visits or online consultations so patients can book.</p></Card>
      ) : (
        <div className="fx-loc-grid">
          {own.map(l => <LocCard key={l.id} l={l} />)}
          {clinicLocs.map(l => <LocCard key={l.id} l={l} readOnly />)}
        </div>
      )}
      <LocationEditor open={Boolean(editing)} location={editing === 'new' ? null : editing} allowOnlinePayments={limits.onlinePayments} planName={doctor.plan?.name} onSave={save} onClose={() => setEditing(null)} />
      {confirmEl}
    </>
  );
}

function Profile({ client, doctor, onChanged }) {
  const toast = useToast();
  const specialities = useSpecialities();
  const [v, setV] = useState(() => pick(doctor, PROFILE_KEYS));
  const [docs, setDocs] = useState(doctor.documents || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reqOpen, setReqOpen] = useState(false);
  const [reqName, setReqName] = useState('');
  useEffect(() => { setDocs(doctor.documents || []); }, [doctor.documents]);
  const limits = doctor.plan?.limits || {};

  const savePhoto = async url => {
    try { const r = await client.put('/doctor-portal/profile', { photo: url }); onChanged(r.doctor); toast.success(url ? 'Photo updated' : 'Photo removed'); } catch (e) { toast.error(e.message); }
  };
  const save = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await client.put('/doctor-portal/profile', v); onChanged(r.doctor); toast.success(r.message); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const requestSpeciality = async () => {
    try { const r = await client.post('/specialities/request', { name: reqName }); toast.success(r.message); setReqOpen(false); setReqName(''); } catch (e) { toast.error(e.message); }
  };

  return (
    <>
      <PageHeader title="Profile" subtitle="This is what patients see. Verified details build trust." />
      <AccountStatusBanner status={doctor.status} reason={doctor.rejectionReason || doctor.statusReason} />
      <Card title="Profile photo">
        <ImageCropUpload value={doctor.photo?.includes('images.unsplash.com') ? '' : doctor.photo} onChange={savePhoto} label="Profile photo" hint="A clear, front-facing photo. Cropped & compressed on your device."
          upload={(blob, name) => client.upload(blob, { purpose: 'doctor_photo' }, name)} />
      </Card>
      <form onSubmit={save}>
        <Card title="Professional details" actions={<button type="button" className="adm-link" onClick={() => setReqOpen(true)}>Speciality missing?</button>}>
          <ErrorNote error={error} />
          <DoctorFields value={v} onChange={setV} specialities={specialities} maxSpecialities={limits.maxSpecialities ?? 2} planName={doctor.plan?.name} />
        </Card>
        <Card title="Contact & tax (private)">
          <div className="fx-grid">
            <label className="adm-field"><span>Email</span><input type="email" value={v.email || ''} onChange={e => setV({ ...v, email: e.target.value })} autoComplete="email" /></label>
            <label className="adm-field"><span>Sector</span><select value={v.sector || 'Private'} onChange={e => setV({ ...v, sector: e.target.value })}><option>Private</option><option>Government</option></select></label>
            <label className="adm-field"><span>GSTIN (optional)</span><input value={v.gstin || ''} onChange={e => setV({ ...v, gstin: e.target.value.toUpperCase() })} maxLength={15} placeholder="For GST invoices" /></label>
            <label className="adm-field"><span>State</span><input value={v.state || ''} onChange={e => setV({ ...v, state: e.target.value })} placeholder="e.g. Kerala" /></label>
          </div>
          <p className="adm-small adm-muted fx-mt">Your mobile number ({doctor.phone}) is never shown publicly.</p>
        </Card>
        <div className="fx-sticky-save"><button className="btn-primary adm-btn" disabled={busy} data-testid="profile-save">{busy && <Loader2 size={15} className="adm-spin" />} Save profile</button></div>
      </form>
      <Card title="Verification documents">
        <p className="adm-small adm-muted" style={{ marginBottom: 10 }}>Optional but recommended: your medical council registration certificate. Visible only to you and the FindADoc verification team.</p>
        <DocumentUpload client={client} documents={docs} onChange={setDocs} />
      </Card>
      <Modal open={reqOpen} title="Request a new speciality" onClose={() => setReqOpen(false)} width={440}
        footer={<><button className="btn-secondary adm-btn" onClick={() => setReqOpen(false)}>Cancel</button><button className="btn-primary adm-btn" disabled={reqName.trim().length < 3} onClick={requestSpeciality}><Send size={14} /> Send request</button></>}>
        <label className="adm-field"><span>Speciality name</span><input value={reqName} onChange={e => setReqName(e.target.value)} placeholder="e.g. Sports Medicine" /></label>
      </Modal>
    </>
  );
}

function Clinics({ client, onChanged }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [error, setError] = useState('');
  const load = useCallback(() => client.get('/doctor-portal/clinics').then(setData).catch(e => setError(e.message)), [client]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return undefined; }
    const t = setTimeout(() => apiFetch(`/api/clinics?search=${encodeURIComponent(q.trim())}`).then(r => setResults(r.clinics.slice(0, 8))).catch(() => {}), 350);
    return () => clearTimeout(t);
  }, [q]);
  const run = async (fn, after) => { try { const r = await fn(); toast.success(r.message); if (r.doctor) onChanged(r.doctor); load(); after?.(); } catch (e) { toast.error(e.message); } };

  if (!data) return <><ErrorNote error={error} />{!error && <div className="fx-center"><Loader2 className="adm-spin" /></div>}</>;
  const joined = new Set(data.affiliations.filter(a => a.isApproved).map(a => a.clinicId));
  return (
    <>
      <PageHeader title="Clinic affiliations" subtitle="Consult at clinics on FindADoc. The clinic manages your fee and timings there, and bookings are visible to both of you." />
      {data.invites.length > 0 && (
        <Card title="Invitations">
          {data.invites.map(i => (
            <div key={i.clinicId} className="fx-list-row">
              <div><strong>{i.clinicName}</strong><small>{i.address}{i.invite?.speciality ? ` • as ${i.invite.speciality}` : ''}</small></div>
              <div className="adm-actions">
                <button className="adm-act adm-act-green" onClick={() => run(() => client.post(`/doctor-portal/clinics/${i.clinicId}/invite/accept`))} data-testid="accept-invite">Accept</button>
                <button className="adm-act adm-act-rose" onClick={() => run(() => client.post(`/doctor-portal/clinics/${i.clinicId}/invite/decline`))}>Decline</button>
              </div>
            </div>
          ))}
        </Card>
      )}
      <Card title="My clinics">
        {data.affiliations.length === 0 ? <p className="adm-muted adm-small">You are not part of any clinic yet.</p> : data.affiliations.map(a => (
          <div key={a.clinicId} className="fx-list-row">
            <div><strong>{a.clinicName}</strong><small>{a.address}{a.location ? ` • ${inr(a.location.fee)} • ${(a.location.schedule?.days || []).join(', ')}` : ''}</small></div>
            <button className="adm-act adm-act-rose" onClick={() => confirm({ title: `Leave ${a.clinicName}?`, danger: true, confirmLabel: 'Leave clinic', message: 'Your clinic location is removed for new bookings. Existing bookings stay.', onConfirm: () => run(() => client.post(`/doctor-portal/clinics/${a.clinicId}/leave`)) })}>Leave</button>
          </div>
        ))}
        {data.requested.length > 0 && <p className="adm-small adm-muted fx-mt">Requests waiting: {data.requested.map(r => r.clinicName).join(', ')}</p>}
      </Card>
      <Card title="Join a clinic">
        <div className="adm-search"><Search size={15} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search clinics by name, area or PIN" /></div>
        {results.map(c => (
          <div key={c.id} className="fx-list-row">
            <div><strong>{c.name}</strong><small>{c.address}</small></div>
            {joined.has(c.id) ? <span className="adm-badge adm-badge-green">Joined</span> : <button className="adm-act adm-act-blue" onClick={() => run(() => client.post(`/doctor-portal/clinics/${c.id}/request`))}>Request to join</button>}
          </div>
        ))}
      </Card>
      {confirmEl}
    </>
  );
}

function Analytics({ client, doctor, go }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const allowed = doctor.plan?.limits?.analytics;
  useEffect(() => { if (allowed) client.get('/doctor-portal/analytics').then(setData).catch(e => setError(e.message)); }, [client, allowed]);
  if (!allowed) return (<><PageHeader title="Analytics" /><Card><p><Lock size={15} /> Booking analytics is part of the Pro and Premium plans.</p><button className="btn-primary adm-btn fx-mt" onClick={() => go('subscription')}><Crown size={14} /> See plans</button></Card></>);
  return <AnalyticsView data={data} error={error} />;
}

export function AnalyticsView({ data, error }) {
  if (error) return <ErrorNote error={error} />;
  if (!data) return <div className="fx-center"><Loader2 className="adm-spin" /></div>;
  const colors = { Confirmed: '#0ea5e9', Completed: '#10b981', Pending: '#f59e0b', Cancelled: '#f43f5e', NoShow: '#94a3b8' };
  return (
    <>
      <PageHeader title="Analytics" subtitle="Last 6 months" />
      <div className="adm-grid-2">
        <Card title="Bookings per month"><BarChart data={data.byMonth.map(m => ({ label: m.month.slice(5), values: { b: m.bookings } }))} series={[{ key: 'b', label: 'Bookings', color: '#0284c7' }]} /></Card>
        <Card title="Online collections (net of refunds)"><BarChart data={data.byMonth.map(m => ({ label: m.month.slice(5), values: { o: m.online } }))} series={[{ key: 'o', label: 'Collected online', color: '#10b981' }]} format={inr} /></Card>
        <Card title="By status"><Donut parts={Object.entries(data.byStatus).filter(([k]) => colors[k]).map(([k, v]) => ({ label: k, value: v, color: colors[k] }))} /></Card>
        <Card title="By location">{data.byLocation.map(l => <div key={l.name} className="fx-list-row"><span>{l.name}</span><strong>{l.n}</strong></div>)}</Card>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function DoctorWorkspace() {
  const tr = useT();
  const [params, setParams] = useSearchParams();
  const [session, setSessionState] = useState(() => getSession('doctor'));
  const [notice, setNotice] = useState('');
  const [proof, setProof] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const tab = params.get('tab') || 'overview';
  const go = useCallback(t => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); n.delete('register'); return n; }), [setParams]);

  const onExpired = useCallback(msg => { setNotice(msg || SESSION_EXPIRED_MSG); setSessionState(null); setData(null); }, []);
  const client = useMemo(() => createClient('doctor', { onExpired, onBlocked: m => { setNotice(m); setSessionState(null); } }), [onExpired]);

  const load = useCallback(() => client.get('/doctor-portal/me').then(r => { setData(r); setError(''); }).catch(e => setError(e.message)), [client]);
  useEffect(() => { if (session) load(); }, [session, load]);

  if (!session) {
    if (proof) return <DoctorRegister proof={proof} onCancel={() => setProof(null)} onDone={r => { setSession('doctor', { token: r.token, user: r.user, role: 'doctor' }); setProof(null); setNotice(''); setSessionState(getSession('doctor')); go('profile'); }} />;
    return <PortalLogin role="doctor" notice={notice} startRegister={params.get('register') === '1'} onLoggedIn={() => { setNotice(''); setSessionState(getSession('doctor')); }} onNeedRegister={setProof} />;
  }
  if (!data) return <div className="fx-center fx-full">{error ? <div><ErrorNote error={error} /><button className="btn-secondary adm-btn" onClick={load}>Retry</button></div> : <Loader2 className="adm-spin" />}</div>;

  const doctor = data.doctor;
  const setDoctor = d => setData(x => ({ ...x, doctor: d }));
  const logout = () => { clearSession('doctor'); setSessionState(null); setData(null); setNotice(''); };
  const nav = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, mobile: true },
    { id: 'bookings', label: 'Bookings', icon: CalendarCheck, badge: data.stats.pending, mobile: true },
    { id: 'queue', label: tr('pq.title'), icon: ListOrdered, mobile: true },
    { id: 'locations', label: 'Locations', icon: MapPin },
    { id: 'profile', label: 'Profile', icon: UserRound },
    { id: 'clinics', label: 'Clinics', icon: Building2, badge: data.stats.invites },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'earnings', label: tr('earn.title'), icon: IndianRupee },
    { id: 'payouts', label: 'Payouts', icon: Wallet },
    { id: 'subscription', label: 'Plan & billing', icon: Crown }
  ];
  let page;
  switch (tab) {
    case 'bookings': page = <><PageHeader title="Bookings" subtitle="Accept requests, complete visits and keep patients informed." /><DoctorBookings client={client} doctor={doctor} onChanged={load} /></>; break;
    case 'queue': page = <QueuePanel client={client} base="/doctor-portal" targets={(doctor.consultationLocations || []).filter(l => l.isActive !== false && l.kind !== 'online').map(l => ({ key: l.id, label: l.name, locationId: l.id }))} />; break;
    case 'earnings': page = <EarningsPanel client={client} base="/doctor-portal" />; break;
    case 'locations': page = <Locations client={client} doctor={doctor} onChanged={setDoctor} />; break;
    case 'profile': page = <Profile client={client} doctor={doctor} onChanged={setDoctor} />; break;
    case 'clinics': page = <Clinics client={client} onChanged={d => { setDoctor(d); load(); }} />; break;
    case 'analytics': page = <Analytics client={client} doctor={doctor} go={go} />; break;
    case 'payouts': page = <><PageHeader title="Payouts" subtitle="Online collections for your own locations are settled to you." /><PayoutRequestPanel client={client} entity={doctor} onChange={load} /></>; break;
    case 'subscription': page = <><PageHeader title="Plan & billing" /><SubscriptionPanel client={client} audience="doctor" entity={doctor} onChanged={load} /></>; break;
    default: page = <Overview doctor={doctor} stats={data.stats} go={go} />;
  }
  return (
    <PortalShell role="doctor" entity={doctor} nav={nav} active={tab} onNav={go} onLogout={logout} client={client}
      onNotification={n => { const m = /tab=(\w+)/.exec(n.link || ''); if (m) go(m[1]); else if (/booking/.test(n.type)) go('bookings'); else if (/affiliation|invite/.test(n.type)) go('clinics'); else if (/plan|subscription/.test(n.type)) go('subscription'); else if (/status|document/.test(n.type)) { load(); go('overview'); } }}>
      {tab !== 'profile' && <AccountStatusBanner status={doctor.status} reason={doctor.rejectionReason || doctor.statusReason} />}
      {page}
    </PortalShell>
  );
}

export default function DoctorApp() {
  return <ToastProvider><DoctorWorkspace /></ToastProvider>;
}
