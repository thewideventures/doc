import React from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Stethoscope, ArrowLeft } from 'lucide-react';
import { PatientAuthForm } from '../components/PatientAuthModal';
import { SESSION_EXPIRED_MSG } from '../lib/api';

/** Stand-alone patient sign-in page (/login?next=/bookings). */
export default function PatientLogin() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/bookings';
  return (
    <div className="fx-auth">
      <div className="fx-auth-card">
        <div className="fx-auth-brand"><span className="adm-brand-icon"><Stethoscope size={22} /></span><div><strong>FindADoc</strong><small>Patient sign in</small></div></div>
        <h1>Sign in</h1>
        <p className="adm-muted">Book and manage appointments for you and your family.</p>
        <PatientAuthForm notice={params.get('expired') ? SESSION_EXPIRED_MSG : ''} onSuccess={() => navigate(safeNext, { replace: true })} />
        <a href="/" className="adm-link fx-mt"><ArrowLeft size={13} /> Back to doctors</a>
      </div>
    </div>
  );
}
