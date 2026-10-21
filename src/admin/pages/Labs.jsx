import React, { useEffect, useState } from 'react';
import { FlaskConical, Plus, Pencil, KeyRound, Trash2, Loader2, Upload, Eye, Truck } from 'lucide-react';
import { Card, DataTable, Modal, PageHeader, Tabs, ErrorNote, Pagination, FilterBar, useAdminList, useToast, useConfirm, StatusBadge } from '../ui';
import { inr, fmtDateTime } from '../api';

const EMPTY_LAB = { name: '', type: 'lab', address: '', city: '', pincodes: '', phone: '', email: '', gstin: '', accreditation: '', homeCollection: true, collectionWindows: '07:00-09:00, 09:00-11:00, 11:00-13:00, 16:00-18:00', commissionPercent: '', isActive: true };
const EMPTY_TEST = { code: '', name: '', category: 'General', description: '', price: '', mrp: '', preparation: '', sampleType: 'Blood', tatHours: 24, homeCollection: true, isActive: true };
const NEXT = { Confirmed: 'SampleCollected', SampleCollected: 'Processing', Processing: 'ReportReady' };

function LabModal({ api, lab, onClose, onSaved }) {
  const [v, setV] = useState(() => (lab ? { ...EMPTY_LAB, ...lab, pincodes: (lab.pincodes || []).join(', '), collectionWindows: (lab.collectionWindows || []).join(', '), commissionPercent: lab.commissionPercent ?? '' } : { ...EMPTY_LAB }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  const save = async () => {
    setBusy(true); setErr('');
    const body = { name: v.name, type: v.type, address: v.address, city: v.city, pincodes: list(v.pincodes), phone: v.phone, email: v.email, gstin: v.gstin, accreditation: v.accreditation, homeCollection: v.homeCollection, collectionWindows: list(v.collectionWindows), commissionPercent: v.commissionPercent === '' ? null : Number(v.commissionPercent), isActive: v.isActive };
    try { lab ? await api.put(`/labs/${lab.id}`, body) : await api.post('/labs', body); onSaved(); } catch (e) { setErr(e.message); setBusy(false); }
  };
  const f = (k, label, props = {}) => <label className="adm-field"><span>{label}</span><input value={v[k]} onChange={e => setV({ ...v, [k]: e.target.value })} {...props} /></label>;
  return (
    <Modal open title={lab ? `Edit ${lab.name}` : 'Add lab'} onClose={onClose} width={640}
      footer={<><button className="btn-secondary adm-btn" onClick={onClose}>Cancel</button><button className="btn-primary adm-btn" onClick={save} disabled={busy || v.name.trim().length < 2} data-testid="lab-save">{busy && <Loader2 size={14} className="adm-spin" />} Save</button></>}>
      <ErrorNote error={err} />
      <div className="adm-form-grid">
        {f('name', 'Name *')}
        <label className="adm-field"><span>Type</span><select value={v.type} onChange={e => setV({ ...v, type: e.target.value })}><option value="lab">Own / listed lab</option><option value="partner">Partner (API)</option></select></label>
        {f('address', 'Address')}{f('city', 'City')}{f('phone', 'Phone')}{f('email', 'Email')}{f('gstin', 'GSTIN')}{f('accreditation', 'Accreditation (e.g. NABL)')}
        {f('pincodes', 'Home-collection PIN codes (comma separated, empty = anywhere)')}
        {f('collectionWindows', 'Collection windows (HH:MM-HH:MM, comma separated)')}
        {f('commissionPercent', 'Commission % (empty = platform default)', { type: 'number', min: 0, max: 50 })}
        <label className="adm-check"><input type="checkbox" checked={v.homeCollection} onChange={e => setV({ ...v, homeCollection: e.target.checked })} /> Home collection</label>
        <label className="adm-check"><input type="checkbox" checked={v.isActive} onChange={e => setV({ ...v, isActive: e.target.checked })} /> Active</label>
      </div>
    </Modal>
  );
}

function TestsModal({ api, lab, onClose }) {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState('');
  const load = () => api.get(`/labs/${lab.id}/tests`).then(r => setItems(r.items)).catch(e => setErr(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async () => {
    const body = { ...edit, price: Number(edit.price), mrp: Number(edit.mrp) || 0, tatHours: Number(edit.tatHours) || 24 };
    const id = body.id; delete body.id; delete body.labId; delete body.createdAt; delete body.updatedAt;
    try { id ? await api.put(`/lab-tests/${id}`, body) : await api.post(`/labs/${lab.id}/tests`, body); setEdit(null); load(); toast.success('Test saved'); } catch (e) { setErr(e.message); }
  };
  const f = (k, label, props = {}) => <label className="adm-field"><span>{label}</span><input value={edit[k]} onChange={e => setEdit({ ...edit, [k]: e.target.value })} {...props} /></label>;
  return (
    <Modal open title={`Test catalogue — ${lab.name}`} onClose={onClose} width={860}>
      <ErrorNote error={err} />
      {edit ? (
        <Card title={edit.id ? 'Edit test' : 'New test'}>
          <div className="adm-form-grid">
            {f('name', 'Name *')}{f('code', 'Code')}{f('category', 'Category')}{f('price', 'Price (₹) *', { type: 'number', min: 1 })}{f('mrp', 'MRP (₹)', { type: 'number', min: 0 })}
            {f('preparation', 'Preparation (e.g. 10-12 h fasting)')}{f('sampleType', 'Sample')}{f('tatHours', 'Report TAT (hours)', { type: 'number', min: 1 })}{f('description', 'Description')}
            <label className="adm-check"><input type="checkbox" checked={edit.homeCollection} onChange={e => setEdit({ ...edit, homeCollection: e.target.checked })} /> Home collection</label>
            <label className="adm-check"><input type="checkbox" checked={edit.isActive} onChange={e => setEdit({ ...edit, isActive: e.target.checked })} /> Active</label>
          </div>
          <div className="fx-row fx-mt"><button className="btn-secondary adm-btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn-primary adm-btn" onClick={save} disabled={!edit.name || !(Number(edit.price) > 0)}>Save test</button></div>
        </Card>
      ) : <button className="btn-primary adm-btn" onClick={() => setEdit({ ...EMPTY_TEST })}><Plus size={14} /> Add test</button>}
      <DataTable loading={items === null} rows={items || []} empty="No tests yet" columns={[
        { key: 'n', label: 'Test', render: r => <div className="adm-stack"><strong>{r.name}</strong><small>{r.code} • {r.category} • {r.sampleType}</small></div> },
        { key: 'p', label: 'Price', render: r => <div className="adm-stack"><b>{inr(r.price)}</b>{r.mrp ? <small>MRP {inr(r.mrp)}</small> : null}</div> },
        { key: 'prep', label: 'Prep / TAT', render: r => <div className="adm-stack"><small>{r.preparation || '—'}</small><small>{r.tatHours} h</small></div> },
        { key: 's', label: 'Status', render: r => <StatusBadge status={r.isActive ? 'active' : 'inactive'} /> },
        { key: 'a', label: '', render: r => <div className="adm-actions"><button className="adm-act" onClick={() => setEdit({ ...EMPTY_TEST, ...r })}><Pencil size={12} /> Edit</button>{r.isActive && <button className="adm-act adm-act-rose" onClick={() => api.del(`/lab-tests/${r.id}`).then(load)}><Trash2 size={12} /> Disable</button>}</div> }
      ]} />
    </Modal>
  );
}

function LabsTab({ api }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [items, setItems] = useState(null);
  const [edit, setEdit] = useState(undefined);
  const [tests, setTests] = useState(null);
  const [key, setKey] = useState(null);
  const load = () => api.get('/labs').then(r => setItems(r.items)).catch(e => toast.error(e.message));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const newKey = l => confirm({ title: `New partner API key for ${l.name}?`, message: 'Any existing key stops working immediately.', confirmLabel: 'Generate key', onConfirm: async () => { const r = await api.post(`/labs/${l.id}/partner-key`); setKey({ lab: l.name, key: r.apiKey }); load(); } });
  return (
    <>
      <div className="fx-row fx-between"><p className="adm-muted adm-small">Labs and diagnostic partners. Test prices are collected for the lab; FindADoc invoices its commission to the lab (GST extra).</p><button className="btn-primary adm-btn" onClick={() => setEdit(null)} data-testid="lab-add"><Plus size={14} /> Add lab</button></div>
      <DataTable loading={items === null} rows={items || []} empty="No labs yet — add your first lab." columns={[
        { key: 'n', label: 'Lab', render: r => <div className="adm-stack"><strong>{r.name}</strong><small>{r.city}{r.accreditation ? ` • ${r.accreditation}` : ''}{r.type === 'partner' ? ' • partner' : ''}</small></div> },
        { key: 't', label: 'Tests', render: r => r.testCount },
        { key: 'h', label: 'Home collection', render: r => (r.homeCollection ? `Yes${r.pincodes?.length ? ` (${r.pincodes.length} PINs)` : ''}` : 'No') },
        { key: 'c', label: 'Commission', render: r => (r.commissionPercent ?? 'default') + (r.commissionPercent != null ? '%' : '') },
        { key: 'k', label: 'API key', render: r => (r.hasPartnerKey ? <code className="adm-code">…{r.partnerKeyHint}</code> : '—') },
        { key: 's', label: 'Status', render: r => <StatusBadge status={r.isActive ? 'active' : 'inactive'} /> },
        { key: 'a', label: '', render: r => (
          <div className="adm-actions">
            <button className="adm-act" onClick={() => setEdit(r)}><Pencil size={12} /> Edit</button>
            <button className="adm-act adm-act-blue" onClick={() => setTests(r)}><FlaskConical size={12} /> Tests</button>
            <button className="adm-act" onClick={() => newKey(r)}><KeyRound size={12} /> Key</button>
            {r.hasPartnerKey && <button className="adm-act adm-act-rose" onClick={() => api.del(`/labs/${r.id}/partner-key`).then(load)}>Revoke</button>}
          </div>
        ) }
      ]} />
      {edit !== undefined && <LabModal api={api} lab={edit} onClose={() => setEdit(undefined)} onSaved={() => { setEdit(undefined); load(); }} />}
      {tests && <TestsModal api={api} lab={tests} onClose={() => { setTests(null); load(); }} />}
      {key && <Modal open title="Partner API key" onClose={() => setKey(null)}><p>Key for <b>{key.lab}</b> — copy it now, it will not be shown again. Send it as the <code>X-Lab-Key</code> header to <code>/api/lab-partner</code>.</p><pre className="adm-code fx-key">{key.key}</pre></Modal>}
      {confirmEl}
    </>
  );
}

function OrdersTab({ api }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const list = useAdminList(api, '/lab-orders', { status: '', search: '', limit: 20 });
  const [busy, setBusy] = useState('');
  const advance = async (o, status, note) => { setBusy(o.id); try { await api.post(`/lab-orders/${o.id}/status`, { status, note }); list.reload(); } catch (e) { toast.error(e.message); throw e; } finally { setBusy(''); } };
  const upload = (o, file) => { if (!file) return; setBusy(o.id); api.upload(`/lab-orders/${o.id}/report`, file, { title: `${o.tests.map(x => x.name).join(', ').slice(0, 150)}` }).then(() => { toast.success('Report attached to the patient’s health record'); list.reload(); }).catch(e => toast.error(e.message)).finally(() => setBusy('')); };
  return (
    <>
      <FilterBar fields={[{ key: 'search', type: 'search', label: 'Order, patient or lab' }, { key: 'status', type: 'select', label: 'Status', options: [{ value: '', label: 'All' }, ...['AwaitingPayment', 'Confirmed', 'SampleCollected', 'Processing', 'ReportReady', 'Cancelled'].map(s => ({ value: s, label: s }))] }, { key: 'date', type: 'date', label: 'Slot date' }]}
        values={list.params} onChange={list.update} onReset={() => list.update({ status: '', search: '', date: '' })} />
      <ErrorNote error={list.error} />
      <DataTable loading={list.loading} rows={list.data.items || []} empty="No lab orders" columns={[
        { key: 'o', label: 'Order', render: r => <div className="adm-stack"><code className="adm-code">{r.orderCode}</code><small>{fmtDateTime(r.createdAt)}</small></div> },
        { key: 'p', label: 'Patient / lab', render: r => <div className="adm-stack"><strong>{r.patientName}</strong><small>{r.labName}</small></div> },
        { key: 't', label: 'Tests', render: r => <small>{r.tests.map(x => x.name).join(', ')}</small> },
        { key: 'w', label: 'Slot', render: r => <div className="adm-stack"><span>{r.slotDate} {r.slotWindow}</span><small>{r.mode === 'home_collection' ? <><Truck size={11} /> Home{r.address?.pincode ? ` • ${r.address.pincode}` : ''}</> : 'Lab visit'}</small></div> },
        { key: 'm', label: 'Amount', render: r => <div className="adm-stack"><b>{inr(r.total)}</b><small>Commission {inr(r.commission)} + GST {inr(r.commissionGst)}</small></div> },
        { key: 's', label: 'Status', render: r => <StatusBadge status={r.status} label={r.status} /> },
        { key: 'a', label: '', render: r => (
          <div className="adm-actions">
            {NEXT[r.status] && <button className="adm-act adm-act-blue" disabled={busy === r.id} onClick={() => advance(r, NEXT[r.status]).catch(() => {})}>→ {NEXT[r.status]}</button>}
            {['Processing', 'ReportReady', 'SampleCollected'].includes(r.status) && <label className="adm-act"><Upload size={12} /> Report<input type="file" hidden accept="application/pdf,image/jpeg,image/png" onChange={e => upload(r, e.target.files?.[0])} /></label>}
            {(r.reportRecordIds || []).map((id, i) => <button key={id} className="adm-act" onClick={() => api.openFile(`/lab-orders/${r.id}/reports/${id}/file`).catch(e => toast.error(e.message))}><Eye size={12} /> {i + 1}</button>)}
            {['Confirmed', 'SampleCollected'].includes(r.status) && <button className="adm-act adm-act-rose" onClick={() => confirm({ title: `Cancel ${r.orderCode}?`, danger: true, message: 'The patient is refunded in full and the commission is reversed with a credit note.', input: { label: 'Reason', required: true }, onConfirm: note => advance(r, 'Cancelled', note) })}>Cancel</button>}
          </div>
        ) }
      ]} />
      <Pagination page={list.data.page} pages={list.data.pages} total={list.data.total} limit={list.data.limit} onPage={page => list.update({ page })} />
      {confirmEl}
    </>
  );
}

function DeletionsTab({ api }) {
  const [items, setItems] = useState(null);
  useEffect(() => { api.get('/privacy/deletions').then(r => setItems(r.items)).catch(() => setItems([])); }, [api]);
  return (
    <>
      <p className="adm-muted adm-small">Account deletion requests (DPDP Act). Accounts are anonymised automatically after the grace period; invoices, ledger and consent records are retained for statutory periods.</p>
      <DataTable loading={items === null} rows={items || []} empty="No deletion requests" columns={[
        { key: 'n', label: 'User', render: r => <div className="adm-stack"><strong>{r.name}</strong><code className="adm-code">{r.id}</code></div> },
        { key: 'r', label: 'Requested', render: r => fmtDateTime(r.requestedAt) },
        { key: 's', label: 'Scheduled for', render: r => fmtDateTime(r.scheduledFor) },
        { key: 'st', label: 'State', render: r => (r.completedAt ? `Anonymised ${fmtDateTime(r.completedAt)}` : r.cancelledAt ? 'Cancelled by user' : 'Pending') }
      ]} />
    </>
  );
}

/** Admin: labs & test catalogue, lab orders (status, reports), DPDP deletion requests. */
export default function Labs({ api, section = 'labs', go }) {
  const tab = ['labs', 'orders', 'privacy'].includes(section) ? section : 'labs';
  return (
    <div>
      <PageHeader title="Labs & privacy" subtitle="Lab partners, test catalogue, home-collection orders and data-deletion requests." />
      <Tabs tabs={[{ value: 'labs', label: 'Labs & tests' }, { value: 'orders', label: 'Lab orders' }, { value: 'privacy', label: 'Deletion requests' }]} value={tab} onChange={v => go?.(`labs/${v}`)} />
      {tab === 'labs' && <LabsTab api={api} />}
      {tab === 'orders' && <OrdersTab api={api} />}
      {tab === 'privacy' && <DeletionsTab api={api} />}
    </div>
  );
}
