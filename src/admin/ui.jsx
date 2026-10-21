import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { X, CheckCircle2, AlertCircle, Info, ChevronLeft, ChevronRight, Search, RotateCcw, Loader2 } from 'lucide-react';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
const ToastCtx = createContext({ push: () => {} });

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = 'success') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4500);
  }, []);
  const api = useRef({ success: m => push(m, 'success'), error: m => push(m, 'error'), info: m => push(m, 'info') });
  return (
    <ToastCtx.Provider value={api.current}>
      {children}
      <div className="adm-toasts" role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`adm-toast adm-toast-${t.type}`}>
            {t.type === 'error' ? <AlertCircle size={16} /> : t.type === 'info' ? <Info size={16} /> : <CheckCircle2 size={16} />}
            <span>{t.message}</span>
            <button onClick={() => setToasts(x => x.filter(y => y.id !== t.id))} aria-label="Dismiss"><X size={14} /></button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------
const BADGE = {
  active: ['Active', 'green'], pending: ['Pending', 'amber'], rejected: ['Rejected', 'rose'], suspended: ['Suspended', 'red'], deleted: ['Deleted', 'slate'],
  visible: ['Public', 'green'], flagged: ['Flagged', 'red'], approved: ['Approved', 'blue'], verified: ['Verified', 'green'],
  Pending: ['Pending', 'amber'], Approved: ['Approved', 'blue'], Paid: ['Paid', 'green'], Rejected: ['Rejected', 'rose'], Completed: ['Completed', 'green'],
  paid: ['Paid', 'green'], failed: ['Failed', 'red'], refunded: ['Refunded', 'slate'],
  intra: ['Intra-state', 'blue'], inter: ['Inter-state', 'purple']
};
export function StatusBadge({ status, label }) {
  const [text, tone] = BADGE[status] || [status || '—', 'slate'];
  return <span className={`adm-badge adm-badge-${tone}`}>{label || text}</span>;
}

