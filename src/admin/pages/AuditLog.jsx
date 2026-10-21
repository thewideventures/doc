import React from 'react';
import { PageHeader, FilterBar, DataTable, Pagination, useAdminList, ErrorNote, Card, StatusBadge } from '../ui';
import { fmtDateTime } from '../api';

/** Admin audit trail: every admin sign-in attempt and state-changing action (who / what / when / IP). */
export default function AuditLog({ api }) {
  const list = useAdminList(api, '/audit-log', { type: '' });
  const { data, params } = list;
  return (
    <>
      <PageHeader title="Audit log" subtitle="Admin sign-ins and every change made from the admin panel. Kept for 2 years." />
      <Card>
        <FilterBar values={params} onChange={list.update} onReset={list.reset} fields={[
          { key: 'search', type: 'search', label: 'Action, path, target, IP' },
          { key: 'type', type: 'select', label: 'Type', options: [{ value: '', label: 'All' }, { value: 'auth', label: 'Sign-ins' }, { value: 'changes', label: 'Changes' }] },
          { key: 'from', type: 'date', label: 'From' },
          { key: 'to', type: 'date', label: 'To' }
        ]} />
        <ErrorNote error={list.error} />
        <DataTable loading={list.loading} rows={data.items} empty="No audit entries" columns={[
          { key: 'at', label: 'When', render: r => fmtDateTime(r.at) },
          { key: 'actor', label: 'Who', render: r => r.actor || '—' },
          { key: 'action', label: 'What', render: r => <div className="adm-stack"><code className="adm-code">{r.action}</code>{r.target && <small>{r.target}</small>}</div> },
          { key: 'status', label: 'Result', render: r => <StatusBadge status={r.status >= 200 && r.status < 300 ? 'success' : r.status >= 400 ? 'failed' : 'info'} label={String(r.status || '—')} /> },
          { key: 'ip', label: 'IP', render: r => <div className="adm-stack"><span>{r.ip || '—'}</span><small title={r.userAgent}>{(r.userAgent || '').slice(0, 40)}</small></div> },
          { key: 'details', label: 'Details', render: r => <small className="adm-muted" style={{ wordBreak: 'break-word' }}>{r.details && Object.keys(r.details).length ? JSON.stringify(r.details.body || r.details).slice(0, 160) : ''}</small> }
        ]} />
        <Pagination {...data} onPage={p => list.update({ page: p })} onLimit={l => list.update({ limit: l })} />
      </Card>
    </>
  );
}
