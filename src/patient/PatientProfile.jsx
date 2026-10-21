import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, Users, UserRound, MapPin } from 'lucide-react';
import { Card, Modal, ErrorNote, useToast, useConfirm } from '../admin/ui';
import ImageCropUpload from '../components/ImageCropUpload';
import MapPicker, { AddressFields, mergeAddress } from '../components/MapPicker';
import { useT, enumLabel } from '../i18n';

const RELATIONS = ['spouse', 'child', 'parent', 'sibling', 'grandparent', 'other'];
export const ageFrom = dob => {
  if (!dob) return '';
  const d = new Date(`${dob}T00:00:00`); const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a >= 0 ? a : '';
};
const dobFromAge = age => { const y = new Date().getFullYear() - Number(age); return Number(age) >= 0 && Number(age) < 120 ? `${y}-01-01` : ''; };

function MemberModal({ open, member, onSave, onClose, client }) {
  const t = useT();
  const [v, setV] = useState({ name: '', relation: 'child', gender: '', dob: '', photo: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setV(member ? { photo: '', ...member, relation: RELATIONS.includes(String(member.relation || '').toLowerCase()) ? String(member.relation).toLowerCase() : 'other' } : { name: '', relation: 'child', gender: '', dob: '', photo: '' }); setError(''); setBusy(false); } }, [open, member]);
  const save = async () => { setBusy(true); setError(''); try { await onSave(v); onClose(); } catch (e) { setError(e.message); setBusy(false); } };
  return (
    <Modal open={open} title={member ? t('fam.edit') : t('fam.add')} onClose={busy ? undefined : onClose} width={480}
      footer={<><button className="btn-secondary adm-btn" onClick={onClose} disabled={busy}>{t('common.cancel')}</button><button className="btn-primary adm-btn" onClick={save} disabled={busy || v.name.trim().length < 2}>{busy && <Loader2 size={15} className="adm-spin" />} {t('common.save')}</button></>}>
      <div className="adm-form">
        <ErrorNote error={error} />
        <ImageCropUpload value={v.photo} onChange={url => setV(x => ({ ...x, photo: url || '' }))} label={t('fam.photo')} upload={(blob, name) => client.upload(blob, { purpose: 'member_photo' }, name)} />
        <label className="adm-field"><span>{t('fam.name')} *</span><input value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></label>
        <div className="fx-grid">
          <label className="adm-field"><span>{t('fam.relation')}</span><select value={v.relation} onChange={e => setV({ ...v, relation: e.target.value })}>{RELATIONS.map(r => <option key={r} value={r}>{t(`rel.${r}`)}</option>)}</select></label>
          <label className="adm-field"><span>{t('fam.gender')}</span><select value={v.gender} onChange={e => setV({ ...v, gender: e.target.value })}><option value="">—</option><option value="female">{t('sex.female')}</option><option value="male">{t('sex.male')}</option><option value="other">{t('sex.other')}</option></select></label>
          <label className="adm-field"><span>{t('fam.dob')}</span><input type="date" max={new Date().toISOString().slice(0, 10)} value={v.dob || ''} onChange={e => setV({ ...v, dob: e.target.value })} /></label>
        </div>
      </div>
    </Modal>
  );
}

