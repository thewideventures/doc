import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard, CalendarCheck, Users, Building2, BarChart3, Wallet, Crown, Loader2, Plus, Pencil, Trash2, UserPlus,
  Stethoscope, Check, X, Lock, AlertCircle, ImagePlus, Clock, Mail, ExternalLink
} from 'lucide-react';
import { ToastProvider, useToast, useConfirm, Card, KpiCard, ErrorNote, PageHeader, Modal } from '../admin/ui';
import { createClient, getSession, setSession, clearSession, apiFetch, inr, fmtDate, fmtTime, WEEKDAYS, SESSION_EXPIRED_MSG } from '../lib/api';
import { compressImage } from '../lib/image';
import PortalShell from '../portal/PortalShell';
import PortalLogin from '../portal/PortalLogin';
import BookingsPanel from '../portal/BookingsPanel';
import SubscriptionPanel from '../portal/SubscriptionPanel';
import ScheduleEditor, { DEFAULT_SCHEDULE } from '../portal/ScheduleEditor';
import { FeeModeFields } from '../portal/LocationEditor';
import { TagInput, LANGUAGES } from '../portal/fields';
import MapPicker, { AddressFields, mergeAddress } from '../components/MapPicker';
import ImageCropUpload from '../components/ImageCropUpload';
import AccountStatusBanner from '../components/AccountStatusBanner';
import PayoutRequestPanel from '../components/PayoutRequestPanel';
import { ModeBadge } from '../components/BookingModal';
import { AnalyticsView } from './DoctorApp';

const FACILITIES = ['Pharmacy', 'Laboratory', 'X-Ray', 'Ultrasound', 'ECG', 'Parking', 'Wheelchair access', 'Ambulance', 'Emergency 24x7', 'ICU', 'Cafeteria', 'Insurance / cashless', 'Wi-Fi'];

