import React, { useState } from 'react';
import { CreditCard, Users, Wallet, CheckCircle2, BadgeCheck, XCircle, Undo2 } from 'lucide-react';
import { DataTable, FilterBar, Pagination, StatusBadge, useAdminList, ErrorNote, PageHeader, Card, Tabs, useConfirm, useToast } from '../ui';
import { fmtDate, fmtDateTime, inr, inr2 } from '../api';
import RefundModal from '../RefundModal';

function TransactionsTable({ api, type }) {
  const list = useAdminList(api, '/ledger/transactions', { type, sort: 'newest' });
  const [refund, setRefund] = useState(null);
  const { data, params } = list;
  const t = data.totals || {};
  return (
    <Card>
      <FilterBar values={params} onChange={list.update} onReset={list.reset} fields={[
        { key: 'search', type: 'search', label: 'Search invoice, party, phone, GSTIN…' },
        ...(type === 'subscription' ? [{ key: 'partyType', type: 'select', label: 'Party', options: [{ value: '', label: 'Doctors & clinics' }, { value: 'doctor', label: 'Doctors' }, { value: 'clinic', label: 'Clinics' }] }] : []),
        ...(type === 'refund' ? [{ key: 'documentType', type: 'select', label: 'Document', options: [{ value: '', label: 'Credit notes & refund vouchers' }, { value: 'credit_note', label: 'GST credit notes' }, { value: 'refund_voucher', label: 'Refund vouchers (consultation)' }] }] : []),
        ...(type === 'patient_fee' ? [{ key: 'refundStatus', type: 'select', label: 'Refund', options: [{ value: '', label: 'Any' }, { value: 'partial', label: 'Partially refunded' }, { value: 'full', label: 'Fully refunded' }] }] : []),
        { key: 'status', type: 'select', label: 'Status', options: [{ value: '', label: 'All' }, { value: 'paid', label: 'Paid' }, { value: 'pending', label: 'Pending' }, { value: 'failed', label: 'Failed' }, { value: 'refunded', label: 'Refunded' }] },
        { key: 'from', type: 'date', label: 'From' },
        { key: 'to', type: 'date', label: 'To' },
        { key: 'sort', type: 'select', label: 'Sort', options: [{ value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' }, { value: 'amount_desc', label: 'Amount ↓' }, { value: 'amount_asc', label: 'Amount ↑' }] }
      ]} />
      <div className="adm-summary-strip">
        <span>Transactions: <strong>{t.count || 0}</strong></span>
        <span>Taxable value: <strong>{inr2(t.taxableValue)}</strong></span>
        <span>GST: <strong>{inr2(t.totalTax)}</strong></span>
        {type !== 'subscription' && <span>Consultation (pass-through): <strong>{inr2(t.passThrough)}</strong></span>}
        <span>Total collected: <strong>{inr2(t.totalAmount)}</strong></span>
      </div>
      <ErrorNote error={list.error} />
      <DataTable loading={list.loading} rows={data.items} empty="No transactions for these filters" columns={[
        { key: 'invoiceNumber', label: 'Invoice', render: r => <div className="adm-stack"><code className="adm-code">{r.invoiceNumber}</code><small>{fmtDateTime(r.txnDate)}{r.documentType && r.documentType !== 'invoice' ? ` • ${r.documentType === 'credit_note' ? 'Credit note' : 'Refund voucher'} vs ${r.originalInvoiceNumber}` : ''}{r.refundStatus && r.refundStatus !== 'none' ? ` • ${r.refundStatus} refund` : ''}</small></div> },
        { key: 'party', label: type === 'subscription' ? 'Doctor / Clinic' : 'Patient', render: r => <div className="adm-stack"><strong>{r.partyName}</strong><small>{r.partyType} • {r.partyPhone}{r.partyGstin ? ` • ${r.partyGstin}` : ''}</small></div> },
        { key: 'desc', label: 'Details', render: r => <div className="adm-stack"><span>{r.description}</span><small>SAC {r.sacCode} • {r.placeOfSupply || '—'} <StatusBadge status={r.supplyType} /></small></div> },
        { key: 'taxableValue', label: 'Taxable', align: 'right', render: r => inr2(r.taxableValue) },
        { key: 'gst', label: 'GST', align: 'right', render: r => <div className="adm-stack" style={{ alignItems: 'flex-end' }}><span>{inr2(r.totalTax)} <small>@{r.gstRate}%</small></span><small>{r.supplyType === 'intra' ? `C ${inr2(r.cgst)} + S ${inr2(r.sgst)}` : `IGST ${inr2(r.igst)}`}</small></div> },
        ...(type !== 'subscription' ? [{ key: 'pass', label: 'Consult. fee', align: 'right', render: r => inr2(r.passThroughAmount) }] : []),
        { key: 'totalAmount', label: 'Total', align: 'right', render: r => <strong>{inr2(r.totalAmount)}</strong> },
        { key: 'status', label: 'Status', render: r => <StatusBadge status={r.status} /> },
        ...(type !== 'refund' ? [{ key: 'act', label: '', render: r => (r.documentType || 'invoice') === 'invoice' && r.paymentOrderId && r.refundStatus !== 'full' && r.status === 'paid' ? <button className="adm-act adm-act-rose" onClick={() => setRefund(r)} data-testid="ledger-refund"><Undo2 size={13} /> Refund</button> : null }] : [])
      ]} />
      <Pagination {...data} onPage={p => list.update({ page: p })} onLimit={l => list.update({ limit: l })} />
      {refund && <RefundModal api={api} orderId={refund.paymentOrderId} endpoint={`/ledger/transactions/${refund.id}/refund`} title={`Refund ${refund.invoiceNumber}`} onClose={() => setRefund(null)} onDone={() => { setRefund(null); list.reload(); }} />}
    </Card>
  );
}

function PayoutsTable({ api, onCountsChange }) {
  const list = useAdminList(api, '/payouts', { status: 'Pending', sort: 'oldest' });
  const [confirm, confirmEl] = useConfirm();
  const toast = useToast();
  const { data, params } = list;
  const run = fn => fn().then(r => { toast.success(r.message); list.reload(); onCountsChange?.(); }).catch(e => { toast.error(e.message); throw e; });
  const s = data.summary || {};
  const approve = r => confirm({ title: `Approve payout of ${inr(r.amount)}?`, message: `${r.entityName} • ${r.bankDetails || 'bank details on file'}`, confirmLabel: 'Approve', input: { label: 'Admin note (optional)' }, onConfirm: note => run(() => api.post(`/payouts/${r.id}/approve`, { note })) });
  const paid = r => confirm({ title: `Mark ${inr(r.amount)} as paid`, message: `Confirm the transfer to ${r.entityName} has been completed.`, confirmLabel: 'Mark paid', input: { label: 'Payment reference / UTR no.', required: true, placeholder: 'e.g. UTR HDFCN52026102012345' }, onConfirm: reference => run(() => api.post(`/payouts/${r.id}/mark-paid`, { reference })) });
  const reject = r => confirm({ title: 'Reject payout request', danger: true, confirmLabel: 'Reject', message: 'The amount is returned to their available balance.', input: { label: 'Reason (shown to requester)', required: true, multiline: true }, onConfirm: reason => run(() => api.post(`/payouts/${r.id}/reject`, { reason })) });

  return (
    <Card>
      <div className="adm-summary-strip">
        {['Pending', 'Approved', 'Paid', 'Rejected'].map(k => <span key={k}><StatusBadge status={k} /> <strong>{s[k]?.count || 0}</strong> • {inr(s[k]?.amount || 0)}</span>)}
      </div>
      <FilterBar values={params} onChange={list.update} onReset={list.reset} fields={[
        { key: 'search', type: 'search', label: 'Search name, ref, UTR…' },
        { key: 'status', type: 'select', label: 'Status', options: [{ value: 'all', label: 'All' }, { value: 'Pending', label: 'Pending' }, { value: 'Approved', label: 'Approved' }, { value: 'Paid', label: 'Paid' }, { value: 'Rejected', label: 'Rejected' }] },
        { key: 'entityType', type: 'select', label: 'Requester', options: [{ value: '', label: 'Doctors & clinics' }, { value: 'doctor', label: 'Doctors' }, { value: 'clinic', label: 'Clinics' }] },
        { key: 'from', type: 'date', label: 'From' },
        { key: 'to', type: 'date', label: 'To' },
        { key: 'sort', type: 'select', label: 'Sort', options: [{ value: 'oldest', label: 'Oldest first' }, { value: 'newest', label: 'Newest first' }, { value: 'amount_desc', label: 'Amount ↓' }] }
      ]} />
      <ErrorNote error={list.error} />
      <DataTable loading={list.loading} rows={data.items} empty="No payout requests" columns={[
        { key: 'ref', label: 'Request', render: r => <div className="adm-stack"><code className="adm-code">{r.referenceCode}</code><small>{fmtDateTime(r.requestedAt || r.createdAt)}</small></div> },
        { key: 'entity', label: 'Requester', render: r => <div className="adm-stack"><strong>{r.entityName}</strong><small>{r.entityType} • {r.entityId}</small></div> },
        { key: 'bank', label: 'Bank / note', render: r => <div className="adm-stack"><span>{r.bankDetails || '—'}</span>{r.note && <small>{r.note}</small>}</div> },
        { key: 'amount', label: 'Amount', align: 'right', render: r => <strong>{inr2(r.amount)}</strong> },
        { key: 'status', label: 'Status', render: r => <div className="adm-stack"><StatusBadge status={r.status} />{r.paymentReference && <small>Ref: {r.paymentReference}</small>}{r.rejectionReason && <small className="adm-reason">{r.rejectionReason}</small>}{r.paidAt && <small>Paid {fmtDate(r.paidAt)}</small>}</div> },
        { key: 'a', label: 'Actions', render: r => <div className="adm-actions">
          {r.status === 'Pending' && <button className="adm-act adm-act-blue" onClick={() => approve(r)}><CheckCircle2 size={14} /><span>Approve</span></button>}
          {['Pending', 'Approved'].includes(r.status) && <button className="adm-act adm-act-green" onClick={() => paid(r)}><BadgeCheck size={14} /><span>Mark paid</span></button>}
          {['Pending', 'Approved'].includes(r.status) && <button className="adm-act adm-act-rose" onClick={() => reject(r)}><XCircle size={14} /><span>Reject</span></button>}
        </div> }
      ]} />
      <Pagination {...data} onPage={p => list.update({ page: p })} onLimit={l => list.update({ limit: l })} />
      {confirmEl}
    </Card>
  );
}

export default function Ledger({ api, section = 'subscriptions', go, onCountsChange }) {
  return (
    <div>
      <PageHeader title="Ledger" subtitle="All money movement: subscription invoices, patient booking fees and payout requests." />
      <Tabs value={section} onChange={v => go(`ledger/${v}`)} tabs={[
        { value: 'subscriptions', label: 'Subscriptions', icon: CreditCard },
        { value: 'fees', label: 'Patient fees', icon: Users },
        { value: 'refunds', label: 'Refunds & credit notes', icon: Undo2 },
        { value: 'payouts', label: 'Payout requests', icon: Wallet }
      ]} />
      {section === 'subscriptions' && <TransactionsTable key="s" api={api} type="subscription" />}
      {section === 'fees' && <TransactionsTable key="f" api={api} type="patient_fee" />}
      {section === 'refunds' && <TransactionsTable key="r" api={api} type="refund" />}
      {section === 'payouts' && <PayoutsTable api={api} onCountsChange={onCountsChange} />}
    </div>
  );
}
