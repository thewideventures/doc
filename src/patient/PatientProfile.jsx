import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, Users, UserRound, MapPin } from 'lucide-react';
import { Card, Modal, ErrorNote, useToast, useConfirm } from '../admin/ui';
import ImageCropUpload from '../components/ImageCropUpload';
import MapPicker, { AddressFields, mergeAddress } from '../components/MapPicker';

const RELATIONS = ['spouse', 'child', 'parent', 'sibling', 'grandparent', 'other'];
export const ageFrom = dob => {
  if (!dob) return '';
  const d = new Date(`${dob}T00:00:00`); const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a >= 0 ? a : '';
};
const dobFromAge = age => { const y = new Date().getFullYear() - Number(age); return Number(age) >= 0 && Number(age) < 120 ? `${y}-01-01` : ''; };

function MemberModal({ open, member, onSave, onClose }) {
  const [v, setV] = useState({ name: '', relation: 'child', gender: '', dob: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (open) { setV(member ? { ...member } : { name: '', relation: 'child', gender: '', dob: '' }); setError(''); setBusy(false); } }, [open, member]);
  const save = async () => { setBusy(true); setError(''); try { await onSave(v); onClose(); } catch (e) { setError(e.message); setBusy(false); } };
  return (
    <Modal open={open} title={member ? 'Edit family member' : 'Add family member'} onClose={busy ? undefined : onClose} width={480}
      footer={<><button className="btn-secondary adm-btn" onClick={onClose} disabled={busy}>Cancel</button><button className="btn-primary adm-btn" onClick={save} disabled={busy || v.name.trim().length < 2}>{busy && <Loader2 size={15} className="adm-spin" />} Save</button></>}>
      <div className="adm-form">
        <ErrorNote error={error} />
        <label className="adm-field"><span>Name *</span><input value={v.name} onChange={e => setV({ ...v, name: e.target.value })} /></label>
        <div className="fx-grid">
          <label className="adm-field"><span>Relation</span><select value={v.relation} onChange={e => setV({ ...v, relation: e.target.value })}>{RELATIONS.map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}</select></label>
          <label className="adm-field"><span>Gender</span><select value={v.gender} onChange={e => setV({ ...v, gender: e.target.value })}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></label>
          <label className="adm-field"><span>Date of birth</span><input type="date" max={new Date().toISOString().slice(0, 10)} value={v.dob || ''} onChange={e => setV({ ...v, dob: e.target.value })} /></label>
        </div>
      </div>
    </Modal>
  );
}

