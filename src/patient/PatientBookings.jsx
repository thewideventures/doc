import React, { useEffect, useState } from 'react';
import { Calendar, Navigation, XCircle, Star, MapPin, Receipt, Loader2, CalendarClock, Share2, Pill, Repeat, CheckCircle2 } from 'lucide-react';
import { Tabs, Pagination, useAdminList, useToast, useConfirm, ErrorNote, Modal } from '../admin/ui';
import { apiFetch, inr, fmtDate, fmtTime, todayIST } from '../lib/api';
import { BookingStatus } from '../portal/BookingsPanel';
import { ModeBadge } from '../components/BookingModal';
import { useT, enumLabel } from '../i18n';
import QueueCard from './QueueCard';
import SlotPicker from './SlotPicker';
import ShareRecordsModal from './ShareRecordsModal';
import PrescriptionModal from './PrescriptionModal';
import WaitlistPanel from './WaitlistPanel';

const TABS = ['upcoming', 'past', 'cancelled', 'all'];

function RescheduleModal({ client, booking, onClose, onDone }) {
  const t = useT();
  const [dates, setDates] = useState(null);
  const [pick, setPick] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    apiFetch(`/api/doctors/${encodeURIComponent(booking.doctorId)}/availability?locationId=${encodeURIComponent(booking.locationId)}`)
      .then(r => setDates(r.dates || [])).catch(e => { setError(e.message); setDates([]); });
  }, [booking]);
  const save = async () => {
    setBusy(true); setError('');
    try { const r = await client.post(`/me/bookings/${booking.id}/reschedule`, pick); onDone(r); } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal open title={<><CalendarClock size={16} /> {t('bk.reschedule')}</>} onClose={busy ? undefined : onClose} width={560}
      footer={<><button className="btn-secondary adm-btn" onClick={onClose} disabled={busy}>{t('common.cancel')}</button>
        <button className="btn-primary adm-btn" disabled={!pick || busy} onClick={save} data-testid="reschedule-save">{busy && <Loader2 size={14} className="adm-spin" />} {pick ? t('bk.moveTo', { when: `${fmtDate(pick.date)} ${fmtTime(pick.time)}` }) : t('bk.pickSlot')}</button></>}>
      <ErrorNote error={error} />
      <p className="adm-small adm-muted">{t('bk.current')}: <b>{fmtDate(booking.date)} {fmtTime(booking.timeSlot)}</b> • {t('bk.rescheduleRule')}</p>
      {dates === null ? <div className="fx-center"><Loader2 className="adm-spin" /></div> : (
        <SlotPicker dates={dates} value={pick} onChange={setPick} exclude={{ date: booking.date, time: booking.timeSlot }}
          loadSlots={d => apiFetch(`/api/doctors/${encodeURIComponent(booking.doctorId)}/availability?locationId=${encodeURIComponent(booking.locationId)}&date=${d}`)} />
      )}
    </Modal>
  );
}

