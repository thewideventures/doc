import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Stethoscope, Loader2, Calendar, MapPin, XCircle, CalendarClock, CheckCircle2, AlertCircle } from 'lucide-react';
import { apiFetch, fmtDate, fmtTime } from '../lib/api';
import { useT, LanguageSwitcher } from '../i18n';
import SlotPicker from '../patient/SlotPicker';

/** /appointment/:token — signed one-tap reschedule / cancel link from WhatsApp / SMS reminders (no sign-in needed). */
export default function ManageAppointment() {
  const { token } = useParams();
  const t = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [mode, setMode] = useState(''); // '' | reschedule | cancel
  const [pick, setPick] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const base = `/api/booking-links/${encodeURIComponent(token)}`;

  useEffect(() => {
    // the token is a credential: keep it out of history/referrers once loaded
    apiFetch(base).then(setData).catch(e => setError({ message: e.message, code: e.code }));
  }, [base]);

  const reschedule = async () => {
    setBusy(true);
    try { const r = await apiFetch(`${base}/reschedule`, { method: 'POST', body: pick }); setDone({ kind: 'reschedule', message: t('link.moved', { when: `${fmtDate(r.booking.date)} ${fmtTime(r.booking.timeSlot)}` }) }); }
    catch (e) { setError({ message: e.message, code: e.code, soft: true }); } finally { setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true);
    try { const r = await apiFetch(`${base}/cancel`, { method: 'POST', body: { reason: reason || undefined } }); setDone({ kind: 'cancel', message: r.refund?.amount > 0 ? t('link.cancelledRefund', { amount: `₹${r.refund.amount}` }) : t('link.cancelled') }); }
    catch (e) { setError({ message: e.message, code: e.code, soft: true }); } finally { setBusy(false); }
  };
  const b = data?.booking;

  return (
    <div className="fx-public-page">
      <header className="fx-public-head">
        <Link to="/" className="fx-row"><span className="fx-logo fx-logo-sm"><Stethoscope size={18} /></span><span className="fx-logo-text">FindA<span>Doc</span></span></Link>
        <LanguageSwitcher compact />
      </header>
      <main className="fx-public-main">
        <div className="adm-card fx-manage" data-testid="manage-appointment">
          <h1 className="fx-page-title">{t('link.title')}</h1>
          {error && !error.soft && (
            <div className="adm-alert adm-alert-error"><AlertCircle size={16} /> {error.code === 'LINK_EXPIRED' ? t('link.expired') : error.code === 'LINK_STALE' ? t('link.stale') : t('link.invalid')}
              <p className="fx-mt"><Link className="adm-link" to="/bookings">{t('link.signIn')}</Link></p></div>
          )}
          {!data && !error && <div className="fx-center"><Loader2 className="adm-spin" /></div>}
          {done ? (
            <div className="fx-done"><CheckCircle2 size={40} /><p>{done.message}</p><Link className="btn-primary adm-btn" to="/bookings">{t('nav.bookings')}</Link></div>
          ) : b && (
            <>
              <dl className="fx-breakdown">
                <div><dt>{t('book.token')}</dt><dd className="adm-code">{b.bookingCode}</dd></div>
                <div><dt>{t('link.doctor')}</dt><dd>{b.doctorName}</dd></div>
                <div><dt><Calendar size={13} /> {t('book.when')}</dt><dd>{fmtDate(b.date)}, {fmtTime(b.timeSlot)}</dd></div>
                <div><dt><MapPin size={13} /> {t('book.where')}</dt><dd>{b.locationName}{b.locationAddress ? <small className="adm-muted"><br />{b.locationAddress}</small> : null}</dd></div>
                <div><dt>{t('link.patient')}</dt><dd>{b.patientName}</dd></div>
                <div><dt>{t('link.status')}</dt><dd>{t(`bst.${b.status}`)}</dd></div>
              </dl>
              {error?.soft && <div className="adm-alert adm-alert-error">{error.message}</div>}
              {!data.canCancel && !data.canReschedule && <p className="adm-muted">{t('link.nothing')}</p>}
              {!mode && (
                <div className="fx-row fx-wrap">
                  {data.canReschedule && <button className="btn-primary adm-btn" onClick={() => setMode('reschedule')} data-testid="link-reschedule"><CalendarClock size={15} /> {t('bk.reschedule')}</button>}
                  {data.canCancel && <button className="adm-btn adm-btn-danger-soft" onClick={() => setMode('cancel')} data-testid="link-cancel"><XCircle size={15} /> {t('bk.cancelConfirm')}</button>}
                </div>
              )}
              {data.canCancel && !data.canReschedule && !mode && <p className="adm-small adm-muted">{t('link.noReschedule', { n: data.cancellationWindowHours })}</p>}
              {mode === 'reschedule' && (
                <>
                  <SlotPicker dates={data.dates} value={pick} onChange={setPick} exclude={{ date: b.date, time: b.timeSlot }} loadSlots={d => apiFetch(`${base}/availability?date=${d}`)} />
                  <div className="fx-row fx-mt"><button className="btn-secondary adm-btn" onClick={() => setMode('')}>{t('common.back')}</button>
                    <button className="btn-primary adm-btn" disabled={!pick || busy} onClick={reschedule} data-testid="link-reschedule-save">{busy && <Loader2 size={14} className="adm-spin" />} {pick ? t('bk.moveTo', { when: `${fmtDate(pick.date)} ${fmtTime(pick.time)}` }) : t('bk.pickSlot')}</button></div>
                </>
              )}
              {mode === 'cancel' && (
                <>
                  <p className="adm-small">{data.refundEligible ? (b.amountPaidOnline > 0 ? t('link.refundYes') : '') : t('link.refundNo', { n: data.cancellationWindowHours })}</p>
                  <label className="adm-field"><span>{t('bk.reason')}</span><input value={reason} maxLength={300} onChange={e => setReason(e.target.value)} /></label>
                  <div className="fx-row fx-mt"><button className="btn-secondary adm-btn" onClick={() => setMode('')}>{t('common.back')}</button>
                    <button className="adm-btn adm-btn-danger" disabled={busy} onClick={cancel} data-testid="link-cancel-confirm">{busy && <Loader2 size={14} className="adm-spin" />} {t('bk.cancelConfirm')}</button></div>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
