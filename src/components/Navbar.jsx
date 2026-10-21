import React from 'react';
import {
  Stethoscope, Smartphone, Monitor, UserCheck, Shield, PlusCircle,
  Building2, User, KeyRound, Download, Sparkles
} from 'lucide-react';

export default function Navbar({
  activeRole,
  onSelectRole,
  isMobileFrame,
  onToggleMobileFrame,
  onOpenAddToHome,
  onOpenOtpModal,
  onOpenDoctorRegister,
  currentUser,
  onLogout
}) {
  return (
    <header className="top-header">
      {/* PWA Banner for mobile add to home screen */}
      <div className="pwa-banner">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Smartphone size={16} />
          <span>Install <strong>FindADoc</strong> to your phone's Home Screen for the best app experience</span>
        </div>
        <button onClick={onOpenAddToHome} className="pwa-install-btn">
          <Download size={13} />
          <span>Add to Home Screen</span>
        </button>
      </div>

      <div className="header-inner">
        {/* Brand */}
        <div
          onClick={() => onSelectRole('patient')}
          className="brand-badge"
        >
          <div className="brand-icon">
            <Stethoscope size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', letterSpacing: '-0.02em' }}>
                FindA<span style={{ color: '#0284c7' }}>Doc</span>
              </span>
              <span style={{ fontSize: '9px', background: '#e0f2fe', color: '#0369a1', padding: '1px 5px', borderRadius: '4px', fontWeight: '800' }}>
                LIGHT
              </span>
            </div>
            <span style={{ fontSize: '11px', color: '#64748b', display: 'block', marginTop: '-2px' }}>
              Healthcare & Doctor Discovery
            </span>
          </div>
        </div>

        {/* 3 User Types + Backend Admin Switcher */}
        <div className="role-badge-switch" style={{ display: 'flex', overflowX: 'auto', maxWidth: '420px' }}>
          <button
            onClick={() => onSelectRole('patient')}
            className={`role-pill ${activeRole === 'patient' ? 'active' : ''}`}
            title="Normal Patient / Discovery Mode"
          >
            <User size={13} />
            <span>Patient</span>
          </button>

          <button
            onClick={() => onSelectRole('doctor')}
            className={`role-pill ${activeRole === 'doctor' ? 'active' : ''}`}
            title="Doctor Portal & Fee Claims"
          >
            <Stethoscope size={13} />
            <span>Doctor</span>
          </button>

          <button
            onClick={() => onSelectRole('clinic')}
            className={`role-pill ${activeRole === 'clinic' ? 'active' : ''}`}
            title="Hospital & Clinic Portal"
          >
            <Building2 size={13} />
            <span>Clinic</span>
          </button>

          <button
            onClick={() => onSelectRole('admin')}
            className={`role-pill ${activeRole === 'admin' ? 'active' : ''}`}
            title="Backend Management & Database Control"
            style={{ color: activeRole === 'admin' ? '#7c3aed' : undefined }}
          >
            <Shield size={13} />
            <span>Admin</span>
          </button>
        </div>

        {/* Right Action Tools */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Frame View Toggle (Phone viewport vs Responsive Full Web) */}
          <button
            onClick={onToggleMobileFrame}
            className="btn-secondary"
            title={isMobileFrame ? 'Switch to Full Browser Mode' : 'Switch to Native Mobile App View'}
            style={{ padding: '7px 11px', fontSize: '12px' }}
          >
            {isMobileFrame ? (
              <>
                <Monitor size={15} color="#0284c7" />
                <span style={{ display: 'none' }}>Desktop View</span>
              </>
            ) : (
              <>
                <Smartphone size={15} color="#0284c7" />
                <span>Mobile App View</span>
              </>
            )}
          </button>

          {/* Doctor Registration Button */}
          <button
            onClick={onOpenDoctorRegister}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '7px 12px',
              borderRadius: '10px',
              background: '#ecfdf5',
              border: '1px solid #a7f3d0',
              color: '#059669',
              fontSize: '12px',
              fontWeight: '700'
            }}
          >
            <PlusCircle size={14} />
            <span>Join as Doctor</span>
          </button>

          {/* User Auth / OTP Status */}
          {currentUser && currentUser.isVerified ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="badge-verified">
                <UserCheck size={13} />
                <span>{currentUser.name?.split(' ')[0] || 'Verified'}</span>
              </span>
              <button
                onClick={onLogout}
                style={{ fontSize: '11px', color: '#64748b', background: 'transparent', textDecoration: 'underline' }}
              >
                Exit
              </button>
            </div>
          ) : (
            <button
              onClick={onOpenOtpModal}
              className="btn-primary"
              style={{ padding: '7px 14px', fontSize: '12px' }}
            >
              <KeyRound size={14} />
              <span>OTP Login</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
