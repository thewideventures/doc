import React, { useState, useEffect } from 'react';
import {
  User, Building, Sparkles, Plus, Clock, DollarSign, CheckCircle2,
  AlertCircle, Send, Check, ShieldCheck, Award, MapPin
} from 'lucide-react';

export default function DoctorPortal({ doctor, allClinics = [], specialities = [], onRefreshDoctor }) {
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'claim' | 'clinics' | 'request-spec' | 'slots'
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Speciality Request Form
  const [customSpecName, setCustomSpecName] = useState('');
  const [customSpecCategory, setCustomSpecCategory] = useState('');
  const [customSpecDesc, setCustomSpecDesc] = useState('');

  // Clinic Request Form
  const [selectedClinicId, setSelectedClinicId] = useState('');

  // Booking toggle & fee state
  const [bookingEnabled, setBookingEnabled] = useState(doctor?.bookingEnabled ?? true);
  const [consultationFee, setConsultationFee] = useState(doctor?.consultationFee || 600);

  useEffect(() => {
    if (doctor) {
      setBookingEnabled(doctor.bookingEnabled ?? true);
      setConsultationFee(doctor.consultationFee || 600);
    }
  }, [doctor]);

  if (!doctor) {
    return (
      <div style={{ background: '#ffffff', borderRadius: '20px', padding: '32px', textAlign: 'center', border: '1px solid #e2e8f0' }}>
        <h3 style={{ fontSize: '18px', fontWeight: '800', marginBottom: '8px' }}>Doctor Portal</h3>
        <p style={{ color: '#64748b', fontSize: '14px' }}>Please log in with a doctor account or select Doctor role in header.</p>
      </div>
    );
  }

  // Doctor fee claim handler
  const handleClaimFees = async () => {
    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const res = await fetch(`/api/doctors/${doctor.id}/claim-fee`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to claim fees');

      setSuccessMsg(data.message);
      if (onRefreshDoctor) onRefreshDoctor();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Request new speciality
  const handleRequestSpeciality = async (e) => {
    e?.preventDefault();
    if (!customSpecName) return;

    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const res = await fetch('/api/specialities/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: customSpecName,
          category: customSpecCategory,
          description: customSpecDesc,
          doctorId: doctor.id,
          doctorName: doctor.name
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit request');

      setSuccessMsg(data.message);
      setCustomSpecName('');
      setCustomSpecCategory('');
      setCustomSpecDesc('');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Request affiliation under clinic
  const handleRequestClinicAffiliation = async (e) => {
    e?.preventDefault();
    if (!selectedClinicId) return;

    setErrorMsg('');
    setSuccessMsg('');
    setLoading(true);

    try {
      const res = await fetch(`/api/doctors/${doctor.id}/request-clinic`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clinicId: selectedClinicId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send clinic request');

      setSuccessMsg(data.message);
      if (onRefreshDoctor) onRefreshDoctor();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Toggle Doctor Premium
  const handleTogglePremium = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/toggle-premium', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType: 'doctor', id: doctor.id, isPremium: !doctor.isPremium })
      });
      const data = await res.json();
      if (res.ok) {
        setSuccessMsg(doctor.isPremium ? 'Standard plan active' : 'Upgraded to Doctor PRO! Unlimited locations & specialities unlocked.');
        if (onRefreshDoctor) onRefreshDoctor();
      }
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Update Doctor Fee & Slots
  const handleUpdateDoctorSettings = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const res = await fetch(`/api/doctors/${doctor.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consultationFee: parseInt(consultationFee),
          bookingEnabled
        })
      });
      if (res.ok) {
        setSuccessMsg('Doctor profile settings saved successfully!');
        if (onRefreshDoctor) onRefreshDoctor();
      }
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto' }}>
      {/* Doctor Portal Header */}
      <div style={{ background: '#ffffff', borderRadius: '24px', padding: '20px', border: '1px solid #e2e8f0', marginBottom: '20px', boxShadow: 'var(--shadow-sm)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <img
              src={doctor.photo || 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=200&auto=format&fit=crop&q=80'}
              alt={doctor.name}
              style={{ width: '64px', height: '64px', borderRadius: '16px', objectFit: 'cover' }}
            />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>{doctor.name}</h2>
                {doctor.isVerified ? (
                  <span className="badge-verified"><ShieldCheck size={12} /> Verified</span>
                ) : (
                  <span style={{ fontSize: '11px', background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '9999px', fontWeight: '700' }}>
                    Pending Admin Approval
                  </span>
                )}
                {doctor.isPremium ? (
                  <span className="badge-premium"><Sparkles size={11} /> PRO Doctor</span>
                ) : (
                  <span style={{ fontSize: '11px', background: '#f1f5f9', color: '#64748b', padding: '2px 8px', borderRadius: '9999px' }}>Standard</span>
                )}
              </div>
              <p style={{ fontSize: '13px', color: '#0284c7', fontWeight: '700' }}>{doctor.title}</p>
              <p style={{ fontSize: '12px', color: '#64748b' }}>{doctor.phone} • {doctor.sector} Sector</p>
            </div>
          </div>

          <button
            onClick={handleTogglePremium}
            style={{
              padding: '8px 14px',
              borderRadius: '12px',
              fontWeight: '700',
              fontSize: '12px',
              background: doctor.isPremium ? '#fef3c7' : 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
              color: doctor.isPremium ? '#92400e' : '#ffffff',
              border: 'none',
              boxShadow: '0 2px 6px rgba(245, 158, 11, 0.2)'
            }}
          >
            <Sparkles size={14} style={{ display: 'inline', marginRight: '4px' }} />
            {doctor.isPremium ? 'PRO Plan Active (Downgrade)' : 'Upgrade to Doctor PRO'}
          </button>
        </div>

        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: '6px', borderTop: '1px solid #f1f5f9', paddingTop: '14px', marginTop: '16px', overflowX: 'auto' }}>
          {[
            { id: 'overview', label: 'Overview & Earnings' },
            { id: 'claim', label: 'Claim Payouts' },
            { id: 'clinics', label: 'Affiliated Clinics' },
            { id: 'request-spec', label: 'Request Speciality' },
            { id: 'slots', label: 'Slots & Fees' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                padding: '8px 14px',
                borderRadius: '10px',
                fontSize: '12px',
                fontWeight: '700',
                whiteSpace: 'nowrap',
                background: activeTab === tab.id ? '#0284c7' : '#f8fafc',
                color: activeTab === tab.id ? '#ffffff' : '#64748b',
                border: activeTab === tab.id ? '1px solid #0284c7' : '1px solid #e2e8f0'
              }}
            >
              {tab.label}
            </button>
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

      {/* TAB: OVERVIEW */}
      {activeTab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          <div style={{ background: '#ffffff', borderRadius: '18px', padding: '18px', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '700' }}>PENDING SETTLEMENT</span>
            <h3 style={{ fontSize: '26px', fontWeight: '800', color: '#0284c7', margin: '6px 0' }}>
              ₹{doctor.claimPendingFee || 0}
            </h3>
            <p style={{ fontSize: '11px', color: '#64748b' }}>Earned from online patient bookings ready to claim</p>
          </div>

          <div style={{ background: '#ffffff', borderRadius: '18px', padding: '18px', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '700' }}>TOTAL WITHDRAWN</span>
            <h3 style={{ fontSize: '26px', fontWeight: '800', color: '#059669', margin: '6px 0' }}>
              ₹{doctor.claimedFee || 0}
            </h3>
            <p style={{ fontSize: '11px', color: '#64748b' }}>Directly settled to your registered bank account</p>
          </div>

          <div style={{ background: '#ffffff', borderRadius: '18px', padding: '18px', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '700' }}>LOCATIONS & SPECIALITIES</span>
            <h3 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', margin: '6px 0' }}>
              {doctor.clinics?.length || 0} Clinics • {doctor.specialities?.length || 0} Spec
            </h3>
            <p style={{ fontSize: '11px', color: doctor.isPremium ? '#059669' : '#d97706', fontWeight: '700' }}>
              {doctor.isPremium ? 'Unlimited allowed (PRO plan)' : 'Max 2 allowed on standard plan'}
            </p>
          </div>
        </div>
      )}

      {/* TAB: CLAIM PAYOUTS */}
      {activeTab === 'claim' && (
        <div style={{ background: '#ffffff', borderRadius: '20px', padding: '24px', border: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', marginBottom: '8px' }}>
            Claim Consultation Fees
          </h3>
          <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '18px' }}>
            Drs can claim fees directly inside the FindADoc platform for verified booking appointments.
          </p>

          <div style={{ background: '#f0f9ff', padding: '16px', borderRadius: '16px', border: '1px solid #bae6fd', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span style={{ fontSize: '12px', color: '#0369a1', fontWeight: '700' }}>Available to Claim Now:</span>
              <h2 style={{ fontSize: '28px', fontWeight: '800', color: '#0284c7' }}>₹{doctor.claimPendingFee || 0}</h2>
            </div>
            <button
              onClick={handleClaimFees}
              disabled={loading || (doctor.claimPendingFee || 0) <= 0}
              className="btn-primary"
              style={{ padding: '12px 20px', borderRadius: '12px', fontSize: '14px' }}
            >
              <DollarSign size={16} /> Claim Payout Now
            </button>
          </div>

          <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
            <h4 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '8px' }}>Verified Settlement Account:</h4>
            <p style={{ fontSize: '13px', color: '#475569' }}>
              Bank: <strong>HDFC Bank Ltd</strong> • A/C No: <strong>XXXX-XXXX-9821</strong> • IFSC: <strong>HDFC0001234</strong>
            </p>
            <p style={{ fontSize: '12px', color: '#059669', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckCircle2 size={14} /> Auto-transfer connected with Instant IMPS / UPI
            </p>
          </div>
        </div>
      )}

      {/* TAB: CLINICS */}
      {activeTab === 'clinics' && (
        <div style={{ background: '#ffffff', borderRadius: '20px', padding: '24px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a' }}>Clinic Affiliations</h3>
              <p style={{ fontSize: '12px', color: '#64748b' }}>
                Rule: Standard plan allows up to 2 clinics. PRO doctors enjoy unlimited locations.
              </p>
            </div>
          </div>

          {/* Current Clinics */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
            {doctor.clinics && doctor.clinics.map((c, i) => (
              <div key={i} style={{ padding: '14px', borderRadius: '14px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a' }}>{c.clinicName}</h4>
                  <p style={{ fontSize: '12px', color: '#64748b' }}>{c.address}</p>
                </div>
                <span style={{ fontSize: '11px', fontWeight: '700', color: c.isApproved ? '#059669' : '#d97706', background: c.isApproved ? '#ecfdf5' : '#fffbeb', padding: '4px 10px', borderRadius: '9999px', border: `1px solid ${c.isApproved ? '#a7f3d0' : '#fde68a'}` }}>
                  {c.isApproved ? 'Approved & Listed' : 'Pending Clinic Approval'}
                </span>
              </div>
            ))}
          </div>

          {/* Request to join new Clinic */}
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '18px' }}>
            <h4 style={{ fontSize: '15px', fontWeight: '800', color: '#0f172a', marginBottom: '10px' }}>
              Request Approval Under a New Clinic / Hospital
            </h4>
            <form onSubmit={handleRequestClinicAffiliation} style={{ display: 'flex', gap: '10px' }}>
              <select
                value={selectedClinicId}
                onChange={e => setSelectedClinicId(e.target.value)}
                style={{ flex: 1, padding: '10px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '13px' }}
                required
              >
                <option value="">Select Clinic or Hospital...</option>
                {allClinics.map(clinic => (
                  <option key={clinic.id} value={clinic.id}>
                    {clinic.name} ({clinic.city} - {clinic.sector})
                  </option>
                ))}
              </select>
              <button type="submit" disabled={loading} className="btn-primary" style={{ padding: '10px 18px', fontSize: '13px' }}>
                <Send size={15} /> Send Join Request
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB: REQUEST NON-EXISTING SPECIALITY */}
      {activeTab === 'request-spec' && (
        <div style={{ background: '#ffffff', borderRadius: '20px', padding: '24px', border: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', marginBottom: '6px' }}>
            Request New Speciality Category
          </h3>
          <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '18px' }}>
            If your medical domain is not listed in FindADoc, request it here. Backend administrators will review and add it to the platform categories.
          </p>

          <form onSubmit={handleRequestSpeciality} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '4px', display: 'block' }}>
                Speciality Name:
              </label>
              <input
                type="text"
                value={customSpecName}
                onChange={e => setCustomSpecName(e.target.value)}
                placeholder="e.g. Sleep Medicine Specialist, Trichologist, Pediatric Pulmonologist..."
                required
                style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '14px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '4px', display: 'block' }}>
                Broad Category:
              </label>
              <input
                type="text"
                value={customSpecCategory}
                onChange={e => setCustomSpecCategory(e.target.value)}
                placeholder="e.g. Pulmonology / Internal Medicine"
                style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '14px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '4px', display: 'block' }}>
                Description & Medical Focus:
              </label>
              <textarea
                rows={3}
                value={customSpecDesc}
                onChange={e => setCustomSpecDesc(e.target.value)}
                placeholder="Explain conditions treated (e.g. Obstructive Sleep Apnea, Polysomnography, CPAP management)"
                style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <button type="submit" disabled={loading} className="btn-primary" style={{ padding: '12px', alignSelf: 'flex-start' }}>
              <Send size={16} /> Submit to Backend Admin
            </button>
          </form>
        </div>
      )}

      {/* TAB: SLOTS & FEES */}
      {activeTab === 'slots' && (
        <div style={{ background: '#ffffff', borderRadius: '20px', padding: '24px', border: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', marginBottom: '16px' }}>
            Consultation Fee & Availability
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc', padding: '14px', borderRadius: '14px', border: '1px solid #e2e8f0' }}>
              <div>
                <strong style={{ fontSize: '14px', color: '#0f172a' }}>Online Booking Toggle</strong>
                <p style={{ fontSize: '12px', color: '#64748b' }}>Allow verified patients to book appointments with you</p>
              </div>
              <button
                type="button"
                onClick={() => setBookingEnabled(!bookingEnabled)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '9999px',
                  fontSize: '12px',
                  fontWeight: '700',
                  background: bookingEnabled ? '#ecfdf5' : '#f1f5f9',
                  color: bookingEnabled ? '#059669' : '#64748b',
                  border: bookingEnabled ? '1.5px solid #059669' : '1px solid #cbd5e1'
                }}
              >
                {bookingEnabled ? 'Booking Enabled' : 'Booking Paused'}
              </button>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '4px', display: 'block' }}>
                Doctor Consultation Fee (₹):
              </label>
              <input
                type="number"
                value={consultationFee}
                onChange={e => setConsultationFee(e.target.value)}
                style={{ width: '100%', maxWidth: '240px', padding: '10px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '16px', fontWeight: '700' }}
              />
              <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>
                Note: Patients will also pay a ₹49 platform booking premium upon reservation.
              </span>
            </div>

            <button
              onClick={handleUpdateDoctorSettings}
              disabled={loading}
              className="btn-primary"
              style={{ padding: '12px 20px', alignSelf: 'flex-start' }}
            >
              Save Doctor Settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
