import React, { useEffect, useRef, useState } from 'react';
import { Users, Timer, PauseCircle, Clock, Radio, RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n';

const POLL_MS = 20000;

/** Live queue position + ETA for today's confirmed booking (polls; pauses when the tab is hidden). */
export default function QueueCard({ client, bookingId }) {
  const { t, meta } = useI18n();
  const [q, setQ] = useState(null);
  const [err, setErr] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      client.get(`/me/bookings/${bookingId}/queue`).then(r => { if (live) { setQ(r.queue); setErr(''); } }).catch(e => live && setErr(e.message));
    };
    load();
    timer.current = setInterval(load, POLL_MS);
    const vis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', vis);
    return () => { live = false; clearInterval(timer.current); document.removeEventListener('visibilitychange', vis); };
  }, [client, bookingId]);

  if (err && !q) return null;
  if (!q || !q.active) return null;
  const eta = q.etaAt ? new Date(q.etaAt).toLocaleTimeString(meta.locale, { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
  const mine = q.myStatus === 'in_consult';
  return (
    <section className={`fx-queue ${mine ? 'now' : ''}`} aria-live="polite" data-testid="queue-card">
      <div className="fx-row fx-between">
        <strong><Radio size={14} /> {t('queue.live')}</strong>
        <span className="adm-small adm-muted"><RefreshCw size={11} /> {t('queue.auto')}</span>
      </div>
      <div className="fx-queue-grid">
        <div><small>{t('queue.yourToken')}</small><b data-testid="queue-token">{q.token ?? '—'}</b></div>
        <div><small>{t('queue.nowServing')}</small><b>{q.nowServing ?? '—'}</b></div>
        <div><small><Users size={11} /> {t('queue.ahead')}</small><b data-testid="queue-position">{mine ? 0 : q.position ?? '—'}</b></div>
        <div><small><Timer size={11} /> {t('queue.eta')}</small><b data-testid="queue-eta">{mine ? t('queue.now') : eta || '—'}</b></div>
      </div>
      {mine && <p className="fx-queue-msg">{t('queue.yourTurn')}</p>}
      {!mine && q.myStatus === 'skipped' && <p className="fx-queue-msg warn">{t('queue.skipped')}</p>}
      {!mine && q.myStatus === 'done' && <p className="fx-queue-msg">{t('queue.done')}</p>}
      {q.queueStatus === 'not_started' && <p className="adm-small adm-muted"><Clock size={12} /> {t('queue.notStarted')}</p>}
      {q.queueStatus === 'paused' && <p className="adm-small fx-warn"><PauseCircle size={12} /> {t('queue.paused')}{q.pauseReason ? ` — ${q.pauseReason}` : ''}</p>}
      {q.delayMinutes > 0 && <p className="adm-small fx-warn"><Clock size={12} /> {t('queue.late', { n: q.delayMinutes })}</p>}
      {q.etaMinutes != null && !mine && q.position != null && <p className="adm-small adm-muted">{t('queue.etaNote', { n: q.etaMinutes, avg: q.avgConsultMinutes })}</p>}
    </section>
  );
}
