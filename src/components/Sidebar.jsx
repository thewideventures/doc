import React from 'react';
import { Stethoscope, Sparkles, Building2, Calendar, UserRound, Award, PlusCircle, KeyRound, LogOut, ChevronRight, UserCheck, FolderHeart, FlaskConical, ShieldCheck } from 'lucide-react';
import { useT } from '../i18n';

export const PATIENT_NAV = [
  { id: 'find-doctors', icon: Stethoscope },
  { id: 'clinics', icon: Building2 },
  { id: 'my-bookings', icon: Calendar },
  { id: 'records', icon: FolderHeart },
  { id: 'labs', icon: FlaskConical },
  { id: 'profile', icon: UserRound },
  { id: 'privacy', icon: ShieldCheck }
];

export default function Sidebar({ currentView, onSelectView, currentUser, onOpenLogin, onOpenAi, onLogout }) {
  const t = useT();
  return (
    <aside className="desktop-sidebar">
      <div className="sidebar-header">
        <div className="fx-logo"><Stethoscope size={22} /></div>
        <div>
          <span className="fx-logo-text">FindA<span>Doc</span></span>
          <span className="fx-logo-sub">{t('brand.tagline')}</span>
        </div>
      </div>
      <nav className="sidebar-nav">
        <div className="fx-nav-group">{t('nav.patientCare')}</div>
        {PATIENT_NAV.map(item => (
          <button key={item.id} onClick={() => onSelectView(item.id)} className={`sidebar-item ${currentView === item.id ? 'active' : ''}`} aria-current={currentView === item.id ? 'page' : undefined} data-testid={`nav-${item.id}`}>
            <item.icon size={18} /><span style={{ flex: 1 }}>{t(`title.${item.id}`)}</span>
          </button>
        ))}
        <button onClick={onOpenAi} className="sidebar-item" data-testid="sidebar-ai"><Sparkles size={18} /><span style={{ flex: 1 }}>{t('ai.title')}</span><span className="fx-ai-tag">AI</span></button>
        <div className="fx-nav-group" style={{ paddingTop: 16 }}>{t('nav.forPros')}</div>
        <a href="/doctor" className="sidebar-item"><Award size={18} /><span style={{ flex: 1 }}>{t('nav.doctorWorkspace')}</span><ChevronRight size={14} /></a>
        <a href="/clinic" className="sidebar-item"><Building2 size={18} /><span style={{ flex: 1 }}>{t('nav.clinicWorkspace')}</span><ChevronRight size={14} /></a>
        <a href="/doctor?register=1" className="fx-register-link"><PlusCircle size={15} /> {t('nav.registerDoctor')}</a>
      </nav>
      <div className="sidebar-footer">
        {currentUser ? (
          <div className="fx-user-box">
            <div><strong><UserCheck size={14} /> {currentUser.name && currentUser.name !== 'Patient User' ? currentUser.name : t('auth.patient')}</strong><span>{currentUser.phone}</span></div>
            <button onClick={onLogout} title={t('auth.signOut')} aria-label={t('auth.signOut')}><LogOut size={15} /></button>
          </div>
        ) : (
          <button onClick={onOpenLogin} className="btn-primary adm-btn" style={{ width: '100%' }}><KeyRound size={15} /> {t('auth.signInMobile')}</button>
        )}
      </div>
    </aside>
  );
}
