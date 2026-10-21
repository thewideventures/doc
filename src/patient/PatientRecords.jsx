import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Upload, Pill, FlaskConical, Trash2, Download, Loader2, ShieldCheck, FolderHeart } from 'lucide-react';
import { Card, ErrorNote, useToast, useConfirm } from '../admin/ui';
import { fmtDate } from '../lib/api';
import { useT } from '../i18n';
import PrescriptionModal, { downloadBlob } from './PrescriptionModal';

const ICON = { prescription: Pill, lab_report: FlaskConical, document: FileText };
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

/** Health record timeline per family member: prescriptions (from doctors), lab reports and uploads (private). */
export default function PatientRecords({ client, user, onFollowUp }) {
  const t = useT();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [member, setMember] = useState('self');
  const [type, setType] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [rx, setRx] = useState(null);
  const [form, setForm] = useState({ title: '', date: '', recordType: 'lab_report', file: null });

  const load = useCallback(() => {
    setError('');
    client.get('/me/records', { memberId: member, type: type || undefined }).then(setData).catch(e => setError(e.message));
  }, [client, member, type]);
  useEffect(() => { load(); }, [load]);

  const grantConsent = async () => {
    setBusy('consent');
    try { await client.post('/me/consents', { consents: [{ purpose: 'health_data', granted: true }], method: 'settings' }); toast.success(t('records.consentSaved')); load(); }
    catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const upload = async e => {
    e.preventDefault();
    if (!form.file) return;
    setBusy('upload');
    try {
      await client.uploadTo('/me/records/upload', form.file, { title: form.title, date: form.date, recordType: form.recordType, memberId: member === 'self' || member === 'all' ? '' : member });
      toast.success(t('records.uploaded')); setForm({ title: '', date: '', recordType: 'lab_report', file: null }); e.target.reset(); load();
    } catch (err) { toast.error(err.message); } finally { setBusy(''); }
  };
  const open = async r => {
    if (r.type === 'prescription' && r.prescriptionId) {
      setBusy(r.id);
      try { const x = await client.get(`/me/prescriptions/${r.prescriptionId}`); setRx(x.prescription); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
      return;
    }
    setBusy(r.id);
    try { await downloadBlob(client, `/me/records/${r.id}/file`, r.file?.originalName || `${r.title || 'record'}.${r.file?.mime === 'application/pdf' ? 'pdf' : 'jpg'}`); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const remove = r => confirm({
    title: t('records.deleteTitle'), danger: true, confirmLabel: t('common.delete'), message: r.title,
    onConfirm: async () => { await client.del(`/me/records/${r.id}`); load(); }
  });

  const groups = useMemo(() => {
    const g = new Map();
    for (const r of data?.items || []) { const k = (r.date || '').slice(0, 7) || '—'; if (!g.has(k)) g.set(k, []); g.get(k).push(r); }
    return [...g.entries()];
  }, [data]);
  const members = user?.familyMembers || [];
  const memberName = id => (id ? members.find(m => m.id === id)?.name || t('records.member') : t('book.myself'));

  return (
    <div className="fx-records">
      <div className="fx-chips" role="tablist" aria-label={t('records.whose')}>
        <button type="button" className={`fx-chip ${member === 'self' ? 'on' : ''}`} onClick={() => setMember('self')}>{t('book.myself')}</button>
        {members.map(m => <button key={m.id} type="button" className={`fx-chip ${member === m.id ? 'on' : ''}`} onClick={() => setMember(m.id)}>{m.photo ? <img src={m.photo} alt="" className="fx-chip-avatar" /> : null}{m.name}</button>)}
        <button type="button" className={`fx-chip ${member === 'all' ? 'on' : ''}`} onClick={() => setMember('all')}>{t('records.everyone')}</button>
      </div>
      <ErrorNote error={error} />
      {data && !data.consent && (
        <div className="fx-note fx-note-warn fx-row fx-between fx-wrap" data-testid="records-consent">
          <span><ShieldCheck size={14} /> {t('records.needConsent')}</span>
          <button className="btn-primary adm-btn adm-btn-sm" onClick={grantConsent} disabled={busy === 'consent'}>{t('records.allow')}</button>
        </div>
      )}
      {data?.consent && (
        <Card title={<><Upload size={15} /> {t('records.upload')}</>}>
          <form className="fx-grid" onSubmit={upload}>
            <label className="adm-field"><span>{t('records.file')} *</span><input type="file" accept={ACCEPT} required onChange={e => setForm(f => ({ ...f, file: e.target.files?.[0] || null }))} data-testid="record-file" /></label>
            <label className="adm-field"><span>{t('records.titleField')}</span><input value={form.title} maxLength={120} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder={t('records.titlePh')} /></label>
            <label className="adm-field"><span>{t('records.date')}</span><input type="date" max={new Date().toISOString().slice(0, 10)} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} /></label>
            <label className="adm-field"><span>{t('records.type')}</span><select value={form.recordType} onChange={e => setForm(f => ({ ...f, recordType: e.target.value }))}><option value="lab_report">{t('rtype.lab_report')}</option><option value="document">{t('rtype.document')}</option></select></label>
            <div className="adm-field"><span>&nbsp;</span><button className="btn-primary adm-btn" disabled={busy === 'upload' || !form.file} data-testid="record-upload">{busy === 'upload' ? <Loader2 size={14} className="adm-spin" /> : <Upload size={14} />} {t('records.uploadBtn')}</button></div>
          </form>
          <p className="adm-small adm-muted"><ShieldCheck size={12} /> {t('records.privateNote')}</p>
        </Card>
      )}
      <div className="fx-chips">
        {['', 'prescription', 'lab_report', 'document'].map(x => <button key={x || 'all'} type="button" className={`fx-chip ${type === x ? 'on' : ''}`} onClick={() => setType(x)}>{x ? t(`rtype.${x}`) : t('records.allTypes')}</button>)}
      </div>
      {!data ? <div className="fx-center"><Loader2 className="adm-spin" /></div> : data.items.length === 0 ? (
        <div className="fx-empty"><FolderHeart size={36} /><h3>{t('records.empty')}</h3><p className="adm-muted">{t('records.emptyHint')}</p></div>
      ) : (
        <ol className="fx-timeline" data-testid="records-timeline">
          {groups.map(([month, recs]) => (
            <li key={month}>
              <h4 className="fx-label">{month === '—' ? '—' : new Date(`${month}-01T00:00:00+05:30`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h4>
              <ul>
                {recs.map(r => {
                  const I = ICON[r.type] || FileText;
                  return (
                    <li key={r.id} className={`fx-tl-item fx-tl-${r.type}`}>
                      <span className="fx-tl-icon"><I size={16} /></span>
                      <div className="fx-tl-main">
                        <strong>{r.title || t(`rtype.${r.type}`)}</strong>
                        <small>{fmtDate(r.date)} • {t(`rtype.${r.type}`)}{r.doctorName ? ` • ${r.doctorName}` : ''}{r.labName ? ` • ${r.labName}` : ''}{member === 'all' ? ` • ${memberName(r.memberId)}` : ''}</small>
                      </div>
                      <div className="fx-row">
                        {(r.hasFile || r.prescriptionId) && <button className="adm-icon-btn" disabled={busy === r.id} onClick={() => open(r)} aria-label={t('records.open')}>{busy === r.id ? <Loader2 size={15} className="adm-spin" /> : r.type === 'prescription' ? <Pill size={15} /> : <Download size={15} />}</button>}
                        {r.source === 'patient' && <button className="adm-icon-btn" onClick={() => remove(r)} aria-label={t('common.delete')}><Trash2 size={15} /></button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
      {rx && <PrescriptionModal client={client} rx={rx} onClose={() => setRx(null)} onFollowUp={onFollowUp ? () => { const p = rx; setRx(null); onFollowUp({ doctorId: p.doctorId, bookingId: p.bookingId, memberId: p.memberId || '' }); } : undefined} />}
      {confirmEl}
    </div>
  );
}
