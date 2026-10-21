import React, { useEffect, useState } from 'react';
import { FileText, Download, Loader2, ShieldCheck, Pill, FlaskConical } from 'lucide-react';
import { Modal, ErrorNote, useToast } from '../admin/ui';
import { fmtDate, fmtDateLong } from '../lib/api';
import { useT } from '../i18n';
import { downloadBlob } from '../patient/PrescriptionModal';

const ICON = { prescription: Pill, lab_report: FlaskConical, document: FileText };

/** Doctor: records the patient shared for THIS booking (consent + expiry enforced server-side). */
export default function SharedRecordsModal({ client, booking, onClose }) {
  const t = useT();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { client.get(`/doctor-portal/bookings/${booking.id}/records`).then(setData).catch(e => setError(e.message)); }, [client, booking]);
  return (
    <Modal open title={<><ShieldCheck size={16} /> {t('dr.sharedRecords')} — {booking.patientName}</>} onClose={onClose} width={600}>
      <ErrorNote error={error} />
      {!data && !error ? <div className="fx-center"><Loader2 className="adm-spin" /></div> : data && (
        <>
            {!data.shared ? <p className="adm-muted" data-testid="no-share">{t('dr.notShared')}</p> : <p className="adm-small adm-muted">{t('share.active', { date: fmtDateLong(data.shareExpiresAt) })}</p>}
            {data.shared && (data.records.length === 0 ? <p className="adm-muted">{t('records.empty')}</p> : (
              <ul className="fx-share-list">
                {data.records.map(r => {
                  const I = ICON[r.type] || FileText;
                  return (
                    <li key={r.id} className="fx-row fx-between">
                      <span><I size={14} /> <b>{r.title || t(`rtype.${r.type}`)}</b> <small className="adm-muted">{fmtDate(r.date)}{r.doctorName ? ` • ${r.doctorName}` : ''}</small></span>
                      {r.hasFile && <button className="adm-icon-btn" onClick={() => downloadBlob(client, `/doctor-portal/bookings/${booking.id}/records/${r.id}/file`, r.file?.originalName || `${r.title || 'record'}`).catch(e => toast.error(e.message))} aria-label={t('records.open')}><Download size={14} /></button>}
                    </li>
                  );
                })}
              </ul>
            ))}
            {data.previousPrescriptions?.length > 0 && (
              <>
                <h4 className="fx-label">{t('dr.pastRx')}</h4>
                <ul className="fx-share-list">{data.previousPrescriptions.map(p => <li key={p.id}><Pill size={13} /> {fmtDate(p.visitDate)} • {p.doctor?.name} • {p.diagnosis || '—'}<small className="adm-muted"> {(p.medicines || []).map(m => m.name).join(', ')}</small></li>)}</ul>
              </>
            )}
        </>
      )}
    </Modal>
  );
}
