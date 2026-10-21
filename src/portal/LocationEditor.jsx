import React, { useEffect, useState } from 'react';
import { Lock, Loader2, Info } from 'lucide-react';
import { Modal } from '../admin/ui';
import MapPicker, { AddressFields, mergeAddress } from '../components/MapPicker';
import ScheduleEditor, { DEFAULT_SCHEDULE } from './ScheduleEditor';
import { inr, LOCATION_KIND_LABEL } from '../lib/api';

const KIND_HELP = {
  own_clinic: 'Your own clinic or consulting room.',
  hospital: 'A hospital where you consult (OP).',
  home_visit: 'You visit patients at home within a radius.',
  online: 'Video / phone consultation — no address needed.',
  clinic: 'Consultation at this clinic.'
};

export const MODES = [
  { value: 'free', label: 'Free booking', help: 'Patient books free, pays the full fee at the clinic.' },
  { value: 'paid', label: 'Paid online', help: 'Patient pays the full consultation fee online to confirm.' },
  { value: 'token', label: 'Booking amount', help: 'Patient pays a small booking amount online; the rest at the clinic.' }
];

/** Booking mode + fee block (shared by doctor locations and clinic doctor schedules). */
export function FeeModeFields({ value, onChange, allowOnlinePayments, planName }) {
  const set = patch => onChange({ ...value, ...patch });
  return (
    <div>
      <div className="fx-grid fx-grid-3">
        <label className="adm-field"><span>Consultation fee (₹) *</span><input type="number" min="0" max="100000" inputMode="numeric" value={value.fee ?? ''} onChange={e => set({ fee: e.target.value })} /></label>
        {value.bookingMode === 'token' && <label className="adm-field"><span>Booking amount (₹) *</span><input type="number" min="1" inputMode="numeric" value={value.tokenAmount ?? ''} onChange={e => set({ tokenAmount: e.target.value })} /><small className="adm-muted">Adjusted in the fee; rest {inr(Math.max(0, (Number(value.fee) || 0) - (Number(value.tokenAmount) || 0)))} at clinic</small></label>}
      </div>
      <div className="fx-label">How patients book</div>
      <div className="fx-mode-pick" role="radiogroup" aria-label="Booking mode">
        {MODES.map(m => {
          const locked = m.value !== 'free' && !allowOnlinePayments;
          return (
            <button key={m.value} type="button" role="radio" aria-checked={value.bookingMode === m.value} disabled={locked}
              className={`fx-mode-opt ${value.bookingMode === m.value ? 'on' : ''}`} onClick={() => set({ bookingMode: m.value })}>
              <strong>{locked && <Lock size={12} />} {m.label}</strong><small>{locked ? `Needs Pro or Premium (you're on ${planName || 'Basic'})` : m.help}</small>
            </button>
          );
        })}
      </div>
      <small className="adm-muted"><Info size={12} /> A platform fee (incl. GST) is added for patients on paid & booking-amount bookings. Online collections are settled to you via payouts.</small>
    </div>
  );
}

const blank = kind => ({ kind, name: '', phone: '', address: {}, lat: null, lng: null, fee: 500, bookingMode: 'free', tokenAmount: 100, autoConfirm: true, serviceRadiusKm: 5, notes: '', schedule: DEFAULT_SCHEDULE });

