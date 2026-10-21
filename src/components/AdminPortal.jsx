import React, { useState, useEffect } from 'react';
import { adminFetch } from '../admin/api';
import {
  ShieldCheck, Check, X, Trash2, Ban, Sparkles, Plus, Star,
  TrendingUp, Users, DollarSign, Calendar, RefreshCw, AlertCircle,
  UserCheck, UserX
} from 'lucide-react';

export default function AdminPortal({ adminToken, onRefreshData, onExpired }) {
  const [activeTab, setActiveTab] = useState('users'); // 'users' | 'doctors' | 'clinics' | 'specialities' | 'reviews' | 'bookings'
  const [adminData, setAdminData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [msg, setMsg] = useState('');

  // Speciality direct creation
  const [newSpecName, setNewSpecName] = useState('');
  const [newSpecDesc, setNewSpecDesc] = useState('');
  const [newSpecColor, setNewSpecColor] = useState('#0284c7');

  // auth header is added by adminFetch (in-memory admin token, auto refresh)
  const getHeaders = () => ({ 'Content-Type': 'application/json' });

  // fetch wrapper: 401 -> session expired (redirects to login), errors surface in the message bar
  const call = async (url, opts) => {
    const res = await adminFetch(url, opts);
    if (res.status === 401) { onExpired?.(); throw new Error('Session expired, please log in again'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(data.error || `Request failed (${res.status})`); throw new Error(data.error || 'Request failed'); }
    return { ok: true, json: async () => data };
  };

  const fetchOverview = async () => {
    setLoading(true);
    try {
      const res = await call('/api/admin/overview', {
        headers: getHeaders()
      });
      const data = await res.json();
      if (data.success) {
        setAdminData(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  const handleVerifyDoctor = async (doctorId, currentStatus) => {
    setActionLoading(true);
    try {
      await call('/api/admin/verify-doctor', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ doctorId, verified: !currentStatus })
      });
      setMsg(`Doctor verification status updated.`);
      await fetchOverview();
      if (onRefreshData) onRefreshData();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleVerifyClinic = async (clinicId, currentStatus) => {
    setActionLoading(true);
    try {
      await call('/api/admin/verify-clinic', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ clinicId, verified: !currentStatus })
      });
      setMsg(`Clinic verification updated.`);
      await fetchOverview();
      if (onRefreshData) onRefreshData();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleTogglePremium = async (targetType, id, currentVal) => {
    setActionLoading(true);
    try {
      await call('/api/admin/toggle-premium', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ targetType, id, isPremium: !currentVal })
      });
      setMsg(`${targetType} PRO status toggled.`);
      await fetchOverview();
      if (onRefreshData) onRefreshData();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleSuspend = async (targetType, id) => {
    setActionLoading(true);
    try {
      await call('/api/admin/toggle-suspend', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ targetType, id })
      });
      setMsg(`${targetType} suspension status toggled.`);
      await fetchOverview();
      if (onRefreshData) onRefreshData();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteProfile = async (targetType, id) => {
    if (!confirm(`Are you sure you want to permanently delete this ${targetType}?`)) return;
    setActionLoading(true);
    try {
      await call('/api/admin/profile', {
        method: 'DELETE',
        headers: getHeaders(),
        body: JSON.stringify({ targetType, id })
      });
      setMsg(`${targetType} permanently deleted.`);
      await fetchOverview();
      if (onRefreshData) onRefreshData();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproveSpecialityRequest = async (requestId, action) => {
    setActionLoading(true);
    try {
      await call('/api/admin/approve-speciality-request', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ requestId, action })
      });
      setMsg(`Speciality request ${action}d successfully.`);
      await fetchOverview();
      if (onRefreshData) onRefreshData();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateSpeciality = async (e) => {
    e?.preventDefault();
    if (!newSpecName) return;

    setActionLoading(true);
    try {
      await call('/api/specialities', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          name: newSpecName,
          description: newSpecDesc,
          color: newSpecColor
        })
      });
      setMsg(`Speciality "${newSpecName}" created.`);
      setNewSpecName('');
      setNewSpecDesc('');
      await fetchOverview();
      if (onRefreshData) onRefreshData();
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !adminData) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', background: '#ffffff', borderRadius: '20px', border: '1px solid #e2e8f0' }}>
        <RefreshCw size={28} className="animate-spin" color="#7c3aed" style={{ margin: '0 auto 12px' }} />
        <p style={{ fontSize: '14px', color: '#64748b' }}>Connecting to MongoDB Administration Cluster...</p>
      </div>
    );
  }

  const { stats, users = [], doctors = [], clinics = [], bookings = [], reviews = [], specialityRequests = [] } = adminData || {};

  return (
    <div>
      {/* Overview Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '16px', border: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>TOTAL USERS / PATIENTS</span>
          <h3 style={{ fontSize: '24px', fontWeight: '800', color: '#0284c7', margin: '4px 0' }}>{stats?.totalUsers || users.length}</h3>
          <span style={{ fontSize: '11px', color: '#059669', fontWeight: '700' }}>OTP Verified Accounts</span>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '16px', border: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>TOTAL DOCTORS</span>
          <h3 style={{ fontSize: '24px', fontWeight: '800', color: '#7c3aed', margin: '4px 0' }}>{stats?.totalDoctors || 0}</h3>
          <span style={{ fontSize: '11px', color: '#059669', fontWeight: '700' }}>{stats?.verifiedDoctors || 0} Verified • {stats?.pendingDoctors || 0} Pending</span>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '16px', border: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>CLINICS & HOSPITALS</span>
          <h3 style={{ fontSize: '24px', fontWeight: '800', color: '#0d9488', margin: '4px 0' }}>{stats?.totalClinics || 0}</h3>
          <span style={{ fontSize: '11px', color: '#059669', fontWeight: '700' }}>{stats?.verifiedClinics || 0} Verified Partners</span>
        </div>

        <div style={{ background: '#ffffff', borderRadius: '16px', padding: '16px', border: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: '11px', fontWeight: '800', color: '#64748b' }}>TOTAL SETTLEMENTS</span>
          <h3 style={{ fontSize: '24px', fontWeight: '800', color: '#059669', margin: '4px 0' }}>₹{stats?.totalRevenue || 0}</h3>
          <span style={{ fontSize: '11px', color: '#0284c7', fontWeight: '700' }}>₹{stats?.platformRevenue || 0} Platform Fees</span>
        </div>
      </div>

      {msg && (
        <div style={{ background: '#ecfdf5', color: '#047857', padding: '10px 14px', borderRadius: '12px', fontSize: '13px', marginBottom: '16px', border: '1px solid #a7f3d0' }}>
          {msg}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', marginBottom: '20px', overflowX: 'auto' }}>
        {[
          { id: 'users', label: `Patients / Users (${users.length})` },
          { id: 'doctors', label: `Doctors (${doctors.length})` },
          { id: 'clinics', label: `Clinics (${clinics.length})` },
          { id: 'specialities', label: `Speciality Requests (${specialityRequests.filter(r => r.status === 'pending').length})` },
          { id: 'reviews', label: `Verified Reviews (${reviews.length})` },
          { id: 'bookings', label: `Ledger (${bookings.length})` }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '8px 16px',
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: '700',
              whiteSpace: 'nowrap',
              background: activeTab === tab.id ? '#7c3aed' : '#ffffff',
              color: activeTab === tab.id ? '#ffffff' : '#64748b',
              border: activeTab === tab.id ? '1px solid #7c3aed' : '1px solid #e2e8f0'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: USERS / PATIENTS MANAGEMENT */}
      {activeTab === 'users' && (
        <div style={{ background: '#ffffff', borderRadius: '20px', padding: '20px', border: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '14px', color: '#0f172a' }}>
            Registered Users & Patients Management (MongoDB)
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {users.map(u => (
              <div key={u.id} style={{ padding: '14px', borderRadius: '14px', border: u.isSuspended ? '1.5px solid #fca5a5' : '1px solid #e2e8f0', background: u.isSuspended ? '#fef2f2' : '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <strong style={{ fontSize: '14px', color: '#0f172a' }}>{u.name}</strong>
                    <span style={{ fontSize: '11px', textTransform: 'uppercase', padding: '2px 8px', borderRadius: '9999px', background: '#e0f2fe', color: '#0369a1', fontWeight: '800' }}>
                      {u.role}
                    </span>
                    {u.isSuspended && <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: '800' }}>● SUSPENDED</span>}
                  </div>
                  <p style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>📞 {u.phone} • Registered: {u.registeredAt}</p>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => handleToggleSuspend('user', u.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '11px',
                      fontWeight: '700',
                      border: '1px solid #fecaca',
                      background: u.isSuspended ? '#dc2626' : '#ffffff',
                      color: u.isSuspended ? '#ffffff' : '#b91c1c'
                    }}
                  >
                    {u.isSuspended ? 'Reinstate User' : 'Suspend User'}
                  </button>
                  <button
                    onClick={() => handleDeleteProfile('user', u.id)}
                    style={{ padding: '6px', background: 'transparent', color: '#94a3b8' }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: DOCTORS MANAGEMENT */}
      {activeTab === 'doctors' && (
        <div style={{ background: '#ffffff', borderRadius: '20px', padding: '20px', border: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '14px' }}>
            Doctor Profiles & Verification Approvals
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {doctors.map(doc => (
              <div key={doc.id} style={{ padding: '14px', borderRadius: '14px', border: doc.isSuspended ? '1.5px solid #fca5a5' : '1px solid #e2e8f0', background: doc.isSuspended ? '#fef2f2' : '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <img src={doc.photo} alt={doc.name} style={{ width: '48px', height: '48px', borderRadius: '12px', objectFit: 'cover' }} />
                  <div>
                    <h4 style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a' }}>
                      {doc.name} {doc.isSuspended && <span style={{ color: '#dc2626' }}>(SUSPENDED)</span>}
                    </h4>
                    <p style={{ fontSize: '12px', color: '#0284c7' }}>{doc.title} • {doc.qualifications}</p>
                    <p style={{ fontSize: '11px', color: '#64748b' }}>{doc.specialities?.join(', ')} • {doc.sector} • ₹{doc.consultationFee}</p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => handleVerifyDoctor(doc.id, doc.isVerified)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '11px',
                      fontWeight: '700',
                      border: doc.isVerified ? '1px solid #86efac' : '1.5px solid #059669',
                      background: doc.isVerified ? '#f0fdf4' : '#059669',
                      color: doc.isVerified ? '#15803d' : '#ffffff'
                    }}
                  >
                    {doc.isVerified ? '✓ Verified' : 'Approve & Verify'}
                  </button>

                  <button
                    onClick={() => handleTogglePremium('doctor', doc.id, doc.isPremium)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '8px',
                      fontSize: '11px',
                      fontWeight: '700',
                      border: '1px solid #fde68a',
                      background: doc.isPremium ? '#fef3c7' : '#ffffff',
                      color: doc.isPremium ? '#92400e' : '#64748b'
                    }}
                  >
                    <Sparkles size={12} style={{ display: 'inline', marginRight: '3px' }} />
                    {doc.isPremium ? 'PRO Active' : 'Make PRO'}
                  </button>

                  <button
                    onClick={() => handleToggleSuspend('doctor', doc.id)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '8px',
                      fontSize: '11px',
                      fontWeight: '700',
                      border: '1px solid #fecaca',
                      background: doc.isSuspended ? '#dc2626' : '#ffffff',
                      color: doc.isSuspended ? '#ffffff' : '#b91c1c'
                    }}
                  >
                    <Ban size={12} style={{ display: 'inline', marginRight: '3px' }} />
                    {doc.isSuspended ? 'Reinstate' : 'Suspend'}
                  </button>

                  <button onClick={() => handleDeleteProfile('doctor', doc.id)} style={{ padding: '6px', background: 'transparent', color: '#94a3b8' }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: CLINICS MANAGEMENT */}
      {activeTab === 'clinics' && (
        <div style={{ background: '#ffffff', borderRadius: '20px', padding: '20px', border: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '14px' }}>
            Hospitals & Clinics Directory
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {clinics.map(clinic => (
              <div key={clinic.id} style={{ padding: '14px', borderRadius: '14px', border: clinic.isSuspended ? '1.5px solid #fca5a5' : '1px solid #e2e8f0', background: clinic.isSuspended ? '#fef2f2' : '#ffffff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                  <h4 style={{ fontSize: '14px', fontWeight: '800', color: '#0f172a' }}>
                    {clinic.name} {clinic.isSuspended && <span style={{ color: '#dc2626' }}>(SUSPENDED)</span>}
                  </h4>
                  <p style={{ fontSize: '12px', color: '#0284c7' }}>{clinic.type} • {clinic.sector}</p>
                  <p style={{ fontSize: '11px', color: '#64748b' }}>📍 {clinic.address}, {clinic.city} • 📞 {clinic.phone}</p>
                </div>

                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    onClick={() => handleVerifyClinic(clinic.id, clinic.isVerified)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '11px',
                      fontWeight: '700',
                      border: clinic.isVerified ? '1px solid #86efac' : '1.5px solid #059669',
                      background: clinic.isVerified ? '#f0fdf4' : '#059669',
                      color: clinic.isVerified ? '#15803d' : '#ffffff'
                    }}
                  >
                    {clinic.isVerified ? '✓ Verified' : 'Approve & Verify'}
                  </button>

                  <button
                    onClick={() => handleTogglePremium('clinic', clinic.id, clinic.isPremium)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '8px',
                      fontSize: '11px',
                      fontWeight: '700',
                      border: '1px solid #fde68a',
                      background: clinic.isPremium ? '#fef3c7' : '#ffffff',
                      color: clinic.isPremium ? '#92400e' : '#64748b'
                    }}
                  >
                    <Sparkles size={12} style={{ display: 'inline', marginRight: '3px' }} />
                    {clinic.isPremium ? 'PRO Clinic' : 'Make PRO'}
                  </button>

                  <button
                    onClick={() => handleToggleSuspend('clinic', clinic.id)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: '8px',
                      fontSize: '11px',
                      fontWeight: '700',
                      border: '1px solid #fecaca',
                      background: clinic.isSuspended ? '#dc2626' : '#ffffff',
                      color: clinic.isSuspended ? '#ffffff' : '#b91c1c'
                    }}
                  >
                    <Ban size={12} style={{ display: 'inline', marginRight: '3px' }} />
                    {clinic.isSuspended ? 'Reinstate' : 'Suspend'}
                  </button>

                  <button onClick={() => handleDeleteProfile('clinic', clinic.id)} style={{ padding: '6px', background: 'transparent', color: '#94a3b8' }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: SPECIALITY REQUESTS */}
      {activeTab === 'specialities' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
          <div style={{ background: '#ffffff', borderRadius: '20px', padding: '20px', border: '1px solid #e2e8f0' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '6px' }}>Pending Requests from Doctors</h3>
            <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px' }}>Approve to add to platform search categories</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {specialityRequests.filter(r => r.status === 'pending').length === 0 ? (
                <p style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>No pending requests.</p>
              ) : (
                specialityRequests.filter(r => r.status === 'pending').map(req => (
                  <div key={req.id} style={{ padding: '14px', borderRadius: '14px', border: '1px solid #cbd5e1', background: '#f8fafc' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <strong style={{ fontSize: '14px', color: '#0f172a' }}>{req.name}</strong>
                      <span style={{ fontSize: '11px', color: '#0284c7', background: '#e0f2fe', padding: '2px 8px', borderRadius: '9999px' }}>{req.category}</span>
                    </div>
                    <p style={{ fontSize: '12px', color: '#475569', marginBottom: '8px' }}>{req.description}</p>
                    <p style={{ fontSize: '11px', color: '#64748b', marginBottom: '10px' }}>Requested by: <strong>{req.doctorName}</strong></p>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => handleApproveSpecialityRequest(req.id, 'approve')} className="btn-primary" style={{ padding: '6px 12px', fontSize: '11px', borderRadius: '8px' }}>
                        ✓ Approve Category
                      </button>
                      <button onClick={() => handleApproveSpecialityRequest(req.id, 'reject')} className="btn-secondary" style={{ padding: '6px 10px', fontSize: '11px', borderRadius: '8px' }}>
                        Reject
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ background: '#ffffff', borderRadius: '20px', padding: '20px', border: '1px solid #e2e8f0' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '6px' }}>Create Speciality Directly</h3>
            <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '16px' }}>Immediately adds to search filters</p>
            <form onSubmit={handleCreateSpeciality} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'block', marginBottom: '4px' }}>Speciality Title:</label>
                <input type="text" value={newSpecName} onChange={e => setNewSpecName(e.target.value)} placeholder="e.g. Immunologist" required style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '13px' }} />
              </div>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'block', marginBottom: '4px' }}>Description:</label>
                <input type="text" value={newSpecDesc} onChange={e => setNewSpecDesc(e.target.value)} placeholder="Brief clinical focus" style={{ width: '100%', padding: '10px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '13px' }} />
              </div>
              <button type="submit" disabled={actionLoading} className="btn-primary" style={{ padding: '10px 16px', fontSize: '13px', alignSelf: 'flex-start' }}>
                <Plus size={16} /> Add Speciality
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 5: REVIEWS MODERATION */}
      {activeTab === 'reviews' && (
        <div style={{ background: '#ffffff', borderRadius: '20px', padding: '20px', border: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '14px' }}>Verified Reviews Audit</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {reviews.map(rev => (
              <div key={rev.id || rev._id} style={{ padding: '14px', borderRadius: '14px', border: '1px solid #e2e8f0', background: '#f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <strong style={{ fontSize: '14px', color: '#0f172a' }}>{rev.userName}</strong>
                    {rev.isVerifiedBooking && <span className="badge-verified"><Check size={11} /> Verified Booking</span>}
                    <span style={{ fontSize: '12px', color: '#d97706', display: 'flex', alignItems: 'center', gap: '2px' }}><Star size={13} fill="#d97706" /> {rev.rating} / 5</span>
                  </div>
                  <p style={{ fontSize: '13px', color: '#334155' }}>"{rev.comment}"</p>
                  <p style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>Doctor ID: {rev.doctorId} • Date: {rev.date}</p>
                </div>
                <button onClick={() => handleDeleteProfile('review', rev.id || rev._id)} style={{ background: 'transparent', color: '#94a3b8', padding: '6px' }}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 6: BOOKINGS LEDGER */}
      {activeTab === 'bookings' && (
        <div style={{ background: '#ffffff', borderRadius: '20px', padding: '20px', border: '1px solid #e2e8f0' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '800', marginBottom: '14px' }}>Platform Financial Bookings Ledger (MongoDB)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#f1f5f9', textAlign: 'left', color: '#475569' }}>
                  <th style={{ padding: '10px 12px' }}>Token</th>
                  <th style={{ padding: '10px 12px' }}>Doctor</th>
                  <th style={{ padding: '10px 12px' }}>Patient</th>
                  <th style={{ padding: '10px 12px' }}>Date & Slot</th>
                  <th style={{ padding: '10px 12px' }}>Doctor Fee</th>
                  <th style={{ padding: '10px 12px' }}>Platform Fee</th>
                  <th style={{ padding: '10px 12px' }}>Claim Status</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px', fontWeight: '800', color: '#0284c7' }}>{b.bookingCode}</td>
                    <td style={{ padding: '10px 12px', fontWeight: '700' }}>{b.doctorName}</td>
                    <td style={{ padding: '10px 12px' }}>{b.patientName} ({b.patientPhone})</td>
                    <td style={{ padding: '10px 12px', color: '#64748b' }}>{b.date} • {b.timeSlot}</td>
                    <td style={{ padding: '10px 12px', fontWeight: '700' }}>₹{b.fee}</td>
                    <td style={{ padding: '10px 12px', color: '#059669', fontWeight: '700' }}>₹{b.bookingPremiumFee || 49}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '9999px', background: b.claimStatus === 'Claimed' ? '#ecfdf5' : '#fef3c7', color: b.claimStatus === 'Claimed' ? '#059669' : '#b45309' }}>
                        {b.claimStatus || 'Pending'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
