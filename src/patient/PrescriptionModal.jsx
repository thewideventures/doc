import React, { useState } from 'react';
import { Download, Pill, Repeat, BellRing, Loader2, Stethoscope } from 'lucide-react';
import { Modal, useToast } from '../admin/ui';
import { fmtDate } from '../lib/api';
import { useT } from '../i18n';

export async function downloadBlob(client, path, filename) {
  const blob = await client.blob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Patient view of a digital prescription: medicines, advice, PDF, medicine reminders, follow-up booking. */
export default function PrescriptionModal({ client, rx, onClose, onFollowUp, onChange }) {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const [rem, setRem] = useState(rx?.reminders || {});
  if (!rx) return null;
  const pdf = async () => {
    setBusy('pdf');
    try { await downloadBlob(client, `/me/prescriptions/${rx.id}/pdf`, `prescription-${rx.visitDate || rx.id}.pdf`); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const saveRem = async next => {
    setBusy('rem');
    try { const r = await client.put(`/me/prescriptions/${rx.id}/reminders`, next); setRem(r.reminders); toast.success(r.message); onChange?.(); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const hasMeds = (rx.medicines || []).some(m => m.durationDays > 0 && m.frequency);
  return (
    <Modal open title={<><Pill size={16} /> {t('rx.title')}</>} onClose={onClose} width={620}
      footer={<><button className="btn-secondary adm-btn" onClick={pdf} disabled={busy === 'pdf'} data-testid="rx-pdf">{busy === 'pdf' ? <Loader2 size={14} className="adm-spin" /> : <Download size={14} />} {t('rx.pdf')}</button>
        {onFollowUp && <button className="btn-primary adm-btn" onClick={() => onFollowUp(rx)} data-testid="rx-followup"><Repeat size={14} /> {t('rx.bookFollowUp')}</button>}</>}>
      <div className="fx-rx">
        <header className="fx-rx-head">
          <div><strong><Stethoscope size={14} /> {rx.doctor?.name}</strong><small>{rx.doctor?.qualifications}</small>
            {rx.doctor?.registrationNumber && <small>{rx.doctor.councilName ? `${rx.doctor.councilName} • ` : ''}{t('doc.regNo')} {rx.doctor.registrationNumber}</small>}</div>
          <div className="fx-rx-meta"><small>{fmtDate(rx.visitDate)}</small><small>{rx.patientName}{rx.patientAge ? `, ${rx.patientAge}` : ''}</small></div>
        </header>
        {rx.complaints && <p><b>{t('rx.complaints')}:</b> {rx.complaints}</p>}
        {rx.diagnosis && <p><b>{t('rx.diagnosis')}:</b> {rx.diagnosis}</p>}
        {(rx.medicines || []).length > 0 && (
          <table className="fx-rx-table">
            <thead><tr><th>{t('rx.medicine')}</th><th>{t('rx.dose')}</th><th>{t('rx.frequency')}</th><th>{t('rx.days')}</th></tr></thead>
            <tbody>{rx.medicines.map((m, i) => <tr key={i}><td><b>{m.name}</b>{m.timing ? <small> • {m.timing}</small> : null}{m.instructions ? <small><br />{m.instructions}</small> : null}</td><td>{m.dosage}</td><td>{m.frequency}</td><td>{m.durationDays || '—'}</td></tr>)}</tbody>
          </table>
        )}
        {rx.tests?.length > 0 && <p><b>{t('rx.tests')}:</b> {rx.tests.join(', ')}</p>}
        {rx.advice && <p><b>{t('rx.advice')}:</b> {rx.advice}</p>}
        {rx.visitNotes && <p><b>{t('rx.notes')}:</b> {rx.visitNotes}</p>}
        {(rx.followUp?.afterDays > 0 || rx.followUp?.date) && <p className="fx-note fx-note-info"><Repeat size={13} /> {t('rx.followUpIn', { date: rx.followUp.date ? fmtDate(rx.followUp.date) : t('share.days', { n: rx.followUp.afterDays }) })}{rx.followUp.note ? ` — ${rx.followUp.note}` : ''}</p>}
        {hasMeds && (
          <section className="fx-rx-rem">
            <h4 className="fx-label"><BellRing size={14} /> {t('rx.reminders')}</h4>
            <label className="fx-switch"><input type="checkbox" checked={Boolean(rem.enabled)} disabled={busy === 'rem'} onChange={e => saveRem({ enabled: e.target.checked, whatsapp: Boolean(rem.whatsapp), sms: Boolean(rem.sms) })} data-testid="rx-reminders" /> <span>{t('rx.remindersInApp')}</span></label>
            {rem.enabled && (
              <div className="fx-row fx-wrap">
                <label className="fx-switch"><input type="checkbox" checked={Boolean(rem.whatsapp)} disabled={busy === 'rem'} onChange={e => saveRem({ enabled: true, whatsapp: e.target.checked, sms: Boolean(rem.sms) })} /> <span>WhatsApp</span></label>
                <label className="fx-switch"><input type="checkbox" checked={Boolean(rem.sms)} disabled={busy === 'rem'} onChange={e => saveRem({ enabled: true, whatsapp: Boolean(rem.whatsapp), sms: e.target.checked })} /> <span>SMS</span></label>
              </div>
            )}
            <p className="adm-small adm-muted">{t('rx.remindersNote')}</p>
          </section>
        )}
        <p className="fx-disclaimer">{t('rx.disclaimer')}</p>
      </div>
    </Modal>
  );
}
