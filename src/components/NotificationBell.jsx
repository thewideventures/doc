import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';

const timeAgo = d => {
  const s = Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' });
};

/** In-app notifications (polls every 60 s while the tab is visible). */
export default function NotificationBell({ client, onNavigate }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const [loading, setLoading] = useState(false);
  const ref = useRef(null);

  const load = useCallback(async () => {
    try { setData(await client.get('/notifications', { limit: 15 })); } catch { /* ignore: handled by client (401) */ }
  }, [client]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const k = e => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [open]);

  const toggle = async () => { setOpen(o => !o); if (!open) { setLoading(true); await load(); setLoading(false); } };
  const readAll = async () => { await client.post('/notifications/read-all').catch(() => {}); load(); };
  const click = async n => {
    if (!n.readAt) { client.post(`/notifications/${n.id}/read`).catch(() => {}); setData(d => ({ ...d, unread: Math.max(0, d.unread - 1), items: d.items.map(x => x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x) })); }
    onNavigate?.(n);
    setOpen(false);
  };

  return (
    <div className="fx-bell" ref={ref}>
      <button className="adm-icon-btn" onClick={toggle} aria-label={`Notifications${data.unread ? `, ${data.unread} unread` : ''}`} aria-expanded={open}>
        <Bell size={18} />
        {data.unread > 0 && <span className="fx-bell-dot">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="fx-bell-panel" role="dialog" aria-label="Notifications">
          <div className="fx-bell-head"><strong>Notifications</strong>{data.unread > 0 && <button className="adm-link" onClick={readAll}><CheckCheck size={14} /> Mark all read</button>}</div>
          {loading && !data.items.length ? <div className="fx-center"><Loader2 size={16} className="adm-spin" /></div>
            : data.items.length === 0 ? <p className="adm-muted adm-small fx-pad">You're all caught up.</p>
              : (
                <ul>
                  {data.items.map(n => (
                    <li key={n.id} className={n.readAt ? '' : 'unread'}>
                      <button onClick={() => click(n)}>
                        <strong>{n.title}</strong>
                        {n.body && <span>{n.body}</span>}
                        <small>{timeAgo(n.createdAt)}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
        </div>
      )}
    </div>
  );
}
