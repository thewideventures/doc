import React, { useState } from 'react';
import { XCircle, Eye } from 'lucide-react';
import { PageHeader, FilterBar, DataTable, Pagination, Modal, KpiCard, useAdminList, useToast, useConfirm, ErrorNote, Tabs } from '../ui';
import { inr, fmtDateTime } from '../api';
import { BookingStatus } from '../../portal/BookingsPanel';
import { ModeBadge } from '../../components/BookingModal';
import { fmtDate, fmtTime, LOCATION_KIND_LABEL } from '../../lib/api';
import { CalendarCheck, IndianRupee, Undo2, Store } from 'lucide-react';
import RefundModal from '../RefundModal';

const SCOPES = [{ value: 'all', label: 'All' }, { value: 'today', label: 'Today' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'pending', label: 'Requests' }, { value: 'past', label: 'Past' }, { value: 'cancelled', label: 'Cancelled' }];

/** Admin: every booking on the platform with filters, totals, detail (ledger + payment order) and cancel/refund. */
export default function Bookings({ api }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const list = useAdminList(api, '/bookings', { scope: 'all', sort: 'newest' });
  const [detail, setDetail] = useState(null);
  const [refund, setRefund] = useState(null);

  const open = async b => { try { setDetail(await api.get(`/bookings/${b.id}`)); } catch (e) { toast.error(e.message); } };
  const cancel = b => confirm({
    title: `Cancel ${b.bookingCode}?`, danger: true, confirmLabel: 'Cancel & refund',
    message: `Admin cancellations refund the full online amount${b.amountPaidOnline > 0 ? ` (${inr(b.amountPaidOnline)})` : ''} and issue a GST credit note for the platform fee.`,
    input: { label: 'Reason (sent to patient & doctor)', required: true, minLength: 3 },
    onConfirm: async reason => { try { const r = await api.post(`/bookings/${b.id}/cancel`, { reason }); toast.success(r.message); list.reload(); setDetail(null); } catch (e) { toast.error(e.message); throw e; } }
  });

  const fields = [
    { key: 'search', type: 'search', label: 'Token, patient, phone, doctor, clinic' },
    { key: 'status', type: 'select', label: 'Status', options: [{ value: '', label: 'Any' }, ...['AwaitingPayment', 'Pending', 'Confirmed', 'Completed', 'Cancelled', 'NoShow', 'Expired'].map(s => ({ value: s, label: s }))] },
    { key: 'mode', type: 'select', label: 'Mode', options: [{ value: '', label: 'Any' }, { value: 'free', label: 'Free' }, { value: 'paid', label: 'Paid' }, { value: 'token', label: 'Booking amount' }, { value: 'offline', label: 'Walk-in' }, { value: 'legacy', label: 'Legacy' }] },
    { key: 'locationKind', type: 'select', label: 'Location', options: [{ value: '', label: 'Any' }, ...Object.entries(LOCATION_KIND_LABEL).map(([value, label]) => ({ value, label }))] },
    { key: 'refundStatus', type: 'select', label: 'Refund', options: [{ value: '', label: 'Any' }, { value: 'processed', label: 'Refunded' }, { value: 'not_eligible', label: 'Not eligible' }, { value: 'failed', label: 'Failed' }] },
    { key: 'slotFrom', type: 'date', label: 'Visit from' },
    { key: 'slotTo', type: 'date', label: 'Visit to' },
    { key: 'sort', type: 'select', label: 'Sort', options: [{ value: 'newest', label: 'Newest booked' }, { value: 'slot_asc', label: 'Visit date ↑' }, { value: 'slot_desc', label: 'Visit date ↓' }, { value: 'amount_desc', label: 'Amount ↓' }] }
  ];
  const columns = [
    { key: 'code', label: 'Token', render: b => <div className="adm-stack"><strong className="adm-code">{b.bookingCode}</strong><small>{fmtDateTime(b.createdAt)}</small></div> },
    { key: 'slot', label: 'Visit', render: b => <div className="adm-stack"><span>{fmtDate(b.date)}</span><small>{fmtTime(b.timeSlot)}</small></div> },
    { key: 'patient', label: 'Patient', render: b => <div className="adm-stack"><span>{b.patientName}</span><small>{b.patientPhone}</small></div> },
    { key: 'doctor', label: 'Doctor / location', render: b => <div className="adm-stack"><span>{b.doctorName}</span><small>{b.locationName || b.clinicName} {b.locationKind ? `• ${LOCATION_KIND_LABEL[b.locationKind]}` : ''}</small></div> },
    { key: 'mode', label: 'Mode', render: b => <ModeBadge mode={b.bookingMode} /> },
    { key: 'online', label: 'Online', align: 'right', render: b => <div className="adm-stack" style={{ alignItems: 'flex-end' }}><span>{inr(b.amountPaidOnline)}</span>{b.refundAmount > 0 && <small className="fx-refund">−{inr(b.refundAmount)}</small>}</div> },
    { key: 'status', label: 'Status', render: b => <BookingStatus status={b.status} /> },
    { key: 'act', label: '', render: b => <div className="adm-actions"><button className="adm-act" onClick={e => { e.stopPropagation(); open(b); }}><Eye size={13} /> View</button>{['Pending', 'Confirmed', 'AwaitingPayment'].includes(b.status) && <button className="adm-act adm-act-rose" onClick={e => { e.stopPropagation(); cancel(b); }}><XCircle size={13} /> Cancel</button>}</div> }
  ];
  const t = list.data.totals || {};
  const c = list.data.counts || {};
  return (
    <>
      <PageHeader title="Bookings" subtitle="All appointments across doctors and clinics" />
      <div className="adm-kpi-grid adm-kpi-grid-sm">
        <KpiCard icon={CalendarCheck} label="Matching bookings" value={list.data.total ?? 0} sub={`${c.Confirmed || 0} confirmed • ${c.Pending || 0} requests`} tone="blue" />
        <KpiCard icon={IndianRupee} label="Collected online" value={inr(t.online)} tone="green" />
        <KpiCard icon={Undo2} label="Refunded" value={inr(t.refunds)} tone="rose" />
        <KpiCard icon={Store} label="Due at clinics" value={inr(t.dueAtClinic)} tone="amber" />
      </div>
      <Tabs tabs={SCOPES} value={list.params.scope} onChange={scope => list.update({ scope })} />
      <FilterBar fields={fields} values={list.params} onChange={list.update} onReset={list.reset} />
      <ErrorNote error={list.error} />
      <DataTable columns={columns} rows={list.data.items} loading={list.loading} onRowClick={open} empty="No bookings match these filters" />
      <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} limit={list.data.limit} onPage={page => list.update({ page })} onLimit={limit => list.update({ limit })} />
      <Modal open={Boolean(detail)} title={`Booking ${detail?.item?.bookingCode || ''}`} onClose={() => setDetail(null)} width={720}
        footer={detail && <>
          {detail.paymentOrder?.refundable > 0 && <button className="adm-btn" onClick={() => setRefund(detail)} data-testid="booking-refund"><Undo2 size={14} /> Refund…</button>}
          {['Pending', 'Confirmed', 'AwaitingPayment'].includes(detail.item.status) && <button className="adm-btn adm-btn-danger" onClick={() => cancel(detail.item)}><XCircle size={14} /> Cancel & refund</button>}
        </>}>
        {detail && (
          <div className="adm-detail">
            <div className="adm-kv-grid">
              {[['Status', <BookingStatus key="s" status={detail.item.status} />], ['Visit', `${fmtDate(detail.item.date)} ${fmtTime(detail.item.timeSlot)}`], ['Patient', `${detail.item.patientName} • ${detail.item.patientPhone}`], ['Doctor', detail.item.doctorName], ['Location', `${detail.item.locationName || '—'} (${LOCATION_KIND_LABEL[detail.item.locationKind] || '—'})`], ['Mode', detail.item.modeLabel], ['Paid online', inr(detail.item.amountPaidOnline)], ['Due at clinic', inr(detail.item.amountDueAtClinic)], ['Refund', detail.item.refundAmount ? `${inr(detail.item.refundAmount)} (${detail.item.refundStatus})` : detail.item.refundStatus], ['Source', detail.item.source || 'online'], ['Cancel reason', detail.item.cancelReason || '—']].map(([k, v]) => <div key={k} className="adm-kv"><span>{k}</span><strong>{v}</strong></div>)}
            </div>
            <h4>Ledger entries</h4>
            {detail.ledger.length === 0 ? <p className="adm-muted adm-small">No ledger entries (free / pay-at-clinic booking).</p> : (
              <div className="adm-table-wrap"><table className="adm-table"><thead><tr><th>Document</th><th>Number</th><th style={{ textAlign: 'right' }}>Taxable</th><th style={{ textAlign: 'right' }}>GST</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                <tbody>{detail.ledger.map(l => <tr key={l.id}><td data-label="Document">{l.documentType || 'invoice'}</td><td data-label="Number" className="adm-code">{l.invoiceNumber}</td><td data-label="Taxable" style={{ textAlign: 'right' }}>{inr(l.taxableValue)}</td><td data-label="GST" style={{ textAlign: 'right' }}>{inr((l.cgst || 0) + (l.sgst || 0) + (l.igst || 0))}</td><td data-label="Total" style={{ textAlign: 'right' }}>{inr(l.totalAmount)}</td></tr>)}</tbody></table></div>
            )}
            {detail.paymentOrder && <p className="adm-small adm-muted">Payment order {detail.paymentOrder.id} • {detail.paymentOrder.provider} • {detail.paymentOrder.status}{detail.paymentOrder.providerOrderId ? ` • ${detail.paymentOrder.providerOrderId}` : ''}{detail.paymentOrder.providerPaymentId ? ` • ${detail.paymentOrder.providerPaymentId}` : ''}{detail.paymentOrder.refundedAmount ? ` • refunded ${inr(detail.paymentOrder.refundedAmount)}` : ''}</p>}
          </div>
        )}
      </Modal>
      {refund && <RefundModal api={api} orderId={refund.paymentOrder.id} endpoint={`/bookings/${refund.item.id}/refund`} title={`Refund ${refund.item.bookingCode}`} onClose={() => setRefund(null)} onDone={async () => { setRefund(null); list.reload(); try { setDetail(await api.get(`/bookings/${refund.item.id}`)); } catch { setDetail(null); } }} />}
      {confirmEl}
    </>
  );
}
