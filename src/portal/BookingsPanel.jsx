import React, { useMemo, useState } from 'react';
import { Phone, Check, CheckCheck, XCircle, UserX, Navigation, IndianRupee, Clock } from 'lucide-react';
import { DataTable, Pagination, FilterBar, Tabs, useAdminList, useToast, useConfirm, ErrorNote } from '../admin/ui';
import { inr, fmtDate, fmtTime, todayIST, LOCATION_KIND_LABEL } from '../lib/api';
import { ModeBadge } from '../components/BookingModal';

const STATUS_TONE = { Confirmed: 'green', Pending: 'amber', AwaitingPayment: 'purple', Completed: 'blue', Cancelled: 'rose', NoShow: 'slate', Expired: 'slate' };
const STATUS_TEXT = { AwaitingPayment: 'Awaiting payment', NoShow: 'No-show' };
export function BookingStatus({ status }) {
  return <span className={`adm-badge adm-badge-${STATUS_TONE[status] || 'slate'}`}>{STATUS_TEXT[status] || status}</span>;
}

const SCOPES = [
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'pending', label: 'Requests' },
  { value: 'past', label: 'Past' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' }
];

/**
 * Doctor / clinic bookings: today / upcoming / requests / past views, filters, pagination and actions
 * (accept, complete, no-show, cancel with reason). base = '/doctor-portal' | '/clinic-portal'.
 */