/** Patient bookings: live queue, reschedule, cancel, share records, prescriptions, follow-ups, verified reviews, waitlists. */
export default function PatientBookings({ client, onFindDoctors, onReview, onFollowUp, highlightWaitlist, initialTab }) {
  const t = useT();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const list = useAdminList(client, '/me/bookings', { tab: TABS.includes(initialTab) ? initialTab : 'upcoming', limit: 10 });
  const [busy, setBusy] = useState('');
  const [resched, setResched] = useState(null);
  const [share, setShare] = useState(null);
  const [rx, setRx] = useState(null);
  const today = todayIST();

  const cancel = b => confirm({
    title: t('bk.cancelTitle'), danger: true, confirmLabel: t('bk.cancelConfirm'),
    message: `${b.doctorName} • ${fmtDate(b.date)} ${fmtTime(b.timeSlot)}. ${b.amountPaidOnline > 0 ? t('bk.cancelRefundRule') : ''}`,
    input: { label: t('bk.reason'), placeholder: t('bk.reasonPh') },
    onConfirm: async reason => {
      setBusy(b.id);
      try { const r = await client.post(`/me/bookings/${b.id}/cancel`, { reason }); toast.success(r.message); list.reload(); }
      catch (e) { toast.error(e.message); throw e; } finally { setBusy(''); }
    }
  });
  const openRx = async b => {
    setBusy(b.id);
    try { const r = await client.get(`/me/prescriptions/${b.prescriptionId}`); setRx({ rx: r.prescription, booking: b }); } catch (e) { toast.error(e.message); } finally { setBusy(''); }
  };
  const followUp = b => onFollowUp?.({ doctorId: b.doctorId, locationId: b.locationId, bookingId: b.id, memberId: b.forMember?.id || '' });

  const items = list.data.items || [];
  return (
    <div>
      <WaitlistPanel client={client} highlight={highlightWaitlist} onBooked={() => list.reload()} />
      <Tabs tabs={TABS.map(v => ({ value: v, label: t(`bk.tab.${v}`) }))} value={list.params.tab} onChange={tab => list.update({ tab })} />
      <ErrorNote error={list.error} />
      {list.loading && !items.length ? <div className="fx-center"><Loader2 className="adm-spin" /></div> : items.length === 0 ? (
        <div className="fx-empty">
          <Calendar size={36} />
          <h3>{list.params.tab === 'upcoming' ? t('bk.noneUpcoming') : t('bk.nothing')}</h3>
          <p className="adm-muted">{t('bk.findPitch')}</p>
          <button className="btn-primary adm-btn" onClick={onFindDoctors}>{t('nav.find')}</button>
        </div>
      ) : (
        <div className="fx-booking-list">
          {items.map(b => {
            const active = ['Pending', 'Confirmed'].includes(b.status);
            return (
              <article key={b.id} className="fx-booking-card" data-testid="booking-card">
                <div className="fx-row fx-between">
                  <span className="fx-token">{t('book.token')} {b.bookingCode}</span>
                  <BookingStatus status={b.status} />
                </div>
                <h3>{b.doctorName}</h3>
                <p className="adm-small"><Calendar size={13} /> <strong>{fmtDate(b.date)}</strong> {t('bk.at')} <strong>{fmtTime(b.timeSlot)}</strong>{b.rescheduleCount > 0 ? <span className="adm-muted"> • {t('bk.rescheduled')}</span> : null}</p>
                <p className="adm-small"><MapPin size={13} /> {b.locationName || b.clinicName}{b.locationKind ? ` • ${t(`kind.${b.locationKind}`)}` : ''}</p>
                {b.forMember?.name && <p className="adm-small adm-muted">{t('bk.for', { name: b.forMember.name, relation: enumLabel(t, 'rel', b.forMember.relation) })}</p>}
                {b.followUpOf && <p className="adm-small adm-muted"><Repeat size={12} /> {t('bk.followUpVisit')}</p>}
                <div className="fx-row fx-wrap"><ModeBadge mode={b.bookingMode} />
                  {b.amountPaidOnline > 0 && <span className="adm-small">{t('bk.paid', { amount: inr(b.amountPaidOnline) })}</span>}
                  {b.amountDueAtClinic > 0 && active && <span className="adm-small">• {t('bk.dueAtClinic', { amount: inr(b.amountDueAtClinic) })}</span>}
                </div>
                {b.status === 'Confirmed' && b.date === today && <QueueCard client={client} bookingId={b.id} />}
                {b.status === 'Cancelled' && (
                  <p className="adm-small fx-refund"><Receipt size={12} /> {b.cancelReason ? `${b.cancelReason}. ` : ''}{b.refundAmount > 0 ? t('bk.refunded', { amount: inr(b.refundAmount) }) : b.refundStatus ? t(`refund.${b.refundStatus}`) : ''}</p>
                )}
                {b.status === 'AwaitingPayment' && <p className="adm-small adm-muted">{t('bk.awaitingPayment', { n: 10 })}</p>}
                <div className="fx-row fx-wrap fx-mt">
                  {b.directionsUrl && active && <a className="btn-secondary adm-btn adm-btn-sm" href={b.directionsUrl} target="_blank" rel="noopener noreferrer"><Navigation size={14} /> {t('common.directions')}</a>}
                  {active && (b.rescheduleCount || 0) < 3 && <button className="btn-secondary adm-btn adm-btn-sm" onClick={() => setResched(b)} data-testid="reschedule"><CalendarClock size={14} /> {t('bk.reschedule')}</button>}
                  {['Pending', 'Confirmed', 'Completed'].includes(b.status) && <button className="btn-secondary adm-btn adm-btn-sm" onClick={() => setShare(b)} data-testid="share-records"><Share2 size={14} /> {t('bk.shareRecords')}</button>}
                  {b.prescriptionId && <button className="btn-secondary adm-btn adm-btn-sm" disabled={busy === b.id} onClick={() => openRx(b)} data-testid="view-rx"><Pill size={14} /> {t('bk.prescription')}</button>}
                  {b.status === 'Completed' && <button className={`${b.followUpSuggested ? 'btn-primary' : 'btn-secondary'} adm-btn adm-btn-sm`} onClick={() => followUp(b)} data-testid="follow-up"><Repeat size={14} /> {t('bk.followUp')}</button>}
                  {['Pending', 'Confirmed', 'AwaitingPayment'].includes(b.status) && <button className="adm-btn adm-btn-danger-soft adm-btn-sm" disabled={busy === b.id} onClick={() => cancel(b)}><XCircle size={14} /> {t('common.cancel')}</button>}
                  {b.status === 'Completed' && onReview && (b.reviewed
                    ? <span className="adm-small fx-ok"><CheckCircle2 size={13} /> {t('bk.reviewed')}</span>
                    : <button className="btn-secondary adm-btn adm-btn-sm" onClick={() => onReview({ id: b.doctorId, name: b.doctorName, bookingId: b.id, date: b.date })} data-testid="rate-visit"><Star size={14} /> {t('bk.rate')}</button>)}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} limit={list.data.limit} onPage={page => list.update({ page })} />
      {resched && <RescheduleModal client={client} booking={resched} onClose={() => setResched(null)} onDone={r => { setResched(null); toast.success(r.message); list.reload(); }} />}
      {share && <ShareRecordsModal client={client} booking={share} onClose={() => setShare(null)} />}
      {rx && <PrescriptionModal client={client} rx={rx.rx} onClose={() => setRx(null)} onFollowUp={() => { const b = rx.booking; setRx(null); followUp(b); }} />}
      {confirmEl}
    </div>
  );
}
