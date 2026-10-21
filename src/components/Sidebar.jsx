import React from 'react';
import { Stethoscope, Sparkles, Building2, Calendar, UserRound, Award, PlusCircle, KeyRound, LogOut, ChevronRight, UserCheck } from 'lucide-react';

export const PATIENT_NAV = [
  { id: 'find-doctors', label: 'Find doctors', icon: Stethoscope },
  { id: 'clinics', label: 'Hospitals & clinics', icon: Building2 },
  { id: 'my-bookings', label: 'My appointments', icon: Calendar },
  { id: 'profile', label: 'My profile', icon: UserRound }
];

export default function Sidebar({ currentView, onSelectView, currentUser, onOpenLogin, onOpenAi, onLogout }) {
  return (
    <aside className="desktop-sidebar">
      <div className="sidebar-header">
        <div className="fx-logo"><Stethoscope size={22} /></div>
        <div>
          <span className="fx-logo-text">FindA<span>Doc</span></span>
          <span className="fx-logo-sub">Healthcare & doctor discovery</span>
        </div>
      </div>
      <nav className="sidebar-nav">
        <div className="fx-nav-group">PATIENT CARE</div>
        {PATIENT_NAV.map(item => (
          <button key={item.id} onClick={() => onSelectView(item.id)} className={`sidebar-item ${currentView === item.id ? 'active' : ''}`} aria-current={currentView === item.id ? 'page' : undefined}>
            <item.icon size={18} /><span style={{ flex: 1 }}>{item.label}</span>
          </button>
        ))}
        <button onClick={onOpenAi} className="sidebar-item" data-testid="sidebar-ai"><Sparkles size={18} /><span style={{ flex: 1 }}>AI symptom search</span><span className="fx-ai-tag">AI</span></button>
        <div className="fx-nav-group" style={{ paddingTop: 16 }}>FOR DOCTORS & CLINICS</div>
        <a href="/doctor" className="sidebar-item"><Award size={18} /><span style={{ flex: 1 }}>Doctor workspace</span><ChevronRight size={14} /></a>
        <a href="/clinic" className="sidebar-item"><Building2 size={18} /><span style={{ flex: 1 }}>Clinic workspace</span><ChevronRight size={14} /></a>
        <a href="/doctor?register=1" className="fx-register-link"><PlusCircle size={15} /> Register as doctor</a>
      </nav>
      <div className="sidebar-footer">
        {currentUser ? (
          <div className="fx-user-box">
            <div><strong><UserCheck size={14} /> {currentUser.name && currentUser.name !== 'Patient User' ? currentUser.name : 'Patient'}</strong><span>{currentUser.phone}</span></div>
            <button onClick={onLogout} title="Sign out" aria-label="Sign out"><LogOut size={15} /></button>
          </div>
        ) : (
          <button onClick={onOpenLogin} className="btn-primary adm-btn" style={{ width: '100%' }}><KeyRound size={15} /> Sign in with mobile</button>
        )}
      </div>
    </aside>
  );
}