export default function BookingsPanel({ client, base, locations = [], doctors = [], showDoctor = false, toolbar, refreshKey = 0, onChanged }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const list = useAdminList(client, `${base}/bookings`, { scope: 'today', limit: 20 });
  const [busyId, setBusyId] = useState('');
  React.useEffect(() => { if (refreshKey) list.reload(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (b, action, reason) => {
    setBusyId(b.id);
    try {
      const r = await client.post(`${base}/bookings/${b.id}/${action}`, reason ? { reason } : {});
      toast.success(r.message);
      list.reload(); onChanged?.();
    } catch (e) { toast.error(e.message); throw e; } finally { setBusyId(''); }
  };
  const cancel = b => confirm({
    title: `Cancel booking ${b.bookingCode || ''}`, danger: true, confirmLabel: 'Cancel booking',
    message: `${b.patientName} • ${fmtDate(b.date)} ${fmtTime(b.timeSlot)}. The patient is notified${b.amountPaidOnline > 0 ? ` and ${inr(b.amountPaidOnline)} is refunded in full` : ''}.`,
    input: { label: 'Reason (shared with the patient)', required: true, minLength: 3, placeholder: 'e.g. Doctor on emergency leave' },
    onConfirm: reason => act(b, 'cancel', reason)
  });

  const filters = useMemo(() => [
    { key: 'search', type: 'search', label: 'Search patient, phone or token' },
    ...(showDoctor && doctors.length ? [{ key: 'doctorId', type: 'select', label: 'Doctor', options: [{ value: '', label: 'All doctors' }, ...doctors.map(d => ({ value: d.id, label: d.name }))] }] : []),
    ...(locations.length > 1 ? [{ key: 'locationId', type: 'select', label: 'Location', options: [{ value: '', label: 'All locations' }, ...locations.map(l => ({ value: l.id, label: l.name }))] }] : []),
    { key: 'mode', type: 'select', label: 'Booking mode', options: [{ value: '', label: 'All modes' }, { value: 'free', label: 'Free' }, { value: 'paid', label: 'Paid' }, { value: 'token', label: 'Booking amount' }, { value: 'offline', label: 'Walk-in' }] },
    ...(['past', 'all'].includes(list.params.scope) ? [{ key: 'from', type: 'date', label: 'From' }, { key: 'to', type: 'date', label: 'To' }] : [])
  ], [showDoctor, doctors, locations, list.params.scope]);

  const today = todayIST();
  const columns = [
    { key: 'when', label: 'When', render: b => <div className="adm-stack"><strong>{fmtTime(b.timeSlot)}</strong><small>{b.date === today ? 'Today' : fmtDate(b.date)}</small></div> },
    { key: 'patient', label: 'Patient', render: b => (
      <div className="adm-stack">
        <strong>{b.patientName}{b.forMember?.name && b.forMember.name !== b.patientName ? ` (for ${b.forMember.name})` : ''}</strong>
        {b.patientPhone && <a className="adm-link" href={`tel:${b.patientPhone.replace(/\s/g, '')}`}><Phone size={12} /> {b.patientPhone}</a>}
        {b.note && <small title={b.note} className="adm-reason">“{b.note}”</small>}
      </div>
    ) },
    ...(showDoctor ? [{ key: 'doctor', label: 'Doctor', render: b => b.doctorName }] : []),
    { key: 'loc', label: 'Location', render: b => <div className="adm-stack"><span>{b.locationName || '—'}</span><small>{LOCATION_KIND_LABEL[b.locationKind] || ''}{b.source === 'clinic' ? ' • walk-in' : ''}</small></div> },
    { key: 'pay', label: 'Payment', render: b => (
      <div className="adm-stack">
        <ModeBadge mode={b.bookingMode} />
        <small>{b.amountPaidOnline > 0 ? `${inr(b.amountPaidOnline)} paid online` : 'Nothing online'}{b.amountDueAtClinic > 0 ? ` • ${inr(b.amountDueAtClinic)} at clinic` : ''}</small>
        {b.refundAmount > 0 && <small className="fx-refund">Refunded {inr(b.refundAmount)}</small>}
      </div>
    ) },
    { key: 'status', label: 'Status', render: b => <div className="adm-stack"><BookingStatus status={b.status} /><small className="adm-code">{b.bookingCode}</small>{b.cancelReason && <small className="adm-reason" title={b.cancelReason}>{b.cancelReason}</small>}</div> },
    { key: 'actions', label: 'Actions', render: b => {
      const busy = busyId === b.id;
      const future = b.date > today;
      return (
        <div className="adm-actions">
          {b.status === 'Pending' && <button className="adm-act adm-act-green" disabled={busy} onClick={() => act(b, 'accept').catch(() => {})}><Check size={13} /> Accept</button>}
          {b.status === 'Confirmed' && !future && <button className="adm-act adm-act-blue" disabled={busy} onClick={() => act(b, 'complete').catch(() => {})}><CheckCheck size={13} /> Complete</button>}
          {b.status === 'Confirmed' && !future && <button className="adm-act adm-act-amber" disabled={busy} onClick={() => act(b, 'no-show').catch(() => {})}><UserX size={13} /> No-show</button>}
          {['Pending', 'Confirmed', 'AwaitingPayment'].includes(b.status) && <button className="adm-act adm-act-rose" disabled={busy} onClick={() => cancel(b)}><XCircle size={13} /> {b.status === 'Pending' ? 'Decline' : 'Cancel'}</button>}
          {b.directionsUrl && b.locationKind === 'home_visit' && <a className="adm-act" href={b.directionsUrl} target="_blank" rel="noopener noreferrer"><Navigation size={13} /> Map</a>}
        </div>
      );
    } }
  ];

  const items = list.data.items || [];
  const dueAtClinic = items.filter(b => ['Confirmed', 'Pending'].includes(b.status)).reduce((s, b) => s + (b.amountDueAtClinic || 0), 0);

  return (
    <div>
      <div className="fx-row fx-wrap fx-between">
        <Tabs tabs={SCOPES} value={list.params.scope} onChange={scope => list.update({ scope, from: '', to: '' })} />
        {toolbar}
      </div>
      <FilterBar fields={filters} values={list.params} onChange={list.update} onReset={() => list.update({ search: '', doctorId: '', locationId: '', mode: '', from: '', to: '' })} />
      <ErrorNote error={list.error} />
      {items.length > 0 && (
        <div className="adm-summary-strip">
          <span><Clock size={13} /> {list.data.total} booking{list.data.total === 1 ? '' : 's'}</span>
          {dueAtClinic > 0 && <span><IndianRupee size={13} /> {inr(dueAtClinic)} to collect at clinic (this page)</span>}
        </div>
      )}
      <DataTable columns={columns} rows={items} loading={list.loading}
        empty={{ today: 'No appointments today.', upcoming: 'No upcoming bookings yet.', pending: 'No booking requests waiting for you.', past: 'No past bookings.', cancelled: 'No cancelled bookings.' }[list.params.scope] || 'No bookings found'} />
      <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} limit={list.data.limit} onPage={page => list.update({ page })} onLimit={limit => list.update({ limit })} />
      {confirmEl}
    </div>
  );
}
