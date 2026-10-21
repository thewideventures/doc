import React, { useState } from 'react';
import { X, UserPlus, Sparkles, Building, AlertCircle, CheckCircle, ShieldCheck } from 'lucide-react';

export default function DoctorRegisterModal({ isOpen, onClose, specialities = [], clinics = [], onDoctorRegistered }) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [photo, setPhoto] = useState('https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=400&auto=format&fit=crop&q=80');
  const [qualifications, setQualifications] = useState('MBBS, MD');
  const [experienceYears, setExperienceYears] = useState(8);
  const [sector, setSector] = useState('Private');
  const [selectedSpecialities, setSelectedSpecialities] = useState(['Pulmonologist']);
  const [selectedClinics, setSelectedClinics] = useState([]);
  const [consultationFee, setConsultationFee] = useState(600);
  const [phone, setPhone] = useState('+91 98450 ');
  const [email, setEmail] = useState('');
  const [bio, setBio] = useState('');
  const [isPremium, setIsPremium] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const totalSelections = selectedSpecialities.length + selectedClinics.length;
  const isOverLimit = (selectedSpecialities.length > 2 || selectedClinics.length > 2) && !isPremium;

  const toggleSpeciality = (specName) => {
    if (selectedSpecialities.includes(specName)) {
      setSelectedSpecialities(selectedSpecialities.filter(s => s !== specName));
    } else {
      if (selectedSpecialities.length >= 2 && !isPremium) {
        setError('Selecting more than 2 specialities requires Doctor PRO tier. Please upgrade or choose up to 2.');
        return;
      }
      setError('');
      setSelectedSpecialities([...selectedSpecialities, specName]);
    }
  };

  const toggleClinic = (clinic) => {
    const exists = selectedClinics.some(c => c.clinicId === clinic.id);
    if (exists) {
      setSelectedClinics(selectedClinics.filter(c => c.clinicId !== clinic.id));
    } else {
      if (selectedClinics.length >= 2 && !isPremium) {
        setError('Selecting more than 2 clinic locations requires Doctor PRO tier. Please upgrade or choose up to 2.');
        return;
      }
      setError('');
      setSelectedClinics([
        ...selectedClinics,
        { clinicId: clinic.id, clinicName: clinic.name, address: clinic.address, isApproved: false }
      ]);
    }
  };

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!name || !qualifications || !phone) {
      setError('Name, qualifications, and mobile are required');
      return;
    }

    if (isOverLimit) {
      setError('More than 2 specialities or clinics requires Doctor PRO plan.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/doctors/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          title: title || `Consultant ${selectedSpecialities[0] || 'Specialist'}`,
          photo,
          qualifications,
          experienceYears: parseInt(experienceYears),
          sector,
          specialities: selectedSpecialities,
          clinics: selectedClinics,
          consultationFee: parseInt(consultationFee),
          phone,
          email,
          bio,
          isPremium
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register doctor');

      if (onDoctorRegistered) onDoctorRegistered(data.doctor);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '620px', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#e0f2fe', color: '#0284c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <UserPlus size={22} />
            </div>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: '800' }}>Register as a Certified Doctor</h3>
              <p style={{ fontSize: '12px', color: '#64748b' }}>Profile will be sent to backend admin for verification</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: '#f1f5f9', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={18} color="#64748b" />
          </button>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '10px 14px', borderRadius: '12px', fontSize: '12px', marginBottom: '14px', border: '1px solid #fecaca', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'block', marginBottom: '4px' }}>
                Full Name (with Dr. prefix):
              </label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Dr. Rohan Kapoor"
                required
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'block', marginBottom: '4px' }}>
                Professional Title:
              </label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Senior Consultant Pulmonologist"
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'block', marginBottom: '4px' }}>
                Qualifications:
              </label>
              <input
                type="text"
                value={qualifications}
                onChange={e => setQualifications(e.target.value)}
                placeholder="MBBS, MD, FRCS"
                required
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'block', marginBottom: '4px' }}>
                Years Exp:
              </label>
              <input
                type="number"
                value={experienceYears}
                onChange={e => setExperienceYears(e.target.value)}
                min={1}
                required
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'block', marginBottom: '4px' }}>
                Sector:
              </label>
              <select
                value={sector}
                onChange={e => setSector(e.target.value)}
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              >
                <option value="Private">Private</option>
                <option value="Government">Government</option>
              </select>
            </div>
          </div>

          {/* Premium Plan Toggle Card */}
          <div style={{
            background: isPremium ? '#fffdf5' : '#f8fafc',
            border: isPremium ? '2px solid #f59e0b' : '1px solid #e2e8f0',
            padding: '12px 16px',
            borderRadius: '14px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div>
              <span style={{ fontSize: '13px', fontWeight: '800', color: isPremium ? '#92400e' : '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={16} color="#d97706" /> Doctor PRO Tier
              </span>
              <p style={{ fontSize: '11px', color: '#64748b' }}>
                Rule: Standard doctors are limited to max 2 specialities & 2 clinics. PRO unlocks unlimited.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsPremium(!isPremium)}
              style={{
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '11px',
                fontWeight: '700',
                background: isPremium ? '#f59e0b' : '#f1f5f9',
                color: isPremium ? '#ffffff' : '#475569',
                border: 'none'
              }}
            >
              {isPremium ? 'PRO Enabled' : 'Enable PRO'}
            </button>
          </div>

          {/* Multi-speciality selection */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span>Specialities (Max 2 for standard, unlimited for PRO):</span>
              <span style={{ color: selectedSpecialities.length > 2 && !isPremium ? '#dc2626' : '#0284c7' }}>
                {selectedSpecialities.length} selected
              </span>
            </label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {specialities.map(spec => {
                const isSelected = selectedSpecialities.includes(spec.name);
                return (
                  <button
                    key={spec.id || spec.name}
                    type="button"
                    onClick={() => toggleSpeciality(spec.name)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '9999px',
                      fontSize: '11px',
                      fontWeight: '700',
                      border: isSelected ? '1.5px solid #0284c7' : '1px solid #cbd5e1',
                      background: isSelected ? '#e0f2fe' : '#ffffff',
                      color: isSelected ? '#0284c7' : '#64748b'
                    }}
                  >
                    {isSelected ? '✓ ' : '+ '} {spec.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Multiple clinics affiliation selection */}
          <div>
            <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span>Working Clinics / Hospitals (Max 2 for standard, unlimited for PRO):</span>
              <span style={{ color: selectedClinics.length > 2 && !isPremium ? '#dc2626' : '#0284c7' }}>
                {selectedClinics.length} selected
              </span>
            </label>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {clinics.map(clinic => {
                const isSelected = selectedClinics.some(c => c.clinicId === clinic.id);
                return (
                  <button
                    key={clinic.id}
                    type="button"
                    onClick={() => toggleClinic(clinic)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '9999px',
                      fontSize: '11px',
                      fontWeight: '700',
                      border: isSelected ? '1.5px solid #059669' : '1px solid #cbd5e1',
                      background: isSelected ? '#ecfdf5' : '#ffffff',
                      color: isSelected ? '#059669' : '#64748b'
                    }}
                  >
                    {isSelected ? '✓ ' : '+ '} {clinic.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'block', marginBottom: '4px' }}>
                Consultation Fee (₹):
              </label>
              <input
                type="number"
                value={consultationFee}
                onChange={e => setConsultationFee(e.target.value)}
                required
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'block', marginBottom: '4px' }}>
                Mobile Number (for OTP):
              </label>
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                required
                style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'block', marginBottom: '4px' }}>
              Biography & Medical Expertise:
            </label>
            <textarea
              rows={2}
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="Summary of experience, clinical interests, fellowships..."
              style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1px solid #cbd5e1', fontSize: '13px' }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary"
            style={{ width: '100%', padding: '12px', marginTop: '6px' }}
          >
            {loading ? 'Submitting...' : 'Register Profile for Admin Verification'}
          </button>
        </form>
      </div>
    </div>
  );
}
