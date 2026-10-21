import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Loader2, Download, Pill, Lock } from 'lucide-react';
import { Modal, ErrorNote, useToast } from '../admin/ui';
import { fmtDate, fmtTime } from '../lib/api';
import { useT } from '../i18n';
import { downloadBlob } from '../patient/PrescriptionModal';

const EMPTY_MED = { name: '', dosage: '', frequency: '1-0-1', timing: 'After food', durationDays: 5, instructions: '' };
const FREQ = ['1-0-0', '0-1-0', '0-0-1', '1-0-1', '1-1-1', '1-1-1-1', 'SOS', 'OD', 'BD', 'TDS', 'QID', 'HS'];

/** Doctor: digital prescription + visit notes for a booking (private notes never reach the patient or the PDF). */
export default function PrescriptionEditor({ client, booking, onClose, onSaved }) {
  const t = useT();
  const toast = useToast();
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    client.get(`/doctor-portal/bookings/${booking.id}/prescription`).then(r => {
      const p = r.prescription || {};
      setV({ complaints: p.complaints || booking.note || '', diagnosis: p.diagnosis || '', visitNotes: p.visitNotes || '', privateNotes: p.privateNotes || '', advice: p.advice || '',
        vitals: { bp: '', pulse: '', temperature: '', weight: '', spo2: '', ...(p.vitals || {}) }, medicines: p.medicines?.length ? p.medicines : [{ ...EMPTY_MED }],
        tests: (p.tests || []).join(', '), followUp: { afterDays: p.followUp?.afterDays || 0, note: p.followUp?.note || '' }, exists: Boolean(r.prescription) });
    }).catch(e => setError(e.message));
  }, [client, booking]);
  if (!v) return <Modal open title={t('rx.title')} onClose={onClose}>{error ? <ErrorNote error={error} /> : <div className="fx-center"><Loader2 className="adm-spin" /></div>}</Modal>;
  const setMed = (i, patch) => setV(x => ({ ...x, medicines: x.medicines.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const save = async () => {
    setBusy(true); setError('');
    try {
      const body = { ...v, medicines: v.medicines.filter(m => m.name.trim()).map(m => ({ ...m, durationDays: Number(m.durationDays) || 0 })), tests: v.tests.split(',').map(s => s.trim()).filter(Boolean), followUp: { afterDays: Number(v.followUp.afterDays) || 0, note: v.followUp.note } };
      delete body.exists;
      await client.put(`/doctor-portal/bookings/${booking.id}/prescription`, body);
      toast.success(t('rx.saved')); setV(x => ({ ...x, exists: true })); onSaved?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const pdf = () => downloadBlob(client, `/doctor-portal/bookings/${booking.id}/prescription/pdf`, `prescription-${booking.bookingCode || booking.id}.pdf`).catch(e => toast.error(e.message));
  const vit = k => <label className="adm-field"><span>{t(`vit.${k}`)}</span><input value={v.vitals[k]} maxLength={15} onChange={e => setV({ ...v, vitals: { ...v.vitals, [k]: e.target.value } })} /></label>;
  return (
    <Modal open title={<><Pill size={16} /> {t('rx.title')} — {booking.patientName}</>} onClose={busy ? undefined : onClose} width={820}
      footer={<>{v.exists && <button className="btn-secondary adm-btn" onClick={pdf} data-testid="rx-doc-pdf"><Download size={14} /> PDF</button>}
        <button className="btn-secondary adm-btn" onClick={onClose} disabled={busy}>{t('common.close')}</button>
        <button className="btn-primary adm-btn" onClick={save} disabled={busy} data-testid="rx-save">{busy && <Loader2 size={14} className="adm-spin" />} {t('common.save')}</button></>}>
      <ErrorNote error={error} />
      <p className="adm-small adm-muted">{fmtDate(booking.date)} {fmtTime(booking.timeSlot)} • {booking.bookingCode}</p>
      <div className="fx-grid">
        <label className="adm-field"><span>{t('rx.complaints')}</span><textarea rows={2} maxLength={1000} value={v.complaints} onChange={e => setV({ ...v, complaints: e.target.value })} /></label>
        <label className="adm-field"><span>{t('rx.diagnosis')}</span><textarea rows={2} maxLength={500} value={v.diagnosis} onChange={e => setV({ ...v, diagnosis: e.target.value })} data-testid="rx-diagnosis" /></label>
      </div>
      <div className="fx-grid fx-grid-5">{['bp', 'pulse', 'temperature', 'weight', 'spo2'].map(vit)}</div>
      <h4 className="fx-label">{t('rx.medicines')}</h4>
      <div className="fx-rx-meds">
        {v.medicines.map((m, i) => (
          <div key={i} className="fx-rx-med">
            <input placeholder={t('rx.medicine')} value={m.name} maxLength={120} onChange={e => setMed(i, { name: e.target.value })} aria-label={t('rx.medicine')} data-testid="rx-med-name" />
            <input placeholder={t('rx.dose')} value={m.dosage} maxLength={60} onChange={e => setMed(i, { dosage: e.target.value })} aria-label={t('rx.dose')} />
            <select value={m.frequency} onChange={e => setMed(i, { frequency: e.target.value })} aria-label={t('rx.frequency')}>{[...new Set([m.frequency, ...FREQ])].filter(Boolean).map(f => <option key={f}>{f}</option>)}</select>
            <input placeholder={t('rx.timing')} value={m.timing} maxLength={60} onChange={e => setMed(i, { timing: e.target.value })} aria-label={t('rx.timing')} />
            <input type="number" min="0" max="365" value={m.durationDays} onChange={e => setMed(i, { durationDays: e.target.value })} aria-label={t('rx.days')} />
            <input placeholder={t('rx.instructions')} value={m.instructions} maxLength={200} onChange={e => setMed(i, { instructions: e.target.value })} aria-label={t('rx.instructions')} />
            <button type="button" className="adm-icon-btn" onClick={() => setV(x => ({ ...x, medicines: x.medicines.filter((_, j) => j !== i) }))} aria-label={t('common.remove')}><Trash2 size={14} /></button>
          </div>
        ))}
        <button type="button" className="adm-link" onClick={() => setV(x => ({ ...x, medicines: [...x.medicines, { ...EMPTY_MED }] }))} disabled={v.medicines.length >= 30}><Plus size={13} /> {t('rx.addMedicine')}</button>
      </div>
      <div className="fx-grid">
        <label className="adm-field"><span>{t('rx.tests')}</span><input value={v.tests} onChange={e => setV({ ...v, tests: e.target.value })} placeholder="CBC, HbA1c" /></label>
        <label className="adm-field"><span>{t('rx.followUpDays')}</span><input type="number" min="0" max="365" value={v.followUp.afterDays} onChange={e => setV({ ...v, followUp: { ...v.followUp, afterDays: e.target.value } })} data-testid="rx-followup-days" /></label>
      </div>
      <label className="adm-field"><span>{t('rx.advice')}</span><textarea rows={2} maxLength={2000} value={v.advice} onChange={e => setV({ ...v, advice: e.target.value })} /></label>
      <label className="adm-field"><span>{t('rx.notes')}</span><textarea rows={2} maxLength={3000} value={v.visitNotes} onChange={e => setV({ ...v, visitNotes: e.target.value })} /></label>
      <label className="adm-field"><span><Lock size={12} /> {t('rx.privateNotes')}</span><textarea rows={2} maxLength={3000} value={v.privateNotes} onChange={e => setV({ ...v, privateNotes: e.target.value })} /></label>
      <p className="adm-small adm-muted">{t('rx.privateHint')}</p>
    </Modal>
  );
}
