import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Stethoscope, Building2, Users, ClipboardCheck, MessageSquareWarning, BookOpenText,
  Receipt, Settings as SettingsIcon, LogOut, Menu, X, ShieldCheck, ArrowLeft, Layers, CalendarCheck, Crown, ScrollText
} from 'lucide-react';
import { createAdminApi } from './api';
import { ToastProvider } from './ui';
import Dashboard from './pages/Dashboard';
import EntityList from './pages/EntityList';
import Approvals from './pages/Approvals';
import Reviews from './pages/Reviews';
import Ledger from './pages/Ledger';
import GstReport from './pages/GstReport';
import Settings from './pages/Settings';
import Bookings from './pages/Bookings';
import Plans from './pages/Plans';
import AuditLog from './pages/AuditLog';
import AdminPortal from '../components/AdminPortal';

const NAV = [
  { group: 'Overview' },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { group: 'Accounts' },
  { id: 'doctors', label: 'Doctors', icon: Stethoscope },
  { id: 'clinics', label: 'Clinics', icon: Building2 },
  { id: 'patients', label: 'Patients', icon: Users },
  { id: 'approvals', label: 'Approvals', icon: ClipboardCheck, badge: 'pendingApprovals' },
  { group: 'Operations' },
  { id: 'bookings', label: 'Bookings', icon: CalendarCheck },
  { group: 'Moderation' },
  { id: 'reviews', label: 'Reviews', icon: MessageSquareWarning, badge: 'flaggedReviews' },
  { group: 'Finance' },
  { id: 'ledger', label: 'Ledger', icon: BookOpenText, badge: 'pendingPayouts' },
  { id: 'gst', label: 'GST Report', icon: Receipt },
  { id: 'plans', label: 'Plans & subscriptions', icon: Crown },
  { group: 'System' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
  { id: 'audit', label: 'Audit log', icon: ScrollText },
  { id: 'classic', label: 'Specialities & Classic', icon: Layers }
];

export default function AdminLayout({ token, username, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [counts, setCounts] = useState({});
  const api = useMemo(() => createAdminApi(token, onLogout), [token, onLogout]);

  const path = location.pathname.replace(/^\/admin\/?/, '');
  const [section, sub] = path.split('/');
  const current = section || 'dashboard';
  const go = useCallback(p => { navigate(`/admin/${p}`); setNavOpen(false); }, [navigate]);

  const refreshCounts = useCallback(() => {
    api.get('/dashboard').then(d => setCounts({
      pendingApprovals: d.kpis.pendingApprovals, flaggedReviews: d.kpis.flaggedReviews, pendingPayouts: d.kpis.pendingPayouts.count
    })).catch(() => {});
  }, [api]);
  useEffect(() => { refreshCounts(); }, [refreshCounts, current]);
  useEffect(() => { document.body.style.overflow = navOpen ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [navOpen]);

  let page;
  switch (current) {
    case 'doctors': case 'clinics': case 'patients':
      page = <EntityList key={current} api={api} entity={current} />; break;
    case 'approvals': page = <Approvals api={api} onCountsChange={refreshCounts} />; break;
    case 'reviews': page = <Reviews api={api} onCountsChange={refreshCounts} />; break;
    case 'ledger': page = <Ledger key={sub || 'subscriptions'} api={api} section={sub || 'subscriptions'} go={go} onCountsChange={refreshCounts} />; break;
    case 'gst': page = <GstReport api={api} />; break;
    case 'settings': page = <Settings api={api} />; break;
    case 'bookings': page = <Bookings api={api} />; break;
    case 'plans': page = <Plans api={api} />; break;
    case 'audit': page = <AuditLog api={api} />; break;
    case 'classic': page = <AdminPortal adminToken={token} onExpired={() => onLogout('Session expired, please log in again')} />; break;
    default: page = <Dashboard api={api} go={go} />;
  }
  const currentLabel = NAV.find(n => n.id === current)?.label || 'Dashboard';

  return (
    <ToastProvider>
      <div className="adm-shell">
        <div className={`adm-backdrop ${navOpen ? 'open' : ''}`} onClick={() => setNavOpen(false)} />
        <aside className={`adm-sidebar ${navOpen ? 'open' : ''}`} aria-label="Admin navigation">
          <div className="adm-brand">
            <div className="adm-brand-icon"><ShieldCheck size={20} /></div>
            <div><strong>FindADoc</strong><span>Admin Console</span></div>
            <button className="adm-icon-btn adm-only-mobile" onClick={() => setNavOpen(false)} aria-label="Close menu"><X size={18} /></button>
          </div>
          <nav className="adm-nav">
            {NAV.map((n, i) => n.group
              ? <div key={`g${i}`} className="adm-nav-group">{n.group}</div>
              : (
                <button key={n.id} className={`sidebar-item ${current === n.id ? 'active' : ''}`} onClick={() => go(n.id)}>
                  <n.icon size={18} />
                  <span style={{ flex: 1 }}>{n.label}</span>
                  {n.badge && counts[n.badge] > 0 && <span className="adm-nav-badge">{counts[n.badge]}</span>}
                </button>
              ))}
          </nav>
          <div className="adm-sidebar-foot">
            <div className="adm-muted adm-small" style={{ marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis' }}>Signed in as <strong>{username}</strong></div>
            <a href="/" className="btn-secondary adm-btn adm-btn-sm" style={{ textDecoration: 'none', width: '100%', marginBottom: 8 }}><ArrowLeft size={14} /> Patient app</a>
            <button onClick={() => onLogout()} className="adm-btn adm-btn-danger-soft adm-btn-sm" style={{ width: '100%' }}><LogOut size={14} /> Sign out</button>
          </div>
        </aside>
        <div className="adm-main">
          <header className="adm-topbar">
            <button className="adm-icon-btn adm-only-mobile" onClick={() => setNavOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
            <div className="adm-crumbs"><span className="adm-muted">Admin</span> / <strong>{currentLabel}</strong></div>
            <span className="adm-topbar-tag"><ShieldCheck size={14} /> Secure admin session</span>
          </header>
          <main className="adm-content">{page}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