/** Add / edit a consultation location. onSave(payload) must return a promise. */
export default function LocationEditor({ open, location, kinds = ['own_clinic', 'hospital', 'home_visit', 'online'], allowOnlinePayments, planName, onSave, onClose }) {
  const [v, setV] = useState(blank('own_clinic'));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError(''); setBusy(false);
    setV(location ? { ...blank(location.kind), ...location, address: location.address || {}, lat: location.lat, lng: location.lng, schedule: location.schedule || DEFAULT_SCHEDULE } : blank(kinds[0]));
  }, [open, location]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = patch => setV(x => ({ ...x, ...patch }));
  const needsMap = ['own_clinic', 'hospital', 'clinic'].includes(v.kind);
  const hasAddress = v.kind !== 'online';

  const save = async () => {
    setError('');
    if (!v.name.trim() && !['online', 'home_visit'].includes(v.kind)) { setError('Give this location a name (e.g. "Sunrise Clinic, Kakkanad")'); return; }
    if (needsMap && !v.lat) { setError('Pick the exact location on the map'); return; }
    setBusy(true);
    try {
      await onSave({
        kind: v.kind, name: v.name.trim(), phone: v.phone, address: hasAddress ? v.address : undefined,
        lat: hasAddress && v.lat ? v.lat : undefined, lng: hasAddress && v.lng ? v.lng : undefined,
        fee: Number(v.fee), bookingMode: v.bookingMode, tokenAmount: Number(v.tokenAmount), autoConfirm: v.autoConfirm,
        serviceRadiusKm: Number(v.serviceRadiusKm), notes: v.notes, schedule: v.schedule
      });
      onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal open={open} onClose={busy ? undefined : onClose} width={760} title={location ? `Edit ${location.name}` : 'Add consultation location'}
      footer={<>
        <button className="btn-secondary adm-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn-primary adm-btn" onClick={save} disabled={busy} data-testid="location-save">{busy && <Loader2 size={15} className="adm-spin" />} Save location</button>
      </>}>
      <div className="adm-form">
        {error && <div className="adm-alert adm-alert-error">{error}</div>}
        {!location && (
          <div className="fx-mode-pick fx-kind-pick" role="radiogroup" aria-label="Location type">
            {kinds.map(k => <button key={k} type="button" role="radio" aria-checked={v.kind === k} className={`fx-mode-opt ${v.kind === k ? 'on' : ''}`} onClick={() => set({ kind: k })}><strong>{LOCATION_KIND_LABEL[k]}</strong><small>{KIND_HELP[k]}</small></button>)}
          </div>
        )}
        <div className="fx-grid">
          <label className="adm-field"><span>Location name {needsMap && '*'}</span><input value={v.name} onChange={e => set({ name: e.target.value })} placeholder={v.kind === 'online' ? 'Online consultation' : v.kind === 'home_visit' ? 'Home visit' : 'e.g. Sunrise Clinic, Kakkanad'} /></label>
          {v.kind !== 'online' && <label className="adm-field"><span>Front desk phone</span><input value={v.phone} onChange={e => set({ phone: e.target.value })} inputMode="tel" placeholder="Optional" /></label>}
          {v.kind === 'home_visit' && <label className="adm-field"><span>Service radius (km)</span><input type="number" min="1" max="100" value={v.serviceRadiusKm} onChange={e => set({ serviceRadiusKm: e.target.value })} /></label>}
        </div>
        {hasAddress && (
          <>
            <MapPicker value={v.lat ? { lat: v.lat, lng: v.lng } : null} label={v.kind === 'home_visit' ? 'Centre of the area you cover' : 'Pin the clinic entrance'}
              onChange={(p, found) => setV(x => ({ ...x, lat: p.lat, lng: p.lng, address: mergeAddress(x.address, found) }))} />
            <AddressFields value={v.address} onChange={a => set({ address: a })} required={needsMap} />
          </>
        )}
        <FeeModeFields value={v} onChange={p => set(p)} allowOnlinePayments={allowOnlinePayments} planName={planName} />
        <label className="adm-check" style={{ alignSelf: 'flex-start' }}><input type="checkbox" checked={v.autoConfirm} onChange={e => set({ autoConfirm: e.target.checked })} /> Auto-confirm bookings (otherwise you accept each request)</label>
        <ScheduleEditor value={v.schedule} onChange={schedule => set({ schedule })} />
        <label className="adm-field"><span>Notes for patients</span><input value={v.notes} maxLength={300} onChange={e => set({ notes: e.target.value })} placeholder="e.g. Parking available, 2nd floor" /></label>
      </div>
    </Modal>
  );
}
