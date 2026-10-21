import React, { useEffect, useState } from 'react';
import { Eye, CheckCircle2, XCircle, Ban, RotateCcw, Trash2, Undo2, Crown, ShieldCheck, FileText } from 'lucide-react';
import { DataTable, FilterBar, Pagination, StatusBadge, Modal, useConfirm, useToast, useAdminList, ErrorNote, PageHeader, Card } from '../ui';
import { fmtDate, fmtDateTime, inr } from '../api';

export const ENTITY_META = {
  doctors: { singular: 'doctor', title: 'Doctors', subtitle: 'All registered medical practitioners' },
  clinics: { singular: 'clinic', title: 'Clinics & Hospitals', subtitle: 'All registered healthcare facilities' },
  patients: { singular: 'patient', title: 'Patients', subtitle: 'Registered patient accounts' }
};

const STATUS_OPTIONS = [
  { value: 'all', label: 'All (excl. deleted)' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'deleted', label: 'Deleted' }
];
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'name', label: 'Name A–Z' }
];

/** Reusable account actions (approve/reject/suspend/unsuspend/delete/restore) with confirm dialogs. */
export function useAccountActions(api, entity, onDone) {
  const [confirm, confirmEl] = useConfirm();
  const toast = useToast();
  const run = async (fn, okMsg) => {
    try {
      const r = await fn();
      toast.success(r.message || okMsg);
      onDone?.(r.item);
    } catch (e) {
      toast.error(e.message);
      throw e;
    }
  };
  const label = ENTITY_META[entity].singular;
  const actions = {
    approve: row => confirm({
      title: `Approve ${label}?`, message: `${row.name} will become active${entity !== 'patients' ? ', publicly listed and able to take bookings' : ''}.`, confirmLabel: 'Approve',
      onConfirm: () => run(() => api.post(`/${entity}/${row.id}/approve`))
    }),
    reject: row => confirm({
      title: `Reject ${label}`, danger: true, confirmLabel: 'Reject',
      message: `${row.name} will be notified of the rejection when they sign in.`,
      input: { label: 'Rejection reason (shown to the user)', required: true, multiline: true, placeholder: 'e.g. Medical registration certificate could not be verified' },
      onConfirm: reason => run(() => api.post(`/${entity}/${row.id}/reject`, { reason }))
    }),
    suspend: row => confirm({
      title: `Suspend ${row.name}`, danger: true, confirmLabel: 'Suspend',
      message: 'The user will be blocked from signing in and using the app, and will see this message.',
      input: { label: 'Suspension reason (shown to the user)', required: true, minLength: 3, multiline: true, placeholder: 'e.g. Multiple patient complaints about unprofessional conduct — under review' },
      onConfirm: reason => run(() => api.post(`/${entity}/${row.id}/suspend`, { reason }))
    }),
    unsuspend: row => confirm({
      title: `Unsuspend ${row.name}?`, confirmLabel: 'Unsuspend', message: 'Access will be restored to the previous status.',
      onConfirm: () => run(() => api.post(`/${entity}/${row.id}/unsuspend`))
    }),
    remove: row => confirm({
      title: `Delete ${row.name}?`, danger: true, confirmLabel: 'Delete',
      message: 'This is a soft delete: the account is hidden everywhere and can no longer sign in, but bookings, invoices and ledger history are retained. You can restore it later from the "Deleted" filter.',
      input: { label: 'Internal note (optional)', placeholder: 'Reason for deletion' },
      onConfirm: reason => run(() => api.del(`/${entity}/${row.id}`, { reason }))
    }),
    restore: row => confirm({
      title: `Restore ${row.name}?`, confirmLabel: 'Restore',
      onConfirm: () => run(() => api.post(`/${entity}/${row.id}/restore`))
    })
  };
  return [actions, confirmEl];
}

export function ActionButtons({ row, actions, onView, compact }) {
  const s = row.status;
  const B = ({ onClick, icon: Icon, label, tone }) => (
    <button className={`adm-act adm-act-${tone || 'default'}`} onClick={e => { e.stopPropagation(); onClick(row); }} title={label}>
      <Icon size={14} />{!compact && <span>{label}</span>}
    </button>
  );
  return (
    <div className="adm-actions">
      {onView && <B onClick={onView} icon={Eye} label="View" />}
      {(s === 'pending' || s === 'rejected') && <B onClick={actions.approve} icon={CheckCircle2} label="Approve" tone="green" />}
      {s === 'pending' && <B onClick={actions.reject} icon={XCircle} label="Reject" tone="rose" />}
      {(s === 'active' || s === 'pending' || s === 'rejected') && <B onClick={actions.suspend} icon={Ban} label="Suspend" tone="amber" />}
      {s === 'suspended' && <B onClick={actions.unsuspend} icon={RotateCcw} label="Unsuspend" tone="blue" />}
      {s !== 'deleted' && <B onClick={actions.remove} icon={Trash2} label="Delete" tone="red" />}
      {s === 'deleted' && <B onClick={actions.restore} icon={Undo2} label="Restore" tone="blue" />}
    </div>
  );
}