// ---------------------------------------------------------------------------
// Modal + confirm
// ---------------------------------------------------------------------------
export function Modal({ open, title, onClose, children, width = 560, footer }) {
  useEffect(() => {
    if (!open) return;
    const h = e => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content adm-modal" style={{ maxWidth: width }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="adm-modal-head">
          <h3>{title}</h3>
          {onClose && <button className="adm-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>}
        </div>
        <div className="adm-modal-body">{children}</div>
        {footer && <div className="adm-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Confirm dialog. If `input` is given ({label, placeholder, required, multiline}),
 * the entered value is passed to onConfirm.
 */
export function ConfirmModal({ open, title, message, confirmLabel = 'Confirm', danger, input, onConfirm, onClose }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setValue(''); setBusy(false); } }, [open]);
  const invalid = input?.required && value.trim().length < (input.minLength || 1);
  const submit = async () => {
    if (invalid) return;
    setBusy(true);
    try { await onConfirm(value.trim()); onClose(); } catch { setBusy(false); }
  };
  return (
    <Modal open={open} title={title} onClose={busy ? undefined : onClose} width={480}
      footer={<>
        <button className="btn-secondary adm-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button className={`adm-btn ${danger ? 'adm-btn-danger' : 'btn-primary'}`} onClick={submit} disabled={busy || invalid}>
          {busy ? <Loader2 size={15} className="adm-spin" /> : null}{confirmLabel}
        </button>
      </>}>
      {message && <p className="adm-muted" style={{ marginBottom: input ? 12 : 0 }}>{message}</p>}
      {input && (
        <label className="adm-field">
          <span>{input.label}{input.required && ' *'}</span>
          {input.multiline
            ? <textarea rows={3} value={value} onChange={e => setValue(e.target.value)} placeholder={input.placeholder} autoFocus />
            : <input value={value} onChange={e => setValue(e.target.value)} placeholder={input.placeholder} autoFocus onKeyDown={e => e.key === 'Enter' && submit()} />}
          {input.hint && <small className="adm-muted">{input.hint}</small>}
        </label>
      )}
    </Modal>
  );
}

// Hook: const [confirm, confirmEl] = useConfirm(); confirm({...})
export function useConfirm() {
  const [cfg, setCfg] = useState(null);
  const el = <ConfirmModal open={Boolean(cfg)} {...(cfg || {})} onClose={() => setCfg(null)} onConfirm={cfg?.onConfirm || (() => {})} />;
  return [setCfg, el];
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------
export function Pagination({ page, pages, total, limit, onPage, onLimit }) {
  if (!total) return null;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  const nums = [];
  const start = Math.max(1, Math.min(page - 2, pages - 4));
  for (let i = start; i <= Math.min(pages, start + 4); i++) nums.push(i);
  return (
    <div className="adm-pagination">
      <span className="adm-muted">Showing <strong>{from}–{to}</strong> of <strong>{total}</strong></span>
      <div className="adm-pages">
        <button className="adm-page-btn" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
        {nums.map(n => <button key={n} className={`adm-page-btn ${n === page ? 'active' : ''}`} onClick={() => onPage(n)}>{n}</button>)}
        <button className="adm-page-btn" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
        {onLimit && (
          <select className="adm-select adm-select-sm" value={limit} onChange={e => onLimit(Number(e.target.value))} aria-label="Rows per page">
            {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filters bar. fields: [{key, type:'search'|'select'|'date'|'month', label, options:[{value,label}]}]
// ---------------------------------------------------------------------------
export function FilterBar({ fields, values, onChange, onReset, right }) {
  const [searchDraft, setSearchDraft] = useState(values.search || '');
  useEffect(() => { setSearchDraft(values.search || ''); }, [values.search]);
  useEffect(() => {
    const t = setTimeout(() => { if ((values.search || '') !== searchDraft) onChange({ search: searchDraft }); }, 350);
    return () => clearTimeout(t);
  }, [searchDraft]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="adm-filters">
      {fields.map(f => {
        if (f.type === 'search') return (
          <div key={f.key} className="adm-search">
            <Search size={15} />
            <input value={searchDraft} onChange={e => setSearchDraft(e.target.value)} placeholder={f.label || 'Search…'} aria-label={f.label || 'Search'} />
          </div>
        );
        if (f.type === 'select') return (
          <label key={f.key} className="adm-filter">
            <span>{f.label}</span>
            <select className="adm-select" value={values[f.key] ?? ''} onChange={e => onChange({ [f.key]: e.target.value })}>
              {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        );
        return (
          <label key={f.key} className="adm-filter">
            <span>{f.label}</span>
            <input className="adm-select" type={f.type} value={values[f.key] || ''} onChange={e => onChange({ [f.key]: e.target.value })} />
          </label>
        );
      })}
      {onReset && <button className="adm-btn btn-secondary adm-btn-sm" onClick={onReset} title="Reset filters"><RotateCcw size={14} /> Reset</button>}
      {right && <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>{right}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DataTable. columns: [{key, label, render?(row), align?, width?}]
// ---------------------------------------------------------------------------
export function DataTable({ columns, rows, loading, empty = 'No records found', rowKey = r => r.id || r._id, footer, onRowClick }) {
  return (
    <div className="adm-table-wrap">
      <table className="adm-table">
        <thead>
          <tr>{columns.map(c => <th key={c.key} style={{ textAlign: c.align || 'left', width: c.width }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {loading && !rows?.length ? (
            <tr><td colSpan={columns.length} className="adm-table-empty"><Loader2 size={18} className="adm-spin" /> Loading…</td></tr>
          ) : !rows?.length ? (
            <tr><td colSpan={columns.length} className="adm-table-empty">{empty}</td></tr>
          ) : rows.map(r => (
            <tr key={rowKey(r)} className={onRowClick ? 'adm-clickable' : ''} onClick={onRowClick ? () => onRowClick(r) : undefined} style={{ opacity: loading ? 0.6 : 1 }}>
              {columns.map(c => <td key={c.key} data-label={c.label} style={{ textAlign: c.align || 'left' }}>{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot>{footer}</tfoot>}
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cards & charts (pure SVG/CSS)
// ---------------------------------------------------------------------------
export function KpiCard({ icon: Icon, label, value, sub, tone = 'blue', onClick }) {
  return (
    <button type="button" className={`adm-kpi adm-kpi-${tone}`} onClick={onClick} disabled={!onClick}>
      <div className="adm-kpi-icon">{Icon && <Icon size={18} />}</div>
      <div style={{ minWidth: 0 }}>
        <div className="adm-kpi-label">{label}</div>
        <div className="adm-kpi-value">{value}</div>
        {sub && <div className="adm-kpi-sub">{sub}</div>}
      </div>
    </button>
  );
}

/** Grouped/stacked bar chart. data: [{label, values:{key:number}}], series: [{key,label,color}] */
export function BarChart({ data, series, height = 180, format = v => v, stacked = true }) {
  const max = Math.max(1, ...data.map(d => stacked ? series.reduce((s, x) => s + (d.values[x.key] || 0), 0) : Math.max(...series.map(x => d.values[x.key] || 0))));
  const w = 100 / Math.max(1, data.length);
  return (
    <div>
      <svg viewBox={`0 0 100 ${height / 3}`} preserveAspectRatio="none" className="adm-chart" style={{ height }} role="img">
        {[0.25, 0.5, 0.75, 1].map(g => <line key={g} x1="0" x2="100" y1={(height / 3) * (1 - g)} y2={(height / 3) * (1 - g)} className="adm-chart-grid" />)}
        {data.map((d, i) => {
          const H = height / 3;
          if (stacked) {
            let acc = 0;
            return series.map(s => {
              const v = d.values[s.key] || 0;
              const h = (v / max) * (H - 2);
              const y = H - acc - h;
              acc += h;
              return <rect key={s.key} x={i * w + w * 0.2} width={w * 0.6} y={y} height={Math.max(0, h)} fill={s.color} rx="0.6"><title>{`${d.label} • ${s.label}: ${format(v)}`}</title></rect>;
            });
          }
          const bw = (w * 0.7) / series.length;
          return series.map((s, j) => {
            const v = d.values[s.key] || 0;
            const h = (v / max) * (H - 2);
            return <rect key={s.key} x={i * w + w * 0.15 + j * bw} width={bw * 0.9} y={H - h} height={Math.max(0, h)} fill={s.color} rx="0.5"><title>{`${d.label} • ${s.label}: ${format(v)}`}</title></rect>;
          });
        })}
      </svg>
      <div className="adm-chart-x">{data.map(d => <span key={d.label} style={{ width: `${w}%` }}>{d.label}</span>)}</div>
      <div className="adm-legend">{series.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>
    </div>
  );
}

/** Donut chart. parts: [{label, value, color}] */
export function Donut({ parts, size = 140, center }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 15.9155;
  let offset = 25;
  return (
    <div className="adm-donut">
      <svg viewBox="0 0 42 42" width={size} height={size} role="img">
        <circle cx="21" cy="21" r={r} fill="transparent" stroke="#f1f5f9" strokeWidth="5" />
        {total > 0 && parts.map(p => {
          const pct = (p.value / total) * 100;
          const el = <circle key={p.label} cx="21" cy="21" r={r} fill="transparent" stroke={p.color} strokeWidth="5" strokeDasharray={`${pct} ${100 - pct}`} strokeDashoffset={offset}><title>{`${p.label}: ${p.value}`}</title></circle>;
          offset -= pct;
          return el;
        })}
        <text x="21" y="22.5" textAnchor="middle" className="adm-donut-text">{center ?? total}</text>
      </svg>
      <div className="adm-legend adm-legend-col">{parts.map(p => <span key={p.label}><i style={{ background: p.color }} />{p.label}: <strong>{p.value}</strong></span>)}</div>
    </div>
  );
}

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`adm-card ${className}`}>
      {(title || actions) && <div className="adm-card-head"><h3>{title}</h3>{actions && <div className="adm-card-actions">{actions}</div>}</div>}
      {children}
    </section>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="adm-tabs" role="tablist">
      {tabs.map(t => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={`adm-tab ${value === t.value ? 'active' : ''}`} onClick={() => onChange(t.value)}>
          {t.icon && <t.icon size={15} />}{t.label}{t.count !== undefined && <span className="adm-tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="adm-page-head">
      <div><h1>{title}</h1>{subtitle && <p className="adm-muted">{subtitle}</p>}</div>
      {actions && <div className="adm-page-actions">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paginated list hook with filters kept in state
// ---------------------------------------------------------------------------
export function useAdminList(api, path, initial) {
  const [params, setParams] = useState({ page: 1, limit: 20, ...initial });
  const [data, setData] = useState({ items: [], total: 0, page: 1, pages: 1, limit: 20 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get(path, params)
      .then(d => { if (alive) { setData(d); setError(''); } })
      .catch(e => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [api, path, JSON.stringify(params), nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const update = patch => setParams(p => ({ ...p, ...patch, page: patch.page ?? 1 }));
  const reset = () => setParams({ page: 1, limit: params.limit, ...initial });
  return { params, update, reset, data, loading, error, reload: () => setNonce(n => n + 1) };
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="adm-alert adm-alert-error"><AlertCircle size={16} /> {error}</div>;
}
