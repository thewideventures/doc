import React, { useCallback, useEffect, useState } from 'react';
import { Play, Pause, SkipForward, CheckCheck, Square, Clock, Undo2, Loader2, Users, Megaphone, Timer } from 'lucide-react';
import { Card, ErrorNote, useToast, PageHeader } from '../admin/ui';
import { fmtTime } from '../lib/api';
import { useT } from '../i18n';

const POLL_MS = 15000;
const TONE = { waiting: 'slate', in_consult: 'green', done: 'blue', skipped: 'amber' };

/**
 * Live OP queue for one doctor-location-day. base '/doctor-portal' | '/clinic-portal'.
 * targets: [{ key, label, doctorId?, locationId }]
 */
export default function QueuePanel({ client, base, targets = [] }) {
  const t = useT();
  const toast = useToast();
  const [sel, setSel] = useState(targets[0]?.key || '');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [delay, setDelay] = useState('');
  const target = targets.find(x => x.key === sel) || targets[0];
  useEffect(() => { if (!sel && targets[0]) setSel(targets[0].key); }, [targets, sel]);

  const load = useCallback(() => {
    if (!target) return Promise.resolve();
    return client.get(`${base}/queue`, { locationId: target.locationId, doctorId: target.doctorId }).then(r => { setData(r); setError(''); }).catch(e => setError(e.message));
  }, [client, base, target]);
  useEffect(() => {
    setData(null); load();
    const i = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
    return () => clearInterval(i);
  }, [load]);

  const act = async (action, extra = {}) => {
    setBusy(action + (extra.bookingId || ''));
    try { const r = await client.post(`${base}/queue/${action}`, { locationId: target.locationId, ...(target.doctorId ? { doctorId: target.doctorId } : {}), ...extra }); setData(r); }
    catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };

  if (!targets.length) return <><PageHeader title={t('pq.title')} /><Card><p className="adm-muted">{t('pq.noLocations')}</p></Card></>;
  const q = data?.queue;
  const entries = data?.entries || [];
  const waiting = entries.filter(e => e.queueStatus === 'waiting' && e.status === 'Confirmed').length;
  const current = entries.find(e => e.queueStatus === 'in_consult');

  return (
    <div className="fx-pq" data-testid="queue-panel">
      <PageHeader title={t('pq.title')} subtitle={t('pq.subtitle')} actions={targets.length > 1 && (
        <select className="adm-select" value={target?.key} onChange={e => setSel(e.target.value)} aria-label={t('pq.location')}>{targets.map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</select>
      )} />
      <ErrorNote error={error} />
      {!data ? <div className="fx-center"><Loader2 className="adm-spin" /></div> : (
        <>
          <div className="fx-pq-head">
            <div className="fx-pq-now"><small>{t('queue.nowServing')}</small><b data-testid="pq-now">{q.nowServing ?? '—'}</b><span>{current?.patientName || ''}</span></div>
            <div className="fx-pq-stats">
              <span className={`adm-badge adm-badge-${q.status === 'running' ? 'green' : q.status === 'paused' ? 'amber' : 'slate'}`}>{t(`pq.st.${q.status}`)}</span>
              <span><Users size={13} /> {t('pq.waiting', { n: waiting })}</span>
              <span><Timer size={13} /> {t('pq.avg', { n: q.avgConsultMinutes })}</span>
              {q.delayMinutes > 0 && <span className="fx-warn"><Clock size={13} /> {t('queue.late', { n: q.delayMinutes })}</span>}
            </div>
          </div>
          <div className="fx-pq-controls">
            {q.status !== 'running'
              ? <button className="btn-primary adm-btn" onClick={() => act(q.status === 'paused' ? 'resume' : 'start')} disabled={Boolean(busy)} data-testid="pq-start"><Play size={15} /> {q.status === 'paused' ? t('pq.resume') : t('pq.start')}</button>
              : <button className="btn-secondary adm-btn" onClick={() => act('pause', { reason: window.prompt(t('pq.pauseReason')) || '' })} disabled={Boolean(busy)}><Pause size={15} /> {t('pq.pause')}</button>}
            <button className="btn-primary adm-btn fx-pq-next" onClick={() => act('next')} disabled={Boolean(busy) || q.status === 'closed'} data-testid="pq-next">{busy === 'next' ? <Loader2 size={15} className="adm-spin" /> : <Megaphone size={15} />} {t('pq.callNext')}</button>
            <button className="btn-secondary adm-btn" onClick={() => act('done')} disabled={Boolean(busy) || !current} data-testid="pq-done"><CheckCheck size={15} /> {t('pq.done')}</button>
            <button className="btn-secondary adm-btn" onClick={() => act('skip')} disabled={Boolean(busy) || !current} data-testid="pq-skip"><SkipForward size={15} /> {t('pq.skip')}</button>
            <form className="fx-row" onSubmit={e => { e.preventDefault(); act('delay', { minutes: Number(delay) || 0 }); setDelay(''); }}>
              <input className="adm-input" type="number" min="0" max="240" value={delay} onChange={e => setDelay(e.target.value)} placeholder={t('pq.minutes')} aria-label={t('pq.runningLate')} style={{ width: 90 }} />
              <button className="btn-secondary adm-btn" disabled={Boolean(busy) || delay === ''} data-testid="pq-delay"><Clock size={15} /> {t('pq.runningLate')}</button>
            </form>
            <button className="adm-btn adm-btn-danger-soft" onClick={() => act('close')} disabled={Boolean(busy) || q.status === 'closed'}><Square size={14} /> {t('pq.close')}</button>
          </div>
          <Card>
            {entries.length === 0 ? <p className="adm-muted">{t('pq.empty')}</p> : (
              <table className="adm-table fx-pq-table">
                <thead><tr><th>{t('pq.token')}</th><th>{t('pq.slot')}</th><th>{t('pq.patient')}</th><th>{t('pq.state')}</th><th>{t('queue.eta')}</th><th /></tr></thead>
                <tbody>
                  {entries.map(e => (
                    <tr key={e.id} className={e.queueStatus === 'in_consult' ? 'on' : ''} data-testid="pq-row">
                      <td><b>{e.token ?? '—'}</b></td>
                      <td>{fmtTime(e.timeSlot)}</td>
                      <td>{e.patientName}{e.amountDueAtClinic > 0 ? <small className="adm-muted"> • ₹{e.amountDueAtClinic}</small> : null}</td>
                      <td><span className={`adm-badge adm-badge-${TONE[e.queueStatus] || 'slate'}`}>{t(`pq.qs.${e.queueStatus}`)}</span>{e.status !== 'Confirmed' ? <small className="adm-muted"> {e.status}</small> : null}</td>
                      <td>{e.etaAt && e.queueStatus === 'waiting' ? new Date(e.etaAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : ''}</td>
                      <td>
                        {e.queueStatus === 'waiting' && e.status === 'Confirmed' && <button className="adm-act" onClick={() => act('skip', { bookingId: e.id })} disabled={Boolean(busy)}><SkipForward size={12} /> {t('pq.skip')}</button>}
                        {e.queueStatus === 'skipped' && <button className="adm-act adm-act-blue" onClick={() => act('recall', { bookingId: e.id })} disabled={Boolean(busy)}><Undo2 size={12} /> {t('pq.recall')}</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <p className="adm-small adm-muted">{t('pq.note')}</p>
        </>
      )}
    </div>
  );
}
