import React, { useCallback, useEffect, useState } from 'react';
import { BellRing, Loader2, X, Zap } from 'lucide-react';
import { useToast } from '../admin/ui';
import { fmtDate, fmtTime } from '../lib/api';
import PaymentSheet from '../components/PaymentSheet';
import { useT } from '../i18n';

/** Active waitlists; an offered slot can be claimed first-come until the offer expires. */
export default function WaitlistPanel({ client, highlight, onBooked }) {
  const t = useT();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState('');
  const [payment, setPayment] = useState(null);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(() => client.get('/me/waitlist').then(r => setItems(r.items || [])).catch(() => {}), [client]);
  useEffect(() => { load(); const i = setInterval(load, 30000); const c = setInterval(() => setNow(Date.now()), 15000); return () => { clearInterval(i); clearInterval(c); }; }, [load]);

  if (!items.length) return null;
  const claim = async e => {
    setBusy(e.id);
    try {
      const r = await client.post(`/me/waitlist/${e.id}/claim`);
      if (r.requiresPayment) setPayment({ ...r, entry: e });
      else { toast.success(r.message); onBooked?.(); }
      load();
    } catch (err) { toast.error(err.message); load(); } finally { setBusy(''); }
  };
  const leave = async e => { setBusy(e.id); try { await client.del(`/me/waitlist/${e.id}`); load(); } catch (err) { toast.error(err.message); } finally { setBusy(''); } };
  return (
    <section className="fx-waitlist" aria-label={t('wl.title')}>
      <h3 className="fx-label"><BellRing size={14} /> {t('wl.title')}</h3>
      <ul>
        {items.map(e => {
          const mins = e.offerExpiresAt ? Math.max(0, Math.ceil((new Date(e.offerExpiresAt).getTime() - now) / 60000)) : 0;
          const offered = e.status === 'offered' && mins > 0;
          return (
            <li key={e.id} className={`${offered ? 'offered' : ''} ${highlight === e.id ? 'hl' : ''}`} data-testid="waitlist-item">
              <div><strong>{e.doctorName}</strong><small>{e.locationName} • {fmtDate(e.date)}{e.time ? ` ${fmtTime(e.time)}` : ''}{e.patientName ? ` • ${e.patientName}` : ''}</small>
                {offered ? <small className="fx-ok"><Zap size={12} /> {t('wl.offered', { time: fmtTime(e.offeredTime), n: mins })}</small> : <small className="adm-muted">{t('wl.waiting')}</small>}
              </div>
              <div className="fx-row">
                {offered && <button className="btn-primary adm-btn adm-btn-sm" disabled={busy === e.id} onClick={() => claim(e)} data-testid="waitlist-claim">{busy === e.id ? <Loader2 size={13} className="adm-spin" /> : null} {t('wl.claim')}</button>}
                <button className="adm-icon-btn" disabled={busy === e.id} onClick={() => leave(e)} aria-label={t('wl.leave')}><X size={15} /></button>
              </div>
            </li>
          );
        })}
      </ul>
      {payment && (
        <PaymentSheet payment={payment.payment} client={client} title={t('book.payTitle')}
          description={`${payment.entry.doctorName} • ${fmtDate(payment.booking.date)}, ${fmtTime(payment.booking.timeSlot)} • ${t('book.heldFor', { n: 10 })}`}
          breakdown={[...(payment.quote.passThrough > 0 ? [{ label: t('book.consultFee'), value: payment.quote.passThrough }] : []), ...(payment.quote.platformFee > 0 ? [{ label: t('book.platformFee'), value: payment.quote.platformFee }] : [])]}
          onSuccess={r => { setPayment(null); toast.success(r.message || t('book.confirmed')); onBooked?.(); }}
          onCancel={() => { setPayment(null); toast.info(t('book.payCancelled')); onBooked?.(); }} />
      )}
    </section>
  );
}
