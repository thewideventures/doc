import React, { useEffect, useState } from 'react';
import { Loader2, Share2, ShieldCheck, FileText } from 'lucide-react';
import { Modal, ErrorNote, useToast } from '../admin/ui';
import { fmtDateLong } from '../lib/api';
import { useT } from '../i18n';

/** Consent-based, time-limited sharing of health records with the doctor of ONE booking. */
export default function ShareRecordsModal({ client, booking, onClose }) {
  const t = useT();
  const toast = useToast();
  const [records, setRecords] = useState(null);
  const [consent, setConsent] = useState(true);
  const [share, setShare] = useState(null);
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState([]);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!booking) return;
    setError(''); setRecords(null); setPicked([]); setAll(false);
    Promise.all([client.get('/me/records', { memberId: booking.forMember?.id || 'self' }), client.get(`/me/bookings/${booking.id}/share`)])
      .then(([r, s]) => { setRecords(r.items); setConsent(r.consent); setShare(s.share); })
      .catch(e => setError(e.message));
  }, [booking, client]);

  if (!booking) return null;
  const save = async () => {
    setBusy(true); setError('');
    try { const r = await client.post(`/me/bookings/${booking.id}/share`, { allRecords: all, recordIds: all ? [] : picked, days }); setShare(r.share); toast.success(r.message); onClose(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const revoke = async () => {
    setBusy(true);
    try { await client.del(`/me/bookings/${booking.id}/share`); setShare(null); toast.success(t('share.revoked')); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const toggle = id => setPicked(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));

  return (
    <Modal open title={<><Share2 size={16} /> {t('share.title', { name: booking.doctorName })}</>} onClose={busy ? undefined : onClose} width={520}
      footer={<><button className="btn-secondary adm-btn" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
        <button className="btn-primary adm-btn" onClick={save} disabled={busy || !consent || (!all && !picked.length)} data-testid="share-save">{busy && <Loader2 size={14} className="adm-spin" />} {t('share.share')}</button></>}>
      <ErrorNote error={error} />
      <p className="adm-small adm-muted"><ShieldCheck size={13} /> {t('share.explain')}</p>
      {!consent && <p className="fx-note fx-note-warn">{t('records.needConsent')}</p>}
      {share && (
        <div className="fx-note fx-note-info fx-row fx-between">
          <span>{t('share.active', { date: fmtDateLong(share.expiresAt) })}</span>
          <button className="adm-btn adm-btn-danger-soft adm-btn-sm" onClick={revoke} disabled={busy}>{t('share.revoke')}</button>
        </div>
      )}
      {records === null ? <div className="fx-center"><Loader2 className="adm-spin" /></div> : (
        <>
          <label className="fx-q-check on"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> <span>{t('share.all', { n: records.length })}</span></label>
          {!all && (
            <ul className="fx-share-list">
              {records.length === 0 && <li className="adm-muted adm-small">{t('records.empty')}</li>}
              {records.map(r => (
                <li key={r.id}><label><input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} /> <FileText size={13} /> <span>{r.title || t(`rtype.${r.type}`)}</span> <small className="adm-muted">{r.date}</small></label></li>
              ))}
            </ul>
          )}
          <label className="adm-field"><span>{t('share.duration')}</span>
            <select value={days} onChange={e => setDays(Number(e.target.value))}>{[1, 3, 7, 14, 30].map(d => <option key={d} value={d}>{t('share.days', { n: d })}</option>)}</select>
          </label>
        </>
      )}
    </Modal>
  );
}