/** Patient profile: personal details, photo (cropped), address + map pin, family members. */
export default function PatientProfile({ client, onUserChange }) {
  const t = useT();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [user, setUser] = useState(null);
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [member, setMember] = useState(undefined); // undefined closed, null new, object edit
  const [counts, setCounts] = useState({});

  const onUserChangeRef = useRef(onUserChange);
  onUserChangeRef.current = onUserChange; // parent passes an inline callback; keep effects stable
  const apply = useCallback(u => {
    setUser(u); onUserChangeRef.current?.(u);
    setV({ name: u.name === 'Patient User' ? '' : u.name || '', email: u.email || '', dob: u.dob || '', gender: u.gender || '', bloodGroup: u.bloodGroup || '', address: u.addressDetails || {}, lat: u.lat, lng: u.lng });
  }, []);
  useEffect(() => { client.get('/me').then(r => { apply(r.user); setCounts(r.bookingCounts || {}); }).catch(e => setError(e.message)); }, [client, apply]);

  if (!v) return error ? <ErrorNote error={error} /> : <div className="fx-center"><Loader2 className="adm-spin" /></div>;

  const save = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await client.put('/me', { ...v, lat: v.lat || undefined, lng: v.lng || undefined }); apply(r.user); toast.success(t('profile.saved')); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const savePhoto = async url => { try { const r = await client.put('/me', { photo: url }); apply(r.user); toast.success(url ? t('profile.photoUpdated') : t('profile.photoRemoved')); } catch (err) { toast.error(err.message); } };
  const saveMember = async m => {
    const r = member ? await client.put(`/me/family/${member.id}`, m) : await client.post('/me/family', m);
    apply(r.user); toast.success(t('fam.saved'));
  };
  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <div className="fx-patient-profile">
      <Card>
        <div className="fx-row fx-wrap fx-between">
          <ImageCropUpload value={user.photo} onChange={savePhoto} label={t('profile.photo')} upload={(blob, name) => client.upload(blob, { purpose: 'patient_photo' }, name)} />
          <div className="fx-stat-mini"><strong>{total}</strong><small>{t('profile.bookings')}</small><strong>{counts.Completed || 0}</strong><small>{t('profile.visits')}</small></div>
        </div>
        <p className="adm-small adm-muted fx-mt">{t('profile.signedInAs', { phone: user.phone })}</p>
      </Card>
      <form onSubmit={save}>
        <Card title={<><UserRound size={16} /> {t('profile.personal')}</>}>
          <ErrorNote error={error} />
          <div className="fx-grid">
            <label className="adm-field"><span>{t('book.fullName')} *</span><input value={v.name} onChange={e => setV({ ...v, name: e.target.value })} autoComplete="name" /></label>
            <label className="adm-field"><span>{t('profile.email')}</span><input type="email" value={v.email} onChange={e => setV({ ...v, email: e.target.value })} autoComplete="email" /></label>
            <label className="adm-field"><span>{t('fam.dob')}</span><input type="date" max={new Date().toISOString().slice(0, 10)} value={v.dob} onChange={e => setV({ ...v, dob: e.target.value })} /></label>
            <label className="adm-field"><span>{t('profile.orAge')}</span><input type="number" min="0" max="119" value={ageFrom(v.dob)} onChange={e => setV({ ...v, dob: dobFromAge(e.target.value) })} placeholder={t('profile.years')} /></label>
            <label className="adm-field"><span>{t('fam.gender')}</span><select value={v.gender} onChange={e => setV({ ...v, gender: e.target.value })}><option value="">—</option><option value="female">{t('sex.female')}</option><option value="male">{t('sex.male')}</option><option value="other">{t('sex.other')}</option><option value="prefer_not_to_say">{t('sex.prefer_not_to_say')}</option></select></label>
            <label className="adm-field"><span>{t('profile.blood')}</span><select value={v.bloodGroup} onChange={e => setV({ ...v, bloodGroup: e.target.value })}><option value="">—</option>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(b => <option key={b}>{b}</option>)}</select></label>
          </div>
        </Card>
        <Card title={<><MapPin size={16} /> {t('profile.address')}</>}>
          <p className="adm-small adm-muted" style={{ marginBottom: 8 }}>{t('profile.addressNote')}</p>
          <MapPicker value={v.lat ? { lat: v.lat, lng: v.lng } : null} label={t('profile.yourHome')} height={240} onChange={(p, found) => setV(x => ({ ...x, lat: p.lat, lng: p.lng, address: mergeAddress(x.address, found) }))} />
          <AddressFields value={v.address} onChange={address => setV({ ...v, address })} required={false} />
        </Card>
        <div className="fx-sticky-save"><button className="btn-primary adm-btn" disabled={busy} data-testid="patient-profile-save">{busy && <Loader2 size={15} className="adm-spin" />} {t('profile.save')}</button></div>
      </form>
      <Card title={<><Users size={16} /> {t('fam.title')}</>} actions={<button className="btn-secondary adm-btn adm-btn-sm" onClick={() => setMember(null)} disabled={(user.familyMembers || []).length >= 10}><Plus size={14} /> {t('common.add')}</button>}>
        {(user.familyMembers || []).length === 0 ? <p className="adm-muted adm-small">{t('fam.empty')}</p> : (
          <ul className="fx-family">
            {user.familyMembers.map(m => (
              <li key={m.id}>
                {m.photo ? <img src={m.photo} alt="" className="fx-member-photo" /> : <span className="adm-initial">{m.name[0]}</span>}
                <div><strong>{m.name}</strong><small>{enumLabel(t, 'rel', m.relation)}{m.gender ? ` • ${enumLabel(t, 'sex', m.gender)}` : ''}{m.dob ? ` • ${t('profile.age', { n: ageFrom(m.dob) })}` : ''}</small></div>
                <button className="adm-icon-btn" onClick={() => setMember(m)} aria-label={`${t('common.edit')} ${m.name}`}><Pencil size={15} /></button>
                <button className="adm-icon-btn" onClick={() => confirm({ title: t('fam.removeTitle', { name: m.name }), danger: true, confirmLabel: t('common.remove'), onConfirm: async () => { const r = await client.del(`/me/family/${m.id}`); apply(r.user); } })} aria-label={`${t('common.remove')} ${m.name}`}><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <MemberModal open={member !== undefined} member={member} client={client} onSave={saveMember} onClose={() => setMember(undefined)} />
      {confirmEl}
    </div>
  );
}
