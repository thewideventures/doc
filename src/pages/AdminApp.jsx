import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Lock, User, AlertCircle, ArrowLeft, KeyRound, Loader2 } from 'lucide-react';
import AdminLayout from '../admin/AdminLayout';
import { setAdminSession, clearAdminSession, refreshAdmin, hasAdminHint, adminSession } from '../admin/session';

export default function AdminApp() {
  // the token itself stays in admin/session.js (memory); this only tracks the signed-in session id
  const [adminToken, setAdminToken] = useState(() => (adminSession() ? 'active' : ''));
  const [restoring, setRestoring] = useState(() => !adminSession() && hasAdminHint());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [adminUser, setAdminUser] = useState(() => adminSession()?.username || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!restoring) return;
    refreshAdmin().then(s => { if (s?.token) { setAdminToken('active'); setAdminUser(s.username); } }).finally(() => setRestoring(false));
  }, [restoring]);

  const handleAdminLogin = async (e) => {
    e?.preventDefault();
    if (!username || !password) {
      setError('Username and password are required');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, ...(needTotp ? { totp } : {}) })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'TOTP_REQUIRED' || data.code === 'TOTP_INVALID') setNeedTotp(true);
        throw new Error(data.error || 'Admin authentication failed');
      }
      const s = setAdminSession(data.adminToken, data.adminUser?.username || username);
      setAdminUser(s.username);
      setAdminToken('active');
      setPassword(''); setTotp('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const navigate = useNavigate();
  // Sign out (button) or session expiry (any final 401 from the admin API): revoke and return to /admin login.
  const handleLogout = useCallback((reason) => {
    clearAdminSession({ remote: typeof reason !== 'string' });
    setAdminToken('');
    setError(typeof reason === 'string' ? reason : '');
    navigate('/admin', { replace: true });
  }, [navigate]);

  if (restoring) {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}><Loader2 className="adm-spin" size={22} /> &nbsp;Restoring admin session…</div>;
  }

  // 1. Dedicated Admin Login Screen (Only at /admin)
  if (!adminToken) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#f8fafc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}>
        <div style={{
          width: '100%',
          maxWidth: '440px',
          background: '#ffffff',
          borderRadius: '24px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 20px 40px -10px rgba(15, 23, 42, 0.12)',
          padding: '36px 30px',
          textAlign: 'center'
        }}>
          <div style={{
            width: '60px',
            height: '60px',
            borderRadius: '18px',
            background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
            color: 'white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            boxShadow: '0 8px 18px rgba(124, 58, 237, 0.25)'
          }}>
            <ShieldCheck size={32} />
          </div>

          <h2 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', marginBottom: '4px' }}>
            Backend Administration
          </h2>
          <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '24px' }}>
            Secured internal management console. Verified against backend <code>.env</code> credentials.
          </p>

          {error && (
            <div style={{
              background: '#fef2f2',
              color: '#b91c1c',
              border: '1px solid #fecaca',
              padding: '10px 14px',
              borderRadius: '12px',
              fontSize: '12px',
              marginBottom: '18px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              textAlign: 'left'
            }}>
              <AlertCircle size={16} />
              {error}
            </div>
          )}

          <form onSubmit={handleAdminLogin} style={{ display: 'flex', flexDirection: 'column', gap: '14px', textAlign: 'left' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'block', marginBottom: '6px' }}>
                Admin Email (from .env):
              </label>
              <div style={{ position: 'relative' }}>
                <User size={16} color="#94a3b8" style={{ position: 'absolute', left: '12px', top: '14px' }} />
                <input
                  type="email"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="admin@example.com"
                  autoComplete="username"
                  required
                  style={{
                    width: '100%',
                    padding: '12px 14px 12px 38px',
                    borderRadius: '12px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px'
                  }}
                />
              </div>
            </div>

            <div>
              <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'block', marginBottom: '6px' }}>
                Admin Password (from .env):
              </label>
              <div style={{ position: 'relative' }}>
                <KeyRound size={16} color="#94a3b8" style={{ position: 'absolute', left: '12px', top: '14px' }} />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter admin password"
                  autoComplete="current-password"
                  required
                  style={{
                    width: '100%',
                    padding: '12px 14px 12px 38px',
                    borderRadius: '12px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px'
                  }}
                />
              </div>
            </div>

            {needTotp && (
              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', display: 'block', marginBottom: '6px' }}>
                  Authenticator code (2FA):
                </label>
                <input
                  value={totp}
                  onChange={e => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  data-testid="admin-totp"
                  style={{ width: '100%', padding: '12px 14px', borderRadius: '12px', border: '1px solid #cbd5e1', fontSize: '14px', letterSpacing: '4px' }}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary"
              style={{
                padding: '13px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
                boxShadow: '0 4px 12px rgba(124, 58, 237, 0.25)',
                marginTop: '4px'
              }}
            >
              {loading ? 'Authenticating...' : <><Lock size={16} /> Sign In to Admin Panel</>}
            </button>
          </form>

          <div style={{ marginTop: '20px', borderTop: '1px solid #f1f5f9', paddingTop: '16px' }}>
            <a
              href="/"
              style={{ fontSize: '12px', color: '#64748b', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              <ArrowLeft size={13} /> Return to Public Patient App
            </a>
          </div>
        </div>
      </div>
    );
  }

  // 2. Full admin panel with side navigation (sections under /admin/*)
  return <AdminLayout token={adminToken} username={adminUser || 'admin'} onLogout={handleLogout} />;
}
