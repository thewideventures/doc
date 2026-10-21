import React from 'react';
import { ThumbsUp, Flag, MessageSquare, List, CheckCircle2, EyeOff, Trash2, Star, ScanSearch } from 'lucide-react';
import { FilterBar, Pagination, StatusBadge, useAdminList, ErrorNote, PageHeader, Card, Tabs, useConfirm, useToast } from '../ui';
import { fmtDateTime } from '../api';

function highlight(text, words = []) {
  if (!words.length) return text;
  const esc = words.filter(w => !w.includes('*')).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\W+'));
  if (!esc.length) return text;
  const re = new RegExp(`(${esc.join('|')})`, 'gi');
  return String(text).split(re).map((part, i) => (i % 2 ? <mark key={i} className="adm-mark">{part}</mark> : part));
}

export default function Reviews({ api, onCountsChange }) {
  const list = useAdminList(api, '/reviews', { tab: 'flagged', sort: 'newest' });
  const [confirm, confirmEl] = useConfirm();
  const toast = useToast();
  const { data, params } = list;
  const after = () => { list.reload(); onCountsChange?.(); };
  const run = (fn) => fn().then(r => { toast.success(r.message); after(); }).catch(e => { toast.error(e.message); throw e; });

  const approve = r => confirm({ title: 'Publish this review?', message: 'The review will become publicly visible on the doctor profile and count towards the rating.', confirmLabel: 'Approve & publish', onConfirm: () => run(() => api.post(`/reviews/${r.id}/approve`)) });
  const hide = r => confirm({ title: 'Hide this review?', message: 'The review will be moved to the Flagged list and hidden from the public.', confirmLabel: 'Hide', danger: true, onConfirm: () => run(() => api.post(`/reviews/${r.id}/hide`, { reason: 'Hidden by admin' })) });
  const remove = r => confirm({ title: 'Delete this review?', message: 'The review will be removed permanently from public view and from the doctor rating.', confirmLabel: 'Delete', danger: true, onConfirm: () => run(() => api.del(`/reviews/${r.id}`)) });
  const rescan = () => confirm({ title: 'Re-scan all reviews?', message: 'All reviews (except admin-approved) are re-checked against the current bad-word list.', confirmLabel: 'Re-scan', onConfirm: () => run(() => api.post('/reviews/rescan')) });

  return (
    <div>
      <PageHeader title="Reviews" subtitle="Reviews containing abusive or profane words are automatically hidden and listed under Flagged." actions={<button className="btn-secondary adm-btn" onClick={rescan}><ScanSearch size={15} /> Re-scan</button>} />
      <Tabs value={params.tab} onChange={tab => list.update({ tab })} tabs={[
        { value: 'good', label: 'Good', icon: ThumbsUp, count: data.counts?.good },
        { value: 'flagged', label: 'Flagged / Bad words', icon: Flag, count: data.counts?.flagged },
        { value: 'other', label: 'Other', icon: MessageSquare, count: data.counts?.other },
        { value: 'all', label: 'All', icon: List, count: data.counts?.all }
      ]} />
      <p className="adm-muted adm-small" style={{ margin: '-4px 0 12px' }}>
        {params.tab === 'good' && 'Clean wording and rating ≥ 4 — public.'}
        {params.tab === 'flagged' && 'Hidden from the public. Approve to publish, or delete.'}
        {params.tab === 'other' && 'Public reviews that are clean but rated below 4, plus flagged reviews an admin approved.'}
        {params.tab === 'all' && 'Every review except deleted ones.'}
      </p>
      <Card>
        <FilterBar values={params} onChange={list.update} onReset={() => list.update({ search: '', rating: '', sort: 'newest', from: '', to: '' })} fields={[
          { key: 'search', type: 'search', label: 'Search text, reviewer, phone…' },
          { key: 'rating', type: 'select', label: 'Rating', options: [{ value: '', label: 'Any' }, ...[5, 4, 3, 2, 1].map(n => ({ value: String(n), label: `${n} ★` }))] },
          { key: 'sort', type: 'select', label: 'Sort', options: [{ value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' }, { value: 'rating_desc', label: 'Rating: high → low' }, { value: 'rating_asc', label: 'Rating: low → high' }] },
          { key: 'from', type: 'date', label: 'From' },
          { key: 'to', type: 'date', label: 'To' }
        ]} />
        <ErrorNote error={list.error} />
        <div className="adm-review-list" style={{ opacity: list.loading ? 0.6 : 1 }}>
          {!list.loading && data.items.length === 0 && <div className="adm-table-empty">No reviews in this category</div>}
          {data.items.map(r => (
            <article key={r.id} className={`adm-review ${r.moderationStatus === 'flagged' ? 'is-flagged' : ''}`}>
              <div className="adm-review-head">
                <div>
                  <strong>{r.userName}</strong> <span className="adm-muted">on</span> <strong>{r.doctorName}</strong>
                  <div className="adm-muted adm-small">{fmtDateTime(r.createdAt)} {r.userPhone && `• ${r.userPhone}`} {r.isVerifiedBooking && '• Verified booking'}</div>
                </div>
                <div className="adm-review-meta">
                  <span className="adm-stars">{[1, 2, 3, 4, 5].map(n => <Star key={n} size={14} fill={n <= r.rating ? '#f59e0b' : 'none'} color={n <= r.rating ? '#f59e0b' : '#cbd5e1'} />)}</span>
                  <StatusBadge status={r.moderationStatus} />
                </div>
              </div>
              <p className="adm-review-text">{highlight(r.comment, r.badWordsFound)}</p>
              {r.badWordsFound?.length > 0 && <div className="adm-small adm-flag-reason"><Flag size={12} /> {r.flagReason}</div>}
              <div className="adm-actions">
                {r.moderationStatus === 'flagged' && <button className="adm-act adm-act-green" onClick={() => approve(r)}><CheckCircle2 size={14} /><span>Approve to public</span></button>}
                {['visible', 'approved'].includes(r.moderationStatus) && <button className="adm-act adm-act-amber" onClick={() => hide(r)}><EyeOff size={14} /><span>Hide</span></button>}
                <button className="adm-act adm-act-red" onClick={() => remove(r)}><Trash2 size={14} /><span>Delete</span></button>
              </div>
            </article>
          ))}
        </div>
        <Pagination {...data} onPage={p => list.update({ page: p })} onLimit={l => list.update({ limit: l })} />
      </Card>
      {confirmEl}
    </div>
  );
}