function useSpecialities() {
  const [list, setList] = useState([]);
  useEffect(() => { apiFetch('/api/specialities').then(r => setList(r.specialities.map(s => s.name))).catch(() => {}); }, []);
  return list;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
function ClinicRegister({ proof, onDone, onCancel }) {
  const [v, setV] = useState({ name: '', type: 'Multi-Speciality Clinic', sector: 'Private', address: {}, lat: null, lng: null, facilities: [], email: '', gstin: '', about: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { onDone(await apiFetch('/api/clinics/register', { method: 'POST', token: proof.phoneToken, body: v })); }
    catch (err) { setError(err.message); if (err.status === 401) onCancel(); } finally { setBusy(false); }
  };
  return (
    <div className="fx-auth fx-portal-clinic">
      <form className="fx-auth-card fx-auth-wide" onSubmit={submit}>
        <PageHeader title="Register your clinic" subtitle={`Phone ${proof.phone} verified. Your clinic is listed after FindADoc verification.`} />
        {error && <div className="adm-alert adm-alert-error"><AlertCircle size={16} /> {error}</div>}
        <div className="fx-grid">
          <label className="adm-field"><span>Clinic / hospital name *</span><input value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></label>
          <label className="adm-field"><span>Type</span><select value={v.type} onChange={e => setV({ ...v, type: e.target.value })}>{['Multi-Speciality Clinic', 'Single-Speciality Clinic', 'Hospital', 'Polyclinic', 'Diagnostic Centre', 'Dental Clinic', 'Eye Clinic'].map(t => <option key={t}>{t}</option>)}</select></label>
          <label className="adm-field"><span>Sector</span><select value={v.sector} onChange={e => setV({ ...v, sector: e.target.value })}><option>Private</option><option>Government</option></select></label>
          <label className="adm-field"><span>Email</span><input type="email" value={v.email} onChange={e => setV({ ...v, email: e.target.value })} /></label>
        </div>
        <MapPicker value={v.lat ? { lat: v.lat, lng: v.lng } : null} label="Pin your clinic entrance" onChange={(p, found) => setV(x => ({ ...x, lat: p.lat, lng: p.lng, address: mergeAddress(x.address, found) }))} />
        <AddressFields value={v.address} onChange={address => setV({ ...v, address })} />
        <div className="adm-field"><span>Facilities</span><TagInput value={v.facilities} onChange={facilities => setV({ ...v, facilities })} suggestions={FACILITIES} placeholder="Add facility" max={30} /></div>
        <label className="adm-field"><span>GSTIN (optional)</span><input value={v.gstin} maxLength={15} onChange={e => setV({ ...v, gstin: e.target.value.toUpperCase() })} /></label>
        <div className="fx-row fx-between">
          <button type="button" className="btn-secondary adm-btn" onClick={onCancel}>Back</button>
          <button className="btn-primary adm-btn" disabled={busy}>{busy && <Loader2 size={15} className="adm-spin" />} Submit for verification</button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Doctors
// ---------------------------------------------------------------------------
function ScheduleModal({ open, doctor, client, limits, specialities, onClose, onSaved }) {
  const toast = useToast();
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || !doctor) return;
    const l = doctor.clinicLocation || {};
    setV({ speciality: doctor.speciality, fee: l.fee ?? doctor.consultationFee ?? 500, bookingMode: l.bookingMode || 'free', tokenAmount: l.tokenAmount || 100, autoConfirm: l.autoConfirm !== false, isActive: l.isActive !== false, schedule: l.schedule?.days ? l.schedule : DEFAULT_SCHEDULE });
    setError(''); setBusy(false);
  }, [open, doctor]);
  if (!open || !v) return null;
  const save = async () => {
    setBusy(true); setError('');
    try { const r = await client.put(`/clinic-portal/doctors/${doctor.id}`, { ...v, fee: Number(v.fee), tokenAmount: Number(v.tokenAmount) }); toast.success(r.message); onSaved(); onClose(); }
    catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal open title={`Schedule & fee — ${doctor.name}`} onClose={busy ? undefined : onClose} width={720}
      footer={<><button className="btn-secondary adm-btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary adm-btn" onClick={save} disabled={busy} data-testid="schedule-save">{busy && <Loader2 size={15} className="adm-spin" />} Save</button></>}>
      <div className="adm-form">
        <ErrorNote error={error} />
        <label className="adm-field"><span>Department / speciality at your clinic</span>
          <input list="fx-specs" value={v.speciality} onChange={e => setV({ ...v, speciality: e.target.value })} />
          <datalist id="fx-specs">{specialities.map(s => <option key={s} value={s} />)}</datalist>
        </label>
        <FeeModeFields value={v} onChange={p => setV({ ...v, ...p })} allowOnlinePayments={limits.onlinePayments} planName={limits.plan} />
        <label className="adm-check" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={v.autoConfirm} onChange={e => setV({ ...v, autoConfirm: e.target.checked })} /> Auto-confirm online bookings</label>
        <label className="adm-check" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={v.isActive} onChange={e => setV({ ...v, isActive: e.target.checked })} /> Accepting bookings at the clinic</label>
        <ScheduleEditor value={v.schedule} onChange={schedule => setV({ ...v, schedule })} />
      </div>
    </Modal>
  );
}

function AddDoctorModal({ open, client, specialities, onClose, onDone }) {
  const toast = useToast();
  const [mode, setMode] = useState('invite');
  const [inv, setInv] = useState({ by: 'phone', phone: '', doctorId: '', speciality: '' });
  const [nd, setNd] = useState({ name: '', phone: '', qualifications: '', registrationNumber: '', councilName: '', speciality: '', experienceYears: '', fee: 500, gender: '', languages: ['English'], photo: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setError(''); setBusy(false); } }, [open]);
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const r = mode === 'invite'
        ? await client.post('/clinic-portal/doctors/invite', { speciality: inv.speciality, ...(inv.by === 'phone' ? { phone: inv.phone } : { doctorId: inv.doctorId.trim() }) })
        : await client.post('/clinic-portal/doctors/create', { ...nd, experienceYears: Number(nd.experienceYears) || 0, fee: Number(nd.fee) });
      toast.success(r.message); onDone(); onClose();
    } catch (e) {
      setError(e.message);
      if (e.code === 'DOCTOR_NOT_FOUND') { setMode('create'); setNd(x => ({ ...x, phone: inv.phone, speciality: inv.speciality })); }
      setBusy(false);
    }
  };
  const specList = <datalist id="fx-specs2">{specialities.map(s => <option key={s} value={s} />)}</datalist>;
  return (
    <Modal open={open} title="Add a doctor" onClose={busy ? undefined : onClose} width={640}
      footer={<><button className="btn-secondary adm-btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary adm-btn" onClick={submit} disabled={busy} data-testid="add-doctor-submit">{busy && <Loader2 size={15} className="adm-spin" />} {mode === 'invite' ? 'Send invite' : 'Create profile'}</button></>}>
      <div className="adm-form">
        <div className="fx-seg" role="tablist">
          <button type="button" className={mode === 'invite' ? 'on' : ''} onClick={() => setMode('invite')}>Invite existing doctor</button>
          <button type="button" className={mode === 'create' ? 'on' : ''} onClick={() => setMode('create')}>Create new profile</button>
        </div>
        <ErrorNote error={error} />
        {specList}
        {mode === 'invite' ? (
          <>
            <div className="fx-seg fx-seg-sm">
              <button type="button" className={inv.by === 'phone' ? 'on' : ''} onClick={() => setInv({ ...inv, by: 'phone' })}>By mobile</button>
              <button type="button" className={inv.by === 'id' ? 'on' : ''} onClick={() => setInv({ ...inv, by: 'id' })}>By FindADoc ID</button>
            </div>
            {inv.by === 'phone'
              ? <label className="adm-field"><span>Doctor's mobile number</span><input inputMode="numeric" value={inv.phone} onChange={e => setInv({ ...inv, phone: e.target.value })} placeholder="10-digit mobile" /></label>
              : <label className="adm-field"><span>Doctor ID</span><input value={inv.doctorId} onChange={e => setInv({ ...inv, doctorId: e.target.value })} placeholder="e.g. doc-1a2b3c" /></label>}
            <label className="adm-field"><span>Department / speciality *</span><input list="fx-specs2" value={inv.speciality} onChange={e => setInv({ ...inv, speciality: e.target.value })} /></label>
            <p className="adm-small adm-muted">The doctor gets an invitation in their portal. Once they accept you can set their schedule & fee.</p>
          </>
        ) : (
          <>
            <div className="fx-grid">
              <label className="adm-field"><span>Full name *</span><input value={nd.name} onChange={e => setNd({ ...nd, name: e.target.value })} /></label>
              <label className="adm-field"><span>Mobile (doctor signs in with it) *</span><input inputMode="numeric" value={nd.phone} onChange={e => setNd({ ...nd, phone: e.target.value })} /></label>
              <label className="adm-field"><span>Qualifications *</span><input value={nd.qualifications} onChange={e => setNd({ ...nd, qualifications: e.target.value })} placeholder="MBBS, MD" /></label>
              <label className="adm-field"><span>Registration number *</span><input value={nd.registrationNumber} onChange={e => setNd({ ...nd, registrationNumber: e.target.value.toUpperCase() })} /></label>
              <label className="adm-field"><span>Department / speciality *</span><input list="fx-specs2" value={nd.speciality} onChange={e => setNd({ ...nd, speciality: e.target.value })} /></label>
              <label className="adm-field"><span>Experience (years)</span><input type="number" min="0" max="70" value={nd.experienceYears} onChange={e => setNd({ ...nd, experienceYears: e.target.value })} /></label>
              <label className="adm-field"><span>Fee at clinic (₹)</span><input type="number" min="0" value={nd.fee} onChange={e => setNd({ ...nd, fee: e.target.value })} /></label>
              <label className="adm-field"><span>Gender</span><select value={nd.gender} onChange={e => setNd({ ...nd, gender: e.target.value })}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
            </div>
            <div className="adm-field"><span>Languages</span><TagInput value={nd.languages} onChange={languages => setNd({ ...nd, languages })} suggestions={LANGUAGES} /></div>
            <ImageCropUpload value={nd.photo} onChange={photo => setNd({ ...nd, photo })} label="Doctor photo" upload={(blob, name) => client.upload(blob, { purpose: 'doctor_photo' }, name)} />
            <p className="fx-note fx-note-info adm-small"><Lock size={13} /> New doctor profiles are verified by FindADoc before patients can book them.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

function Doctors({ client, clinic, onChanged }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const specialities = useSpecialities();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => client.get('/clinic-portal/doctors').then(d => { setData(d); setError(''); }).catch(e => setError(e.message)), [client]);
  useEffect(() => { load(); }, [load]);
  const run = async fn => { try { const r = await fn(); toast.success(r.message); load(); onChanged?.(); } catch (e) { toast.error(e.message); } };
  if (!data) return <><ErrorNote error={error} />{!error && <div className="fx-center"><Loader2 className="adm-spin" /></div>}</>;
  const { limits } = data;
  const atLimit = limits.maxDoctors !== -1 && limits.used >= limits.maxDoctors;

  return (
    <>
      <PageHeader title="Doctors" subtitle={`${limits.used} of ${limits.maxDoctors === -1 ? 'unlimited' : limits.maxDoctors} doctors on your ${limits.plan} plan`}
        actions={<button className="btn-primary adm-btn" onClick={() => setAdding(true)} disabled={atLimit} data-testid="add-doctor"><UserPlus size={15} /> Add doctor</button>} />
      {atLimit && <div className="adm-alert adm-alert-info"><Lock size={15} /> Doctor limit reached for the {limits.plan} plan. Upgrade to add more doctors.</div>}
      {data.requests.length > 0 && (
        <Card title="Join requests">
          {data.requests.map(r => (
            <div key={r.doctorId} className="fx-list-row">
              <div className="adm-name-cell"><img src={r.photo} alt="" /><div><strong>{r.name}</strong><small>{r.qualifications} • {(r.specialities || []).join(', ')}</small></div></div>
              <div className="adm-actions">
                <button className="adm-act adm-act-green" disabled={atLimit} onClick={() => run(() => client.post(`/clinic-portal/doctors/requests/${r.doctorId}/approve`, { speciality: r.specialities?.[0] }))}><Check size={13} /> Approve</button>
                <button className="adm-act adm-act-rose" onClick={() => run(() => client.post(`/clinic-portal/doctors/requests/${r.doctorId}/reject`))}><X size={13} /> Decline</button>
              </div>
            </div>
          ))}
        </Card>
      )}
      {data.invites.length > 0 && (
        <Card title="Pending invitations">
          {data.invites.map(i => (
            <div key={i.id} className="fx-list-row">
              <div><strong>{i.doctorName}</strong><small>{i.phone} • {i.speciality} • waiting for the doctor to accept</small></div>
              <button className="adm-act" onClick={() => run(() => client.del(`/clinic-portal/doctors/invites/${i.id}`))}>Cancel invite</button>
            </div>
          ))}
        </Card>
      )}
      {data.groups.length === 0 ? <Card><p className="adm-muted">No doctors yet. Invite doctors already on FindADoc or create their profile.</p></Card> : data.groups.map(g => (
        <Card key={g.speciality} title={<><Stethoscope size={16} /> {g.speciality} <span className="adm-tab-count">{g.doctors.length}</span></>}>
          <div className="fx-doc-grid">
            {g.doctors.map(d => (
              <div key={d.id} className="fx-doc-tile">
                <div className="adm-name-cell"><img src={d.photo} alt="" /><div><strong>{d.name}</strong><small>{d.qualifications}</small></div></div>
                <div className="fx-row fx-wrap">
                  {d.status !== 'active' && <span className="adm-badge adm-badge-amber">{d.status === 'pending' ? 'Pending verification' : d.status}</span>}
                  {d.clinicLocation ? <><ModeBadge mode={d.clinicLocation.bookingMode} tokenAmount={d.clinicLocation.tokenAmount} /><span className="adm-small">{inr(d.clinicLocation.fee)}</span></> : <span className="adm-badge adm-badge-slate">No schedule</span>}
                </div>
                {d.clinicLocation?.schedule && <small className="adm-muted"><Clock size={12} /> {(d.clinicLocation.schedule.days || []).join(', ')} • {(d.clinicLocation.schedule.sessions || []).map(s => `${s.start}–${s.end}`).join(', ')}</small>}
                <div className="adm-actions">
                  <button className="adm-act adm-act-blue" onClick={() => setEditing(d)} data-testid="edit-schedule"><Pencil size={13} /> Schedule & fee</button>
                  <button className="adm-act adm-act-rose" onClick={() => confirm({ title: `Remove ${d.name}?`, danger: true, confirmLabel: 'Remove', message: 'New bookings at your clinic stop. Existing bookings stay valid.', onConfirm: () => run(() => client.del(`/clinic-portal/doctors/${d.id}`)) })}><Trash2 size={13} /> Remove</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
      <AddDoctorModal open={adding} client={client} specialities={specialities} onClose={() => setAdding(false)} onDone={() => { load(); onChanged?.(); }} />
      <ScheduleModal open={Boolean(editing)} doctor={editing} client={client} limits={limits} specialities={specialities} onClose={() => setEditing(null)} onSaved={load} />
      {confirmEl}
    </>
  );
}

// ---------------------------------------------------------------------------
// Walk-in / phone booking by clinic staff
// ---------------------------------------------------------------------------
function WalkInModal({ open, client, onClose, onDone }) {
  const toast = useToast();
  const [doctors, setDoctors] = useState([]);
  const [doctorId, setDoctorId] = useState('');
  const [av, setAv] = useState(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [p, setP] = useState({ patientName: '', patientPhone: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setError(''); setTime(''); setAv(null); setP({ patientName: '', patientPhone: '', note: '' });
    client.get('/clinic-portal/doctors').then(d => { const list = d.items.filter(x => x.status === 'active' && x.clinicLocation?.isActive); setDoctors(list); setDoctorId(list[0]?.id || ''); }).catch(e => setError(e.message));
  }, [open, client]);
  const loadAv = useCallback((id, d) => {
    if (!id) return;
    setTime('');
    client.get(`/clinic-portal/doctors/${id}/availability`, d ? { date: d } : undefined).then(r => { setAv(r); setDate(r.date || ''); setError(''); }).catch(e => { setAv(null); setError(e.message); });
  }, [client]);
  useEffect(() => { if (open && doctorId) loadAv(doctorId); }, [open, doctorId, loadAv]);
  const submit = async () => {
    setBusy(true); setError('');
    try { const r = await client.post('/clinic-portal/bookings', { doctorId, date, time, ...p }); toast.success(r.message); onDone(); onClose(); }
    catch (e) { setError(e.message); if (e.code === 'SLOT_TAKEN') loadAv(doctorId, date); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} title="New booking (walk-in / phone)" onClose={busy ? undefined : onClose} width={640}
      footer={<><button className="btn-secondary adm-btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary adm-btn" disabled={busy || !time || !p.patientName || !p.patientPhone} onClick={submit} data-testid="walkin-submit">{busy && <Loader2 size={15} className="adm-spin" />} Book {time ? fmtTime(time) : ''}</button></>}>
      <div className="adm-form">
        <ErrorNote error={error} />
        {doctors.length === 0 ? <p className="adm-muted">No active doctors with a clinic schedule yet. Add doctors and set their schedule first.</p> : (
          <>
            <label className="adm-field"><span>Doctor</span><select value={doctorId} onChange={e => setDoctorId(e.target.value)}>{doctors.map(d => <option key={d.id} value={d.id}>{d.name} — {d.speciality}</option>)}</select></label>
            {av && (
              <>
                <div className="fx-date-strip">
                  {av.dates.map(d => <button type="button" key={d} className={`fx-date ${d === date ? 'on' : ''}`} onClick={() => loadAv(doctorId, d)}><small>{fmtDate(d)}</small></button>)}
                </div>
                <div className="fx-slots">
                  {(av.slots || []).map(s => <button type="button" key={s.time} disabled={!s.available} className={`fx-slot ${time === s.time ? 'on' : ''}`} onClick={() => setTime(s.time)}>{fmtTime(s.time)}</button>)}
                  {!(av.slots || []).some(s => s.available) && <p className="adm-muted adm-small">{av.reason || 'No free slots on this day.'}</p>}
                </div>
              </>
            )}
            <div className="fx-grid">
              <label className="adm-field"><span>Patient name *</span><input value={p.patientName} onChange={e => setP({ ...p, patientName: e.target.value })} /></label>
              <label className="adm-field"><span>Patient mobile *</span><input inputMode="numeric" value={p.patientPhone} onChange={e => setP({ ...p, patientPhone: e.target.value })} /></label>
            </div>
            <label className="adm-field"><span>Note</span><input value={p.note} onChange={e => setP({ ...p, note: e.target.value })} /></label>
            <p className="adm-small adm-muted">Walk-in bookings are pay-at-clinic and appear for the doctor too.</p>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Clinic profile
// ---------------------------------------------------------------------------
function ClinicProfile({ client, clinic, onChanged }) {
  const toast = useToast();
  const lat = clinic.lat, lng = clinic.lng;
  const [v, setV] = useState(() => ({
    name: clinic.name, type: clinic.type || '', sector: clinic.sector || 'Private', about: clinic.about || '', website: clinic.website || '', email: clinic.email || '', gstin: clinic.gstin || '',
    facilities: clinic.facilities || [], address: clinic.addressDetails || {}, lat, lng, is24x7: Boolean(clinic.is24x7),
    timings: WEEKDAYS.map(day => (clinic.timings || []).find(t => t.day === day) || { day, open: '09:00', close: '20:00', closed: day === 'Sun' })
  }));
  const [busy, setBusy] = useState(false);
  const [gBusy, setGBusy] = useState(false);
  const [error, setError] = useState('');
  const gLimit = clinic.plan?.limits?.maxGalleryImages ?? 3;
  const gallery = clinic.gallery || [];

  const patch = async (body, msg) => { const r = await client.put('/clinic-portal/profile', body); onChanged(r.clinic); toast.success(msg || r.message); return r; };
  const save = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { await patch({ ...v, lat: v.lat || undefined, lng: v.lng || undefined }); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const addGallery = async e => {
    const files = [...(e.target.files || [])]; e.target.value = '';
    if (!files.length) return;
    setGBusy(true);
    try {
      const urls = [...gallery];
      for (const f of files) {
        if (gLimit !== -1 && urls.length >= gLimit) { toast.error(`Your ${clinic.plan?.name} plan allows ${gLimit} gallery photos.`); break; }
        const out = await compressImage(f, { maxSize: 1600 });
        const r = await client.upload(out.blob, { purpose: 'clinic_gallery' }, `gallery.${out.ext}`);
        urls.push(r.url);
      }
      await patch({ gallery: urls }, 'Gallery updated');
    } catch (err) { toast.error(err.message); } finally { setGBusy(false); }
  };
  const setT = (i, k, val) => setV(x => ({ ...x, timings: x.timings.map((t, j) => (j === i ? { ...t, [k]: val } : t)) }));

  return (
    <>
      <PageHeader title="Clinic profile" subtitle="Shown on your public clinic page and on every doctor's clinic location." />
      <Card title="Logo">
        <ImageCropUpload value={clinic.photo} onChange={url => patch({ photo: url }, url ? 'Logo updated' : 'Logo removed').catch(err => toast.error(err.message))} label="Clinic logo" shape="square" hint="Square logo, cropped on your device." upload={(blob, name) => client.upload(blob, { purpose: 'clinic_logo' }, name)} />
      </Card>
      <Card title={`Gallery (${gallery.length}/${gLimit === -1 ? '∞' : gLimit})`} actions={
        <label className={`btn-secondary adm-btn adm-btn-sm ${gBusy || (gLimit !== -1 && gallery.length >= gLimit) ? 'disabled' : ''}`}>
          {gBusy ? <Loader2 size={14} className="adm-spin" /> : <ImagePlus size={14} />} Add photos
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={addGallery} disabled={gBusy || (gLimit !== -1 && gallery.length >= gLimit)} />
        </label>}>
        {gallery.length === 0 ? <p className="adm-muted adm-small">Add photos of your reception, consultation rooms and facilities.</p> : (
          <div className="fx-gallery">
            {gallery.map(u => <div key={u}><img src={u} alt="Clinic" loading="lazy" /><button className="adm-icon-btn" aria-label="Remove photo" onClick={() => patch({ gallery: gallery.filter(x => x !== u) }, 'Photo removed').catch(err => toast.error(err.message))}><Trash2 size={14} /></button></div>)}
          </div>
        )}
      </Card>
      <form onSubmit={save}>
        <Card title="Details">
          <ErrorNote error={error} />
          <div className="fx-grid">
            <label className="adm-field"><span>Name *</span><input value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></label>
            <label className="adm-field"><span>Type</span><input value={v.type} onChange={e => setV({ ...v, type: e.target.value })} /></label>
            <label className="adm-field"><span>Website</span><input value={v.website} onChange={e => setV({ ...v, website: e.target.value })} placeholder="https://" /></label>
            <label className="adm-field"><span>Email</span><input type="email" value={v.email} onChange={e => setV({ ...v, email: e.target.value })} /></label>
            <label className="adm-field"><span>GSTIN</span><input value={v.gstin} maxLength={15} onChange={e => setV({ ...v, gstin: e.target.value.toUpperCase() })} /></label>
            <label className="adm-field"><span>Sector</span><select value={v.sector} onChange={e => setV({ ...v, sector: e.target.value })}><option>Private</option><option>Government</option></select></label>
          </div>
          <label className="adm-field fx-mt"><span>About</span><textarea rows={3} maxLength={2000} value={v.about} onChange={e => setV({ ...v, about: e.target.value })} /></label>
          <div className="adm-field fx-mt"><span>Facilities</span><TagInput value={v.facilities} onChange={facilities => setV({ ...v, facilities })} suggestions={FACILITIES} max={30} /></div>
        </Card>
        <Card title="Location">
          <MapPicker value={v.lat ? { lat: v.lat, lng: v.lng } : null} label="Clinic entrance" onChange={(pt, found) => setV(x => ({ ...x, lat: pt.lat, lng: pt.lng, address: mergeAddress(x.address, found) }))} />
          <AddressFields value={v.address} onChange={address => setV({ ...v, address })} />
          <p className="adm-small adm-muted fx-mt">Changing the address or pin also updates the clinic location of every doctor here.</p>
        </Card>
        <Card title="Opening hours">
          <label className="adm-check" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={v.is24x7} onChange={e => setV({ ...v, is24x7: e.target.checked })} /> Open 24 × 7</label>
          {!v.is24x7 && (
            <div className="fx-timings">
              {v.timings.map((t, i) => (
                <div key={t.day} className="fx-row">
                  <strong className="fx-day-label">{t.day}</strong>
                  <label className="adm-check"><input type="checkbox" checked={!t.closed} onChange={e => setT(i, 'closed', !e.target.checked)} /> Open</label>
                  {!t.closed && <><input type="time" className="adm-select" value={t.open || ''} onChange={e => setT(i, 'open', e.target.value)} aria-label={`${t.day} opens`} /><span>–</span><input type="time" className="adm-select" value={t.close || ''} onChange={e => setT(i, 'close', e.target.value)} aria-label={`${t.day} closes`} /></>}
                </div>
              ))}
            </div>
          )}
        </Card>
        <div className="fx-sticky-save"><button className="btn-primary adm-btn" disabled={busy}>{busy && <Loader2 size={15} className="adm-spin" />} Save clinic profile</button></div>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
function ClinicWorkspace() {
  const [params, setParams] = useSearchParams();
  const [session, setSessionState] = useState(() => getSession('clinic'));
  const [notice, setNotice] = useState('');
  const [proof, setProof] = useState(null);
  const [data, setData] = useState(null);
  const [doctors, setDoctors] = useState([]);
  const [error, setError] = useState('');
  const [walkIn, setWalkIn] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [analytics, setAnalytics] = useState(null);
  const [aErr, setAErr] = useState('');
  const tab = params.get('tab') || 'overview';
  const go = useCallback(t => setParams(p => { const n = new URLSearchParams(p); n.set('tab', t); n.delete('register'); return n; }), [setParams]);
  const onExpired = useCallback(msg => { setNotice(msg || SESSION_EXPIRED_MSG); setSessionState(null); setData(null); }, []);
  const client = useMemo(() => createClient('clinic', { onExpired, onBlocked: m => { setNotice(m); setSessionState(null); } }), [onExpired]);
  const load = useCallback(() => {
    client.get('/clinic-portal/me').then(r => { setData(r); setError(''); }).catch(e => setError(e.message));
    client.get('/clinic-portal/doctors').then(r => setDoctors(r.items)).catch(() => {});
  }, [client]);
  useEffect(() => { if (session) load(); }, [session, load]);
  useEffect(() => {
    if (tab === 'analytics' && data?.clinic?.plan?.limits?.analytics) client.get('/clinic-portal/analytics').then(setAnalytics).catch(e => setAErr(e.message));
  }, [tab, data?.clinic?.plan?.limits?.analytics, client]);

  if (!session) {
    if (proof) return <ClinicRegister proof={proof} onCancel={() => setProof(null)} onDone={r => { setSession('clinic', { token: r.token, user: r.user, role: 'clinic' }); setProof(null); setSessionState(getSession('clinic')); go('profile'); }} />;
    return <PortalLogin role="clinic" notice={notice} startRegister={params.get('register') === '1'} onLoggedIn={() => { setNotice(''); setSessionState(getSession('clinic')); }} onNeedRegister={setProof} />;
  }
  if (!data) return <div className="fx-center fx-full">{error ? <div><ErrorNote error={error} /><button className="btn-secondary adm-btn" onClick={load}>Retry</button></div> : <Loader2 className="adm-spin" />}</div>;

  const { clinic, stats } = data;
  const setClinic = c => setData(x => ({ ...x, clinic: c }));
  const logout = () => { clearSession('clinic'); setSessionState(null); setData(null); };
  const nav = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard, mobile: true },
    { id: 'bookings', label: 'Bookings', icon: CalendarCheck, mobile: true },
    { id: 'doctors', label: 'Doctors', icon: Users, badge: stats.requests, mobile: true },
    { id: 'profile', label: 'Clinic profile', icon: Building2 },
    { id: 'analytics', label: 'Analytics', icon: BarChart3 },
    { id: 'payouts', label: 'Payouts', icon: Wallet },
    { id: 'subscription', label: 'Plan & billing', icon: Crown }
  ];
  const clinicLocations = [];
  let page;
  switch (tab) {
    case 'bookings':
      page = (<>
        <PageHeader title="Bookings" subtitle="All bookings for doctors at your clinic. Doctors see them in their portal too." actions={<button className="btn-primary adm-btn" onClick={() => setWalkIn(true)} disabled={clinic.status !== 'active'} data-testid="walkin-open"><Plus size={15} /> New booking</button>} />
        <BookingsPanel client={client} base="/clinic-portal" showDoctor doctors={doctors} locations={clinicLocations} refreshKey={refresh} onChanged={load} />
        <WalkInModal open={walkIn} client={client} onClose={() => setWalkIn(false)} onDone={() => { setRefresh(n => n + 1); load(); }} />
      </>); break;
    case 'doctors': page = <Doctors client={client} clinic={clinic} onChanged={load} />; break;
    case 'profile': page = <ClinicProfile client={client} clinic={clinic} onChanged={setClinic} />; break;
    case 'analytics': page = clinic.plan?.limits?.analytics ? <AnalyticsView data={analytics} error={aErr} /> : <><PageHeader title="Analytics" /><Card><p><Lock size={15} /> Analytics is part of the Pro and Premium clinic plans.</p><button className="btn-primary adm-btn fx-mt" onClick={() => go('subscription')}><Crown size={14} /> See plans</button></Card></>; break;
    case 'payouts': page = <><PageHeader title="Payouts" subtitle="Online collections for bookings at your clinic are settled to the clinic." /><PayoutRequestPanel client={client} entity={clinic} accent="#7c3aed" onChange={load} /></>; break;
    case 'subscription': page = <><PageHeader title="Plan & billing" /><SubscriptionPanel client={client} audience="clinic" entity={clinic} onChanged={load} /></>; break;
    default:
      page = (<>
        <PageHeader title={clinic.name} subtitle={clinic.status === 'active' ? 'Your clinic is live on FindADoc.' : 'Set up your clinic while we verify it.'}
          actions={clinic.status === 'active' && <button className="btn-primary adm-btn adm-btn-sm" onClick={() => { go('bookings'); setWalkIn(true); }}><Plus size={14} /> New booking</button>} />
        <div className="adm-kpi-grid">
          <KpiCard icon={CalendarCheck} label="Today" value={stats.today} sub="appointments" tone="blue" onClick={() => go('bookings')} />
          <KpiCard icon={CalendarCheck} label="Upcoming" value={stats.upcoming} tone="teal" onClick={() => go('bookings')} />
          <KpiCard icon={Users} label="Doctors" value={`${stats.doctors}${clinic.plan?.limits?.maxDoctors > 0 ? ` / ${clinic.plan.limits.maxDoctors}` : ''}`} tone="purple" onClick={() => go('doctors')} />
          <KpiCard icon={Mail} label="Join requests" value={stats.requests} sub={`${stats.invites} invites pending`} tone="amber" onClick={() => go('doctors')} />
          <KpiCard icon={Wallet} label="Available payout" value={inr(clinic.claimPendingFee)} tone="green" onClick={() => go('payouts')} />
        </div>
        <Card title="Getting set up">
          <ul className="fx-checklist">
            {[
              ['Logo uploaded', Boolean(clinic.photo), 'profile'],
              ['Map pin & full address', Boolean(clinic.lat && clinic.addressDetails?.city), 'profile'],
              ['Opening hours', (clinic.timings || []).length > 0 || clinic.is24x7, 'profile'],
              ['At least one doctor with a schedule', doctors.some(d => d.clinicLocation), 'doctors']
            ].map(([label, done, t]) => <li key={label} className={done ? 'done' : ''}>{done ? <Check size={16} /> : <Clock size={16} />}<span>{label}</span>{!done && <button className="adm-link" onClick={() => go(t)}>Set up</button>}</li>)}
          </ul>
        </Card>
        {clinic.status === 'active' && <a className="adm-link" href={`/?clinic=${clinic.id}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> See doctors at your clinic as patients do</a>}
      </>);
  }
  return (
    <PortalShell role="clinic" entity={clinic} nav={nav} active={tab} onNav={go} onLogout={logout} client={client}
      onNotification={n => { const m = /tab=(\w+)/.exec(n.link || ''); if (m) go(m[1]); else if (/booking/.test(n.type)) go('bookings'); else if (/affiliation|invite/.test(n.type)) go('doctors'); else if (/plan|subscription/.test(n.type)) go('subscription'); else load(); }}>
      {tab !== 'profile' && <AccountStatusBanner status={clinic.status} reason={clinic.rejectionReason || clinic.statusReason} kind="clinic" />}
      {page}
    </PortalShell>
  );
}

export default function ClinicApp() {
  return <ToastProvider><ClinicWorkspace /></ToastProvider>;
}
