import React, { useEffect, useRef, useState } from 'react';
import { Smartphone, KeyRound, Loader2, ArrowLeft, AlertCircle, Stethoscope, Building2, Info } from 'lucide-react';
import { apiFetch, setSession } from '../lib/api';

/**
 * OTP sign-in for doctors / clinics. If no profile exists for the number, calls onNeedRegister({ phone, phoneToken }).
 * `notice` shows e.g. "Session expired, please log in again".
 */
export default function PortalLogin({ role, notice, onLoggedIn, onNeedRegister, startRegister }) {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const otpRef = useRef(null);
  const Icon = role === 'clinic' ? Building2 : Stethoscope;
  const label = role === 'clinic' ? 'Clinic / hospital' : 'Doctor';

  useEffect(() => { if (cooldown <= 0) return undefined; const t = setTimeout(() => setCooldown(c => c - 1), 1000); return () => clearTimeout(t); }, [cooldown]);
  useEffect(() => { if (step === 'otp') otpRef.current?.focus(); }, [step]);

  const send = async e => {
    e?.preventDefault();
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(digits)) { setError('Enter a valid 10-digit Indian mobile number'); return; }
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/api/auth/send-otp', { method: 'POST', body: { phone: digits, role } });
      setInfo(r.message); setStep('otp'); setCooldown(30);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const verify = async e => {
    e?.preventDefault();
    if (!/^\d{6}$/.test(otp)) { setError('Enter the 6-digit OTP'); return; }
    setBusy(true); setError('');
    const digits = phone.replace(/\D/g, '').slice(-10);
    try {
      if (startRegister) {
        const r = await apiFetch('/api/auth/verify-phone', { method: 'POST', body: { phone: digits, otp } });
        onNeedRegister({ phone: r.phone, phoneToken: r.phoneToken });
        return;
      }
      const r = await apiFetch('/api/auth/verify-otp', { method: 'POST', body: { phone: digits, otp, role } });
      setSession(role, { token: r.token, user: r.user, role });
      onLoggedIn(r);
    } catch (err) {
      if (err.code === 'PROFILE_NOT_FOUND') { onNeedRegister({ phone: err.data.phone, phoneToken: err.data.phoneToken }); return; }
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className={`fx-auth fx-portal-${role}`}>
      <div className="fx-auth-card">
        <div className="fx-auth-brand"><span className="adm-brand-icon"><Icon size={22} /></span><div><strong>FindADoc</strong><small>{label} workspace</small></div></div>
        <h1>{startRegister ? `Register your ${role === 'clinic' ? 'clinic' : 'practice'}` : `${label} sign in`}</h1>
        <p className="adm-muted">{startRegister ? 'Verify your mobile number to start. It becomes your sign-in for the workspace.' : 'Sign in with the mobile number registered on your profile.'}</p>
        {notice && <div className="adm-alert adm-alert-info" role="alert"><Info size={16} /> {notice}</div>}
        {error && <div className="adm-alert adm-alert-error" role="alert"><AlertCircle size={16} /> {error}</div>}
        {step === 'phone' ? (
          <form onSubmit={send} className="adm-form">
            <label className="adm-field"><span>Mobile number</span>
              <div className="fx-phone"><span>+91</span><input value={phone} onChange={e => setPhone(e.target.value.replace(/[^\d ]/g, '').slice(0, 12))} inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" autoFocus aria-label="Mobile number" /></div>
            </label>
            <button className="btn-primary adm-btn" disabled={busy} data-testid="send-otp">{busy ? <Loader2 size={15} className="adm-spin" /> : <Smartphone size={15} />} Send OTP</button>
          </form>
        ) : (
          <form onSubmit={verify} className="adm-form">
            {info && <p className="adm-small adm-muted">{info}</p>}
            <label className="adm-field"><span>6-digit OTP</span>
              <input ref={otpRef} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="fx-otp" placeholder="••••••" aria-label="OTP" />
            </label>
            <button className="btn-primary adm-btn" disabled={busy} data-testid="verify-otp">{busy ? <Loader2 size={15} className="adm-spin" /> : <KeyRound size={15} />} Verify & continue</button>
            <div className="fx-row fx-between">
              <button type="button" className="adm-link" onClick={() => { setStep('phone'); setOtp(''); setError(''); }}><ArrowLeft size={13} /> Change number</button>
              <button type="button" className="adm-link" disabled={cooldown > 0 || busy} onClick={send}>{cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend OTP'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
