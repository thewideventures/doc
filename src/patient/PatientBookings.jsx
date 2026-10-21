import React, { useState } from 'react';
import { Calendar, Navigation, XCircle, Star, MapPin, Receipt, Loader2 } from 'lucide-react';
import { Tabs, Pagination, useAdminList, useToast, useConfirm, ErrorNote } from '../admin/ui';
import { inr, fmtDate, fmtTime, LOCATION_KIND_LABEL } from '../lib/api';
import { BookingStatus } from '../portal/BookingsPanel';
import { ModeBadge } from '../components/BookingModal';

const TABS = [{ value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }, { value: 'cancelled', label: 'Cancelled' }, { value: 'all', label: 'All' }];
const REFUND_TEXT = { processed: 'Refund processed', failed: 'Refund failed — support will contact you', not_eligible: 'Not eligible for refund' };

/** Patient booking history with cancel (refund rules shown) and review shortcuts. */
export default function PatientBookings({ client, onFindDoctors, onReview }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const list = useAdminList(client, '/me/bookings', { tab: 'upcoming', limit: 10 });
  const [busy, setBusy] = useState('');

  const cancel = b => confirm({
    title: 'Cancel this appointment?', danger: true, confirmLabel: 'Cancel appointment',
    message: `${b.doctorName} • ${fmtDate(b.date)} ${fmtTime(b.timeSlot)}. ${b.amountPaidOnline > 0 ? 'Cancelling early refunds the consultation / booking amount (platform fee is non-refundable). Late cancellations are not refunded.' : ''}`,
    input: { label: 'Reason (optional)', placeholder: 'e.g. Feeling better' },
    onConfirm: async reason => {
      setBusy(b.id);
      try { const r = await client.post(`/me/bookings/${b.id}/cancel`, { reason }); toast.success(r.message); list.reload(); }
      catch (e) { toast.error(e.message); throw e; } finally { setBusy(''); }
    }
  });

  const items = list.data.items || [];
  return (
    <div>
      <Tabs tabs={TABS} value={list.params.tab} onChange={tab => list.update({ tab })} />
      <ErrorNote error={list.error} />
      {list.loading && !items.length ? <div className="fx-center"><Loader2 className="adm-spin" /></div> : items.length === 0 ? (
        <div className="fx-empty">
          <Calendar size={36} />
          <h3>{list.params.tab === 'upcoming' ? 'No upcoming appointments' : 'Nothing here yet'}</h3>
          <p className="adm-muted">Find a doctor and book a slot in under a minute.</p>
          <button className="btn-primary adm-btn" onClick={onFindDoctors}>Find doctors</button>
        </div>
      ) : (
        <div className="fx-booking-list">
          {items.map(b => (
            <article key={b.id} className="fx-booking-card">
              <div className="fx-row fx-between">
                <span className="fx-token">Token {b.bookingCode}</span>
                <BookingStatus status={b.status} />
              </div>
              <h3>{b.doctorName}</h3>
              <p className="adm-small"><Calendar size={13} /> <strong>{fmtDate(b.date)}</strong> at <strong>{fmtTime(b.timeSlot)}</strong></p>
              <p className="adm-small"><MapPin size={13} /> {b.locationName || b.clinicName}{b.locationKind ? ` • ${LOCATION_KIND_LABEL[b.locationKind]}` : ''}</p>
              {b.forMember?.name && <p className="adm-small adm-muted">For {b.forMember.name} ({b.forMember.relation})</p>}
              <div className="fx-row fx-wrap"><ModeBadge mode={b.bookingMode} />
                {b.amountPaidOnline > 0 && <span className="adm-small">Paid {inr(b.amountPaidOnline)}</span>}
                {b.amountDueAtClinic > 0 && ['Pending', 'Confirmed'].includes(b.status) && <span className="adm-small">• {inr(b.amountDueAtClinic)} at clinic</span>}
              </div>
              {b.status === 'Cancelled' && (
                <p className="adm-small fx-refund"><Receipt size={12} /> {b.cancelReason ? `${b.cancelReason}. ` : ''}{b.refundAmount > 0 ? `${inr(b.refundAmount)} refunded` : REFUND_TEXT[b.refundStatus] || ''}</p>
              )}
              {b.status === 'AwaitingPayment' && <p className="adm-small adm-muted">Payment not completed — the slot is released automatically after 15 minutes.</p>}
              <div className="fx-row fx-wrap fx-mt">
                {b.directionsUrl && ['Pending', 'Confirmed'].includes(b.status) && <a className="btn-secondary adm-btn adm-btn-sm" href={b.directionsUrl} target="_blank" rel="noopener noreferrer"><Navigation size={14} /> Directions</a>}
                {['Pending', 'Confirmed', 'AwaitingPayment'].includes(b.status) && <button className="adm-btn adm-btn-danger-soft adm-btn-sm" disabled={busy === b.id} onClick={() => cancel(b)}><XCircle size={14} /> Cancel</button>}
                {b.status === 'Completed' && onReview && <button className="btn-secondary adm-btn adm-btn-sm" onClick={() => onReview({ id: b.doctorId, name: b.doctorName })}><Star size={14} /> Rate visit</button>}
              </div>
            </article>
          ))}
        </div>
      )}
      <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} limit={list.data.limit} onPage={page => list.update({ page })} />
      {confirmEl}
    </div>
  );
}
