import React, { useEffect, useRef, useState } from 'react';
import { X, ShieldCheck, Smartphone, KeyRound, Loader2, AlertCircle, ArrowLeft, Info } from 'lucide-react';
import { apiFetch, setSession } from '../lib/api';

/** Patient OTP sign-in (sheet on mobile, dialog on desktop). Stores the signed session token. */
export function PatientAuthForm({ notice, onSuccess }) {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const otpRef = useRef(null);
  useEffect(() => { if (cooldown <= 0) return undefined; const t = setTimeout(() => setCooldown(c => c - 1), 1000); return () => clearTimeout(t); }, [cooldown]);
  useEffect(() => { if (step === 'otp') otpRef.current?.focus(); }, [step]);
  const digits = phone.replace(/\D/g, '').slice(-10);

  const send = async e => {
    e?.preventDefault();
    if (!/^[6-9]\d{9}$/.test(digits)) { setError('Enter a valid 10-digit Indian mobile number'); return; }
    setBusy(true); setError('');
    try { const r = await apiFetch('/api/auth/send-otp', { method: 'POST', body: { phone: digits, role: 'patient' } }); setInfo(r.message); setStep('otp'); setCooldown(30); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const verify = async e => {
    e?.preventDefault();
    if (!/^\d{6}$/.test(otp)) { setError('Enter the 6-digit OTP'); return; }
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/api/auth/verify-otp', { method: 'POST', body: { phone: digits, otp, name: name.trim() || undefined, role: 'patient' } });
      setSession('patient', { token: r.token, user: r.user, role: 'patient' });
      onSuccess(r.user);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="adm-form">
      {notice && <div className="adm-alert adm-alert-info" role="alert"><Info size={16} /> {notice}</div>}
      {error && <div className="adm-alert adm-alert-error" role="alert"><AlertCircle size={16} /> {error}</div>}
      {step === 'phone' ? (
        <form onSubmit={send} className="adm-form">
          <label className="adm-field"><span>Mobile number</span><div className="fx-phone"><span>+91</span><input value={phone} onChange={e => setPhone(e.target.value.replace(/[^\d ]/g, '').slice(0, 12))} inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" autoFocus aria-label="Mobile number" /></div></label>
          <label className="adm-field"><span>Your name (new users)</span><input value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="Optional" /></label>
          <button className="btn-primary adm-btn" disabled={busy} data-testid="patient-send-otp">{busy ? <Loader2 size={15} className="adm-spin" /> : <Smartphone size={15} />} Send OTP</button>
        </form>
      ) : (
        <form onSubmit={verify} className="adm-form">
          {info && <p className="adm-small adm-muted">{info}</p>}
          <label className="adm-field"><span>6-digit OTP</span><input ref={otpRef} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="fx-otp" placeholder="••••••" aria-label="OTP" /></label>
          <button className="btn-primary adm-btn" disabled={busy} data-testid="patient-verify-otp">{busy ? <Loader2 size={15} className="adm-spin" /> : <KeyRound size={15} />} Verify & sign in</button>
          <div className="fx-row fx-between">
            <button type="button" className="adm-link" onClick={() => { setStep('phone'); setOtp(''); }}><ArrowLeft size={13} /> Change number</button>
            <button type="button" className="adm-link" disabled={cooldown > 0 || busy} onClick={send}>{cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend OTP'}</button>
          </div>
        </form>
      )}
      <p className="adm-small adm-muted"><ShieldCheck size={12} /> We only use your number for appointment updates.</p>
    </div>
  );
}

export default function PatientAuthModal({ isOpen, onClose, onSuccess, notice }) {
  if (!isOpen) return null;
  return (
    <div className="fx-overlay fx-overlay-top" onClick={onClose}>
      <div className="fx-sheet fx-sheet-sm" role="dialog" aria-modal="true" aria-label="Sign in" onClick={e => e.stopPropagation()}>
        <div className="fx-sheet-head"><h3><ShieldCheck size={18} /> Sign in with mobile</h3><button className="adm-icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="fx-sheet-body"><PatientAuthForm notice={notice} onSuccess={u => { onSuccess(u); onClose(); }} /></div>
      </div>
    </div>
  );
}
