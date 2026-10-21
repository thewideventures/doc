import React, { useState } from 'react';
import { Building, Sparkles, CheckCircle2, XCircle, UserCheck, Phone, MapPin, ShieldCheck, Plus, Check } from 'lucide-react';

export default function ClinicPortal({ clinic, onRefreshClinic }) {
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  if (!clinic) {
    return (
      <div style={{ background: '#ffffff', borderRadius: '20px', padding: '32px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
        <h3 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '8px' }}>Clinic Portal</h3>
        <p style={{ color: '#64748b', fontSize: '14px' }}>Please log in with a clinic account or select Clinic role in header.</p>
      </div>
    );
  }

  // Approve doctor request
  const handleApproveDoctor = async (doctorId) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`/api/clinics/${clinic.id}/approve-doctor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctorId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to approve doctor');

      setSuccessMsg(data.message);
      if (onRefreshClinic) onRefreshClinic();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Remove doctor affiliation
  const handleRemoveDoctor = async (doctorId) => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`/api/clinics/${clinic.id}/remove-doctor`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctorId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove doctor');

      setSuccessMsg('Doctor removed from clinic roster');
      if (onRefreshClinic) onRefreshClinic();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Toggle Clinic Premium
  const handleToggleClinicPremium = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/toggle-premium', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'clinic', id: clinic.id, isPremium: !clinic.isPremium })
      });
      if (res.ok) {
        setSuccessMsg(clinic.isPremium ? 'Standard Clinic Plan' : 'Upgraded to Premium Clinic Partner!');
        if (onRefreshClinic) onRefreshClinic();
      }
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* Clinic Header */}
      <div style={{ background: '#ffffff', borderRadius: '24px', padding: '24px', border: '1px solid #e2e8f0', marginBottom: '20px', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <img
              src={clinic.photo || 'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?w=300&auto=format&fit=crop&q=80'}
              alt={clinic.name}
              style={{ width: '70px', height: '70px', borderRadius: '18px', objectFit: 'cover' }}
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>{clinic.name}</h2>
                {clinic.isVerified ? (
                  <span className="badge-verified"><ShieldCheck size={12} /> Verified Clinic</span>
                ) : (
                  <span style={{ fontSize: '11px', background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '9999px', fontWeight: '700' }}>
                    Pending Verification
                  </span>
                )}
                {clinic.isPremium && (
                  <span className="badge-premium"><Sparkles size={11} /> Featured Clinic</span>
                )}
              </div>
              <p style={{ fontSize: '13px', color: '#0284c7', fontWeight: '700' }}>{clinic.type} • {clinic.sector}</p>
              <p style={{ fontSize: '12px', color: '#64748b' }}>📍 {clinic.address}, {clinic.city} • 📞 {clinic.phone}</p>
            </div>
          </div>

          <button
            onClick={handleToggleClinicPremium}
            style={{
              padding: '8px 16px',
              borderRadius: '12px',
              fontWeight: '700',
              fontSize: '12px',
              background: clinic.isPremium ? '#fef3c7' : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              color: clinic.isPremium ? '#92400e' : '#ffffff',
              border: 'none',
              boxShadow: '0 2px 6px rgba(245, 158, 11, 0.2)'
            }}
          >
            <Sparkles size={14} style={{ display: 'inline', marginRight: '4px' }} />
            {clinic.isPremium ? 'PRO Clinic Active' : 'Upgrade Clinic to PRO'}
          </button>
        </div>

        {/* Facilities Chips */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '16px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b', alignSelf: 'center', marginRight: '4px' }}>FACILITIES:</span>
          {clinic.facilities && clinic.facilities.map((fac, i) => (
            <span key={i} style={{ fontSize: '11px', background: '#f1f5f9', color: '#334155', padding: '3px 10px', borderRadius: '9999px', fontWeight: '600' }}>
              {fac}
            </span>
          ))}
        </div>
      </div>

      {errorMsg && (
        <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '12px', borderRadius: '12px', fontSize: '13px', marginBottom: '14px', border: '1px solid #fecaca' }}>
          {errorMsg}
        </div>
      )}

      {successMsg && (
        <div style={{ background: '#ecfdf5', color: '#047857', padding: '12px', borderRadius: '12px', fontSize: '13px', marginBottom: '14px', border: '1px solid #a7f3d0' }}>
          {successMsg}
        </div>
      )}

      {/* Pending Doctor Requests to Join Clinic */}
      <div style={{ background: '#ffffff', borderRadius: '20px', padding: '24px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          Pending Doctor Affiliation Requests
          <span style={{ fontSize: '12px', background: '#e0f2fe', color: '#0284c7', padding: '2px 8px', borderRadius: '9999px' }}>
            {clinic.pendingRequests?.length || 0}
          </span>
        </h3>
        <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px' }}>
          Doctors requesting to practice and consult under {clinic.name}
        </p>

        {(!clinic.pendingRequests || clinic.pendingRequests.length === 0) ? (
          <p style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>
            No pending doctor affiliation requests at this time.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {clinic.pendingRequests.map((req, i) => (
              <div key={i} style={{ padding: '14px', borderRadius: '14px', border: '1px solid #cbd5e1', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a' }}>{req.doctorName}</h4>
                  <p style={{ fontSize: '12px', color: '#0284c7' }}>{req.qualifications} • {req.specialities?.join(', ')}</p>
                  <p style={{ fontSize: '11px', color: '#64748b' }}>Requested on: {req.requestedAt}</p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => handleApproveDoctor(req.doctorId)}
                    className="btn-primary"
                    style={{ padding: '8px 14px', fontSize: '12px', borderRadius: '10px' }}
                  >
                    <CheckCircle2 size={15} /> Approve Doctor
                  </button>
                  <button
                    onClick={() => handleRemoveDoctor(req.doctorId)}
                    className="btn-secondary"
                    style={{ padding: '8px 12px', fontSize: '12px', borderRadius: '10px' }}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Current Doctors Practicing at Clinic */}
      <div style={{ background: '#ffffff', borderRadius: '20px', padding: '24px', border: '1px solid #e2e8f0' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a', marginBottom: '4px' }}>
          Roster of Doctors Under {clinic.name}
        </h3>
        <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px' }}>
          Certified practitioners registered to receive bookings at this clinic location
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {clinic.doctorIds && clinic.doctorIds.length > 0 ? (
            clinic.doctorIds.map((docId, idx) => (
              <div key={idx} style={{ padding: '12px 16px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#e0f2fe', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '800', fontSize: '12px' }}>
                    DR
                  </div>
                  <div>
                    <strong style={{ fontSize: '13px', color: '#0f172a' }}>Doctor ID: {docId}</strong>
                    <span style={{ fontSize: '11px', color: '#059669', display: 'block' }}>● Active Practicing Member</span>
                  </div>
                </div>
                <button
                  onClick={() => handleRemoveDoctor(docId)}
                  style={{ background: 'transparent', color: '#dc2626', border: '1px solid #fca5a5', padding: '4px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '700' }}
                >
                  Remove
                </button>
              </div>
            ))
          ) : (
            <p style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>
              No doctors currently affiliated with this clinic.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
