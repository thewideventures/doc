import React, { useState } from 'react';
import { ShieldCheck, Phone, KeyRound, Check, X, AlertCircle, ArrowRight, UserCheck } from 'lucide-react';

export default function OtpAuthModal({ isOpen, onClose, onLoginSuccess, initialRole = 'patient' }) {
  const [phone, setPhone] = useState('+91 98765 11111');
  const [name, setName] = useState('');
  const [role, setRole] = useState(initialRole);
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState(1); // 1: Enter phone, 2: Enter OTP
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  if (!isOpen) return null;

  const handleSendOtp = async (e) => {
    e?.preventDefault();
    if (!phone || phone.trim().length < 8) {
      setError('Please enter a valid phone number');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, role })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send OTP');

      setSuccessMsg(`OTP sent to ${phone}. Dummy Test OTP: 123456`);
      setStep(2);
      setOtp('123456'); // Auto-fill test dummy OTP for instant convenience
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e) => {
    e?.preventDefault();
    if (!otp) {
      setError('Please enter 6-digit OTP');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp, name, role })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invalid OTP');

      onLoginSuccess(data.user, data.associatedDoctor, data.associatedClinic);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#ecfdf5', color: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ShieldCheck size={24} />
            </div>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: '800' }}>Mobile OTP Verification</h3>
              <p style={{ fontSize: '12px', color: '#64748b' }}>Strict verification for verified users & doctors</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: '#f1f5f9', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={18} color="#64748b" />
          </button>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 14px', borderRadius: '12px', fontSize: '12px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        {successMsg && (
          <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', padding: '10px 14px', borderRadius: '12px', fontSize: '12px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Check size={16} />
            {successMsg}
          </div>
        )}

        {step === 1 ? (
          <form onSubmit={handleSendOtp} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px', display: 'block' }}>
                Select Your Account Type:
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                {[
                  { id: 'patient', label: 'Patient / User' },
                  { id: 'doctor', label: 'Doctor' },
                  { id: 'clinic', label: 'Clinic/Hospital' }
                ].map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRole(r.id)}
                    style={{
                      padding: '8px 4px',
                      borderRadius: '10px',
                      fontSize: '11px',
                      fontWeight: '700',
                      border: role === r.id ? '2px solid #0284c7' : '1px solid #e2e8f0',
                      background: role === r.id ? '#f0f9ff' : '#f8fafc',
                      color: role === r.id ? '#0284c7' : '#64748b'
                    }}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px', display: 'block' }}>
                Full Name (Optional):
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Rohan Kapoor / Dr. Meenakshi"
                style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '14px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '6px', display: 'block' }}>
                Mobile Number:
              </label>
              <div style={{ position: 'relative' }}>
                <Phone size={16} color="#94a3b8" style={{ position: 'absolute', left: '12px', top: '14px' }} />
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  required
                  style={{ width: '100%', padding: '10px 14px 10px 38px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '14px' }}
                />
              </div>
              <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                For quick test: you can keep default test number or type any phone
              </span>
            </div>

            <button type="submit" disabled={loading} className="btn-primary" style={{ padding: '12px', marginTop: '6px' }}>
              {loading ? 'Sending OTP...' : <>Send Secure OTP <ArrowRight size={16} /></>}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ textAlign: 'center', padding: '10px 0' }}>
              <div style={{ width: '50px', height: '50px', borderRadius: '50%', background: '#e0f2fe', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px' }}>
                <KeyRound size={24} />
              </div>
              <p style={{ fontSize: '13px', color: '#475569' }}>
                Enter the 6-digit code sent to <strong>{phone}</strong>
              </p>
            </div>

            <div>
              <input
                type="text"
                value={otp}
                onChange={e => setOtp(e.target.value)}
                placeholder="Enter 123456"
                maxLength={6}
                required
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: '12px',
                  border: '2px solid #0284c7',
                  fontSize: '22px',
                  letterSpacing: '8px',
                  textAlign: 'center',
                  fontWeight: '700',
                  color: '#0f172a'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => setOtp('123456')}
                style={{ flex: 1, padding: '8px', background: '#f0fdf4', border: '1px solid #86efac', color: '#16a34a', borderRadius: '10px', fontSize: '12px', fontWeight: '700' }}
              >
                Auto-Fill Dummy OTP (123456)
              </button>
              <button
                type="button"
                onClick={() => setStep(1)}
                style={{ padding: '8px 12px', background: '#f1f5f9', border: '1px solid #cbd5e1', color: '#475569', borderRadius: '10px', fontSize: '12px' }}
              >
                Change Phone
              </button>
            </div>

            <button type="submit" disabled={loading} className="btn-primary" style={{ padding: '12px', marginTop: '6px' }}>
              {loading ? 'Verifying...' : <><UserCheck size={18} /> Confirm & Log In</>}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