/** Patient profile: personal details, photo (cropped), address + map pin, family members. */
export default function PatientProfile({ client, onUserChange }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [user, setUser] = useState(null);
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [member, setMember] = useState(undefined); // undefined closed, null new, object edit
  const [counts, setCounts] = useState({});

  const apply = useCallback(u => {
    setUser(u); onUserChange?.(u);
    setV({ name: u.name === 'Patient User' ? '' : u.name || '', email: u.email || '', dob: u.dob || '', gender: u.gender || '', bloodGroup: u.bloodGroup || '', address: u.addressDetails || {}, lat: u.lat, lng: u.lng });
  }, [onUserChange]);
  useEffect(() => { client.get('/me').then(r => { apply(r.user); setCounts(r.bookingCounts || {}); }).catch(e => setError(e.message)); }, [client, apply]);

  if (!v) return error ? <ErrorNote error={error} /> : <div className="fx-center"><Loader2 className="adm-spin" /></div>;

  const save = async e => {
    e.preventDefault(); setBusy(true); setError('');
    try { const r = await client.put('/me', { ...v, lat: v.lat || undefined, lng: v.lng || undefined }); apply(r.user); toast.success('Profile saved'); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const savePhoto = async url => { try { const r = await client.put('/me', { photo: url }); apply(r.user); toast.success(url ? 'Photo updated' : 'Photo removed'); } catch (err) { toast.error(err.message); } };
  const saveMember = async m => {
    const r = member ? await client.put(`/me/family/${member.id}`, m) : await client.post('/me/family', m);
    apply(r.user); toast.success('Family member saved');
  };
  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <div className="fx-patient-profile">
      <Card>
        <div className="fx-row fx-wrap fx-between">
          <ImageCropUpload value={user.photo} onChange={savePhoto} label="Profile photo" upload={(blob, name) => client.upload(blob, { purpose: 'patient_photo' }, name)} />
          <div className="fx-stat-mini"><strong>{total}</strong><small>bookings</small><strong>{counts.Completed || 0}</strong><small>visits</small></div>
        </div>
        <p className="adm-small adm-muted fx-mt">Signed in as {user.phone}</p>
      </Card>
      <form onSubmit={save}>
        <Card title={<><UserRound size={16} /> Personal details</>}>
          <ErrorNote error={error} />
          <div className="fx-grid">
            <label className="adm-field"><span>Full name *</span><input value={v.name} onChange={e => setV({ ...v, name: e.target.value })} autoComplete="name" /></label>
            <label className="adm-field"><span>Email</span><input type="email" value={v.email} onChange={e => setV({ ...v, email: e.target.value })} autoComplete="email" /></label>
            <label className="adm-field"><span>Date of birth</span><input type="date" max={new Date().toISOString().slice(0, 10)} value={v.dob} onChange={e => setV({ ...v, dob: e.target.value })} /></label>
            <label className="adm-field"><span>…or age</span><input type="number" min="0" max="119" value={ageFrom(v.dob)} onChange={e => setV({ ...v, dob: dobFromAge(e.target.value) })} placeholder="Years" /></label>
            <label className="adm-field"><span>Gender</span><select value={v.gender} onChange={e => setV({ ...v, gender: e.target.value })}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></select></label>
            <label className="adm-field"><span>Blood group</span><select value={v.bloodGroup} onChange={e => setV({ ...v, bloodGroup: e.target.value })}><option value="">—</option>{['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map(b => <option key={b}>{b}</option>)}</select></label>
          </div>
        </Card>
        <Card title={<><MapPin size={16} /> Home address</>}>
          <p className="adm-small adm-muted" style={{ marginBottom: 8 }}>Used for home visits and to show doctors near you.</p>
          <MapPicker value={v.lat ? { lat: v.lat, lng: v.lng } : null} label="Your home" height={240} onChange={(p, found) => setV(x => ({ ...x, lat: p.lat, lng: p.lng, address: mergeAddress(x.address, found) }))} />
          <AddressFields value={v.address} onChange={address => setV({ ...v, address })} required={false} />
        </Card>
        <div className="fx-sticky-save"><button className="btn-primary adm-btn" disabled={busy} data-testid="patient-profile-save">{busy && <Loader2 size={15} className="adm-spin" />} Save profile</button></div>
      </form>
      <Card title={<><Users size={16} /> Family members</>} actions={<button className="btn-secondary adm-btn adm-btn-sm" onClick={() => setMember(null)} disabled={(user.familyMembers || []).length >= 10}><Plus size={14} /> Add</button>}>
        {(user.familyMembers || []).length === 0 ? <p className="adm-muted adm-small">Add family members to book appointments for them.</p> : (
          <ul className="fx-family">
            {user.familyMembers.map(m => (
              <li key={m.id}>
                <span className="adm-initial">{m.name[0]}</span>
                <div><strong>{m.name}</strong><small>{m.relation}{m.gender ? ` • ${m.gender}` : ''}{m.dob ? ` • ${ageFrom(m.dob)} yrs` : ''}</small></div>
                <button className="adm-icon-btn" onClick={() => setMember(m)} aria-label={`Edit ${m.name}`}><Pencil size={15} /></button>
                <button className="adm-icon-btn" onClick={() => confirm({ title: `Remove ${m.name}?`, danger: true, confirmLabel: 'Remove', onConfirm: async () => { const r = await client.del(`/me/family/${m.id}`); apply(r.user); } })} aria-label={`Remove ${m.name}`}><Trash2 size={15} /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <MemberModal open={member !== undefined} member={member} onSave={saveMember} onClose={() => setMember(undefined)} />
      {confirmEl}
    </div>
  );
}