function Field({ label, children }) {
  return <div className="adm-kv"><span>{label}</span><strong>{children || '—'}</strong></div>;
}

export function EntityDetailModal({ api, entity, id, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api.get(`/${entity}/${id}`).then(setData).catch(e => setErr(e.message));
  useEffect(() => { if (id) { setData(null); setErr(''); load(); } }, [id]); // eslint-disable-line
  const [actions, confirmEl] = useAccountActions(api, entity, () => { load(); onChanged?.(); });
  const it = data?.item;
  const rel = data?.related || {};
  return (
    <Modal open={Boolean(id)} title={it ? it.name : 'Loading…'} onClose={onClose} width={760}>
      <ErrorNote error={err} />
      {it && (
        <div className="adm-detail">
          <div className="adm-detail-top">
            {it.photo && <img src={it.photo} alt="" className="adm-avatar-lg" />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <StatusBadge status={it.status} />
                {it.isPremium && <span className="badge-premium"><Crown size={11} /> PRO</span>}
                {it.isVerified && <span className="badge-verified"><ShieldCheck size={11} /> Verified</span>}
                <code className="adm-code">{it.id}</code>
              </div>
              {it.statusReason && <div className={`adm-alert ${it.status === 'suspended' || it.status === 'rejected' ? 'adm-alert-error' : 'adm-alert-info'}`} style={{ marginTop: 8 }}><strong>{it.status === 'suspended' ? 'Suspension' : 'Reason'}:</strong>&nbsp;{it.statusReason}</div>}
            </div>
          </div>
          <ActionButtons row={it} actions={actions} />
          <div className="adm-kv-grid">
            <Field label="Phone">{it.phone}</Field>
            <Field label="Email">{it.email}</Field>
            <Field label="Registered">{fmtDateTime(it.createdAt)}</Field>
            <Field label="Status updated">{fmtDateTime(it.statusUpdatedAt)}</Field>
            {entity === 'doctors' && <>
              <Field label="Qualifications">{it.qualifications}</Field>
              <Field label="Title">{it.title}</Field>
              <Field label="Experience">{it.experienceYears} yrs</Field>
              <Field label="Sector">{it.sector}</Field>
              <Field label="Specialities">{it.specialities?.join(', ')}</Field>
              <Field label="Clinics">{it.clinics?.map(c => c.clinicName).join(', ')}</Field>
              <Field label="Consultation fee">{inr(it.consultationFee)}</Field>
              <Field label="Rating">{it.rating} ★ ({it.reviewCount} reviews)</Field>
              <Field label="Registration">{it.registrationNumber ? `${it.councilName || '—'} • ${it.registrationNumber}` : 'Not provided'}{' '}
                {it.registrationVerified ? <span className="badge-verified"><ShieldCheck size={11} /> Verified</span> : null}
                {it.registrationNumber && <button className="adm-act" style={{ marginLeft: 6 }} data-testid="reg-verify-toggle" onClick={() => api.post(`/doctors/${it.id}/registration`, { verified: !it.registrationVerified }).then(() => { load(); onChanged?.(); }).catch(e => setErr(e.message))}>{it.registrationVerified ? 'Remove badge' : 'Mark verified'}</button>}
              </Field>
              <Field label="Bookings">{rel.bookingCount}</Field>
            </>}
            {entity === 'clinics' && <>
              <Field label="Type">{it.type}</Field>
              <Field label="Sector">{it.sector}</Field>
              <Field label="Address">{it.address}</Field>
              <Field label="City">{it.city}</Field>
              <Field label="Facilities">{it.facilities?.join(', ')}</Field>
              <Field label="Doctors">{rel.doctors?.length}</Field>
            </>}
            {entity === 'patients' && <>
              <Field label="Role">{it.role}</Field>
              <Field label="Bookings">{rel.bookingCount}</Field>
            </>}
            {entity !== 'patients' && <>
              <Field label="GSTIN">{it.gstin}</Field>
              <Field label="State">{it.state}{it.stateCode ? ` (${it.stateCode})` : ''}</Field>
              <Field label="Available balance">{inr(it.claimPendingFee)}</Field>
              <Field label="Payout in process">{inr(it.payoutPendingFee)}</Field>
              <Field label="Paid out">{inr(it.claimedFee)}</Field>
            </>}
          </div>
          {entity === 'doctors' && it.bio && <p className="adm-muted" style={{ marginTop: 10 }}>{it.bio}</p>}

          {entity === 'doctors' && <DocumentsCard api={api} doctorId={it.id} documents={it.documents || []} onChanged={load} />}
          {entity !== 'patients' && rel.plan && <PlanCard api={api} entity={entity} id={it.id} plan={rel.plan} onChanged={() => { load(); onChanged?.(); }} />}

          {rel.transactions?.length > 0 && <Card title="Recent transactions">
            <DataTable rows={rel.transactions} columns={[
              { key: 'invoiceNumber', label: 'Invoice' },
              { key: 'txnDate', label: 'Date', render: r => fmtDate(r.txnDate) },
              { key: 'category', label: 'Type', render: r => r.category.replace(/_/g, ' ') },
              { key: 'totalAmount', label: 'Amount', align: 'right', render: r => inr(r.totalAmount) }
            ]} />
          </Card>}
          {rel.payouts?.length > 0 && <Card title="Payout requests">
            <DataTable rows={rel.payouts} columns={[
              { key: 'referenceCode', label: 'Ref' },
              { key: 'createdAt', label: 'Requested', render: r => fmtDate(r.createdAt) },
              { key: 'status', label: 'Status', render: r => <StatusBadge status={r.status} /> },
              { key: 'amount', label: 'Amount', align: 'right', render: r => inr(r.amount) }
            ]} />
          </Card>}
          {rel.bookings?.length > 0 && <Card title="Recent bookings">
            <DataTable rows={rel.bookings} columns={[
              { key: 'bookingCode', label: 'Code' },
              { key: entity === 'patients' ? 'doctorName' : 'patientName', label: entity === 'patients' ? 'Doctor' : 'Patient' },
              { key: 'date', label: 'Date' },
              { key: 'totalAmount', label: 'Paid', align: 'right', render: r => inr(r.totalAmount) }
            ]} />
          </Card>}
          {rel.reviews?.length > 0 && <Card title="Recent reviews">
            {rel.reviews.map(r => <div key={r.id} className="adm-review-mini"><StatusBadge status={r.moderationStatus} /> <strong>{r.rating}★</strong> {r.comment}</div>)}
          </Card>}
          {rel.doctors?.length > 0 && <Card title="Affiliated doctors">
            {rel.doctors.map(d => <div key={d.id} className="adm-review-mini"><StatusBadge status={d.status} /> {d.name} <span className="adm-muted">{d.specialities?.join(', ')}</span></div>)}
          </Card>}
        </div>
      )}
      {confirmEl}
    </Modal>
  );
}

export default function EntityList({ api, entity, initialStatus = 'all' }) {
  const meta = ENTITY_META[entity];
  const list = useAdminList(api, `/${entity}`, { status: initialStatus, sort: 'newest' });
  const [viewId, setViewId] = useState(null);
  const [actions, confirmEl] = useAccountActions(api, entity, () => list.reload());
  const { data, params } = list;

  const columns = [
    { key: 'name', label: 'Name', render: r => (
      <div className="adm-name-cell">
        {r.photo ? <img src={r.photo} alt="" /> : <span className="adm-initial">{(r.name || '?')[0]}</span>}
        <div><strong>{r.name}</strong>{r.isPremium && <span className="adm-pro">PRO</span>}<small>{entity === 'doctors' ? r.qualifications : entity === 'clinics' ? `${r.type || ''}${r.city ? ' • ' + r.city : ''}` : r.id}</small></div>
      </div>
    ) },
    { key: 'contact', label: 'Contact', render: r => <div className="adm-stack"><span>{r.phone}</span><small>{r.email || '—'}</small></div> },
    ...(entity === 'doctors' ? [{ key: 'spec', label: 'Speciality', render: r => r.specialities?.slice(0, 2).join(', ') }] : []),
    { key: 'status', label: 'Status', render: r => <div className="adm-stack"><StatusBadge status={r.status} />{r.statusReason && <small className="adm-reason" title={r.statusReason}>{r.statusReason}</small>}</div> },
    { key: 'createdAt', label: 'Registered', render: r => fmtDate(r.createdAt) },
    { key: 'actions', label: 'Actions', render: r => <ActionButtons row={r} actions={actions} onView={() => setViewId(r.id)} compact /> }
  ];

  return (
    <div>
      <PageHeader title={meta.title} subtitle={`${meta.subtitle} • ${data.total} matching`} />
      <Card>
        <FilterBar
          values={params}
          onChange={list.update}
          onReset={list.reset}
          fields={[
            { key: 'search', type: 'search', label: 'Search name, email, phone…' },
            { key: 'status', type: 'select', label: 'Status', options: STATUS_OPTIONS },
            { key: 'from', type: 'date', label: 'From' },
            { key: 'to', type: 'date', label: 'To' },
            { key: 'sort', type: 'select', label: 'Sort', options: SORT_OPTIONS }
          ]}
        />
        <ErrorNote error={list.error} />
        <DataTable columns={columns} rows={data.items} loading={list.loading} onRowClick={r => setViewId(r.id)} />
        <Pagination {...data} onPage={p => list.update({ page: p })} onLimit={l => list.update({ limit: l })} />
      </Card>
      <EntityDetailModal api={api} entity={entity} id={viewId} onClose={() => setViewId(null)} onChanged={list.reload} />
      {confirmEl}
    </div>
  );
}

function DocumentsCard({ api, doctorId, documents, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState('');
  const act = async (d, action) => {
    setBusy(d.id + action);
    try { const r = await api.post(`/doctors/${doctorId}/documents/${d.id}/${action}`, {}); toast.success(r.message); onChanged(); } catch (e) { toast.error(e.message); }
    setBusy('');
  };
  return (
    <Card title={`Verification documents (${documents.length})`}>
      {documents.length === 0 ? <p className="adm-muted adm-small" style={{ margin: 0 }}>No documents uploaded. Verify registration number with the medical council manually.</p> : (
        <div className="adm-doc-list">
          {documents.map(d => (
            <div key={d.id} className="adm-doc-row" data-testid="admin-document">
              <FileText size={18} />
              <div className="adm-stack" style={{ flex: 1, minWidth: 0 }}><strong>{d.label || d.docType}</strong><small>{d.originalName} • {Math.round((d.size || 0) / 1024)} KB • {fmtDateTime(d.uploadedAt)}</small></div>
              <StatusBadge status={d.status || 'pending'} />
              <div className="adm-actions">
                <button className="adm-act adm-act-blue" onClick={() => api.openFile(`/doctors/${doctorId}/documents/${d.id}/file`).catch(e => toast.error(e.message))}><Eye size={13} /> View</button>
                {d.status !== 'verified' && <button className="adm-act adm-act-green" disabled={Boolean(busy)} onClick={() => act(d, 'verify')}><CheckCircle2 size={13} /> Verify</button>}
                {d.status !== 'rejected' && <button className="adm-act adm-act-rose" disabled={Boolean(busy)} onClick={() => act(d, 'reject')}><XCircle size={13} /> Reject</button>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function PlanCard({ api, entity, id, plan, onChanged }) {
  const toast = useToast();
  const [code, setCode] = useState(plan.code);
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const grant = async () => {
    setBusy(true);
    try { const r = await api.post(`/${entity}/${id}/plan`, { planCode: code, days }); toast.success(r.message); onChanged(); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <Card title="Subscription">
      <p className="adm-small" style={{ marginTop: 0 }}><Crown size={13} /> <strong>{plan.name}</strong>{plan.expiresAt ? ` • ${plan.expired ? 'expired' : 'renews/expires'} ${fmtDate(plan.expiresAt)}` : ''}</p>
      <div className="adm-form-row" style={{ alignItems: 'flex-end' }}>
        <label className="adm-field"><span>Change plan</span><select value={code} onChange={e => setCode(e.target.value)}><option value="basic">Basic</option><option value="pro">Pro</option><option value="premium">Premium</option></select></label>
        {code !== 'basic' && <label className="adm-field"><span>Days</span><input type="number" min="1" max="3650" value={days} onChange={e => setDays(e.target.value)} /></label>}
        <button className="adm-btn btn-primary" disabled={busy} onClick={grant}>Apply (complimentary)</button>
      </div>
    </Card>
  );
}
