import React, { useEffect, useState } from 'react';
import { Menu, X, LogOut, ArrowLeft, Stethoscope, Building2 } from 'lucide-react';
import NotificationBell from '../components/NotificationBell';
import { LanguageSwitcher } from '../i18n';

/**
 * Shared doctor / clinic workspace shell (sidebar on desktop, drawer + bottom tabs on mobile).
 * nav: [{ id, label, icon, badge?, mobile? }]
 */
export default function PortalShell({ role, entity, nav, active, onNav, onLogout, client, children, onNotification }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { document.body.style.overflow = open ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [open]);
  const go = id => { onNav(id); setOpen(false); window.scrollTo({ top: 0 }); };
  const BrandIcon = role === 'clinic' ? Building2 : Stethoscope;
  const current = nav.find(n => n.id === active);
  const mobileTabs = nav.filter(n => n.mobile).slice(0, 4);

  return (
    <div className={`adm-shell fx-portal fx-portal-${role}`}>
      <div className={`adm-backdrop ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`adm-sidebar ${open ? 'open' : ''}`} aria-label={`${role} navigation`}>
        <div className="adm-brand">
          <div className="adm-brand-icon"><BrandIcon size={20} /></div>
          <div><strong>FindADoc</strong><span>{role === 'clinic' ? 'Clinic workspace' : 'Doctor workspace'}</span></div>
          <button className="adm-icon-btn adm-only-mobile" onClick={() => setOpen(false)} aria-label="Close menu"><X size={18} /></button>
        </div>
        {entity && (
          <div className="fx-portal-entity">
            {entity.photo ? <img src={entity.photo} alt="" /> : <span className="adm-initial">{(entity.name || '?')[0]}</span>}
            <div><strong>{entity.name}</strong><small>{entity.plan?.name || 'Basic'} plan • {entity.status === 'active' ? 'Verified' : entity.status}</small></div>
          </div>
        )}
        <nav className="adm-nav">
          {nav.map(n => (
            <button key={n.id} className={`sidebar-item ${active === n.id ? 'active' : ''}`} onClick={() => go(n.id)} aria-current={active === n.id ? 'page' : undefined}>
              <n.icon size={18} /><span style={{ flex: 1 }}>{n.label}</span>
              {n.badge > 0 && <span className="adm-nav-badge">{n.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="adm-sidebar-foot">
          <a href="/" className="btn-secondary adm-btn adm-btn-sm" style={{ textDecoration: 'none', width: '100%', marginBottom: 8 }}><ArrowLeft size={14} /> Patient app</a>
          <button onClick={onLogout} className="adm-btn adm-btn-danger-soft adm-btn-sm" style={{ width: '100%' }}><LogOut size={14} /> Sign out</button>
        </div>
      </aside>
      <div className="adm-main">
        <header className="adm-topbar">
          <button className="adm-icon-btn adm-only-mobile" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={20} /></button>
          <div className="adm-crumbs"><strong>{current?.label || ''}</strong></div>
          <LanguageSwitcher compact />
          {client && <NotificationBell client={client} onNavigate={onNotification} />}
        </header>
        <main className="adm-content fx-portal-content">{children}</main>
        {mobileTabs.length > 0 && (
          <nav className="fx-tabbar" aria-label="Quick navigation">
            {mobileTabs.map(n => (
              <button key={n.id} className={active === n.id ? 'on' : ''} onClick={() => go(n.id)}>
                <n.icon size={19} /><span>{n.label}</span>{n.badge > 0 && <i>{n.badge}</i>}
              </button>
            ))}
            <button onClick={() => setOpen(true)}><Menu size={19} /><span>More</span></button>
          </nav>
        )}
      </div>
    </div>
  );
}
