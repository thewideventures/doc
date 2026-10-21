import React, { useState } from 'react';
import { Stethoscope, Building2 } from 'lucide-react';
import { DataTable, FilterBar, Pagination, StatusBadge, useAdminList, ErrorNote, PageHeader, Card, Tabs } from '../ui';
import { ActionButtons, EntityDetailModal, useAccountActions } from './EntityList';
import { fmtDateTime } from '../api';

export default function Approvals({ api, onCountsChange }) {
  const [type, setType] = useState('doctors');
  const list = useAdminList(api, '/approvals', { type: 'doctors', sort: 'oldest' });
  const [viewId, setViewId] = useState(null);
  const reload = () => { list.reload(); onCountsChange?.(); };
  const [actions, confirmEl] = useAccountActions(api, type, reload);
  const { data } = list;
  const switchType = t => { setType(t); list.update({ type: t }); };

  return (
    <div>
      <PageHeader title="Pending Approvals" subtitle="New doctors and clinics stay hidden from patients and cannot take bookings until manually verified here." />
      <Tabs value={type} onChange={switchType} tabs={[
        { value: 'doctors', label: 'Doctors', icon: Stethoscope, count: data.counts?.doctors },
        { value: 'clinics', label: 'Clinics', icon: Building2, count: data.counts?.clinics }
      ]} />
      <Card>
        <FilterBar values={list.params} onChange={list.update} onReset={() => list.update({ search: '', sort: 'oldest' })} fields={[
          { key: 'search', type: 'search', label: 'Search name, email, phone…' },
          { key: 'sort', type: 'select', label: 'Sort', options: [{ value: 'oldest', label: 'Oldest first (queue)' }, { value: 'newest', label: 'Newest first' }] }
        ]} />
        <ErrorNote error={list.error} />
        <DataTable loading={list.loading} rows={data.items} empty="🎉 Nothing waiting for approval" onRowClick={r => setViewId(r.id)} columns={[
          { key: 'name', label: type === 'doctors' ? 'Doctor' : 'Clinic', render: r => <div className="adm-stack"><strong>{r.name}</strong><small>{type === 'doctors' ? `${r.qualifications} • ${r.specialities?.join(', ')}` : `${r.type} • ${r.address}`}</small></div> },
          { key: 'phone', label: 'Contact', render: r => <div className="adm-stack"><span>{r.phone}</span><small>{r.email || '—'}</small></div> },
          ...(type === 'doctors' ? [{ key: 'exp', label: 'Experience', render: r => `${r.experienceYears} yrs • ${r.sector}` }] : [{ key: 'city', label: 'City', render: r => r.city }]),
          { key: 'createdAt', label: 'Submitted', render: r => fmtDateTime(r.createdAt) },
          { key: 'status', label: 'Status', render: r => <StatusBadge status={r.status} /> },
          { key: 'a', label: 'Review', render: r => <ActionButtons row={r} actions={actions} onView={() => setViewId(r.id)} /> }
        ]} />
        <Pagination {...data} onPage={p => list.update({ page: p })} onLimit={l => list.update({ limit: l })} />
      </Card>
      <EntityDetailModal api={api} entity={type} id={viewId} onClose={() => setViewId(null)} onChanged={reload} />
      {confirmEl}
    </div>
  );
}
