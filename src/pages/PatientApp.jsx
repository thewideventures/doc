import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Stethoscope, Building2, Calendar, UserRound, Sparkles, KeyRound, MapPin, Navigation, X, Loader2, UserCheck } from 'lucide-react';
import { ToastProvider, useToast } from '../admin/ui';
import Sidebar from '../components/Sidebar';
import DoctorFilters from '../components/DoctorFilters';
import DoctorCard from '../components/DoctorCard';
import DoctorDetailModal from '../components/DoctorDetailModal';
import BookingModal from '../components/BookingModal';
import ReviewModal from '../components/ReviewModal';
import PatientAuthModal from '../components/PatientAuthModal';
import AiSearchModal from '../components/AiSearchModal';
import InstallBanner from '../components/InstallBanner';
import PatientProfile from '../patient/PatientProfile';
import PatientBookings from '../patient/PatientBookings';
import { apiFetch, createClient, getSession, clearSession, toQuery, SESSION_EXPIRED_MSG } from '../lib/api';

const VIEW_BY_PATH = { '/': 'find-doctors', '/find': 'find-doctors', '/clinics': 'clinics', '/bookings': 'my-bookings', '/profile': 'profile' };
const PATH_BY_VIEW = { 'find-doctors': '/', clinics: '/clinics', 'my-bookings': '/bookings', profile: '/profile' };
const TITLES = { 'find-doctors': 'Find doctors', clinics: 'Hospitals & clinics', 'my-bookings': 'My appointments', profile: 'My profile' };
const DEFAULT_FILTERS = { search: '', speciality: 'all', sector: 'all', minExp: '', minRating: '', sortBy: 'recommended', maxKm: '', mode: '', kind: '', gender: '', language: '' };

function Patient() {
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const view = VIEW_BY_PATH[location.pathname] || 'find-doctors';
  const go = v => navigate(PATH_BY_VIEW[v] || '/');

  const [session, setSessionState] = useState(() => getSession('patient'));
  const [user, setUser] = useState(() => getSession('patient')?.user || null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authNotice, setAuthNotice] = useState('');
  const onExpired = useCallback(msg => { setSessionState(null); setUser(null); setAuthNotice(msg || SESSION_EXPIRED_MSG); setAuthOpen(true); }, []);
  const client = useMemo(() => createClient('patient', { onExpired, onBlocked: m => { setSessionState(null); setUser(null); toast.error(m); } }), [onExpired, toast]);

  const [specialities, setSpecialities] = useState([]);
  const [clinics, setClinics] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState(() => ({ ...DEFAULT_FILTERS, speciality: params.get('speciality') || 'all', search: params.get('q') || '' }));
  const clinicId = params.get('clinic') || '';
  const [userLocation, setUserLocation] = useState(() => { try { return JSON.parse(sessionStorage.getItem('fad_user_loc') || 'null'); } catch { return null; } });
  const [locating, setLocating] = useState(false);

  const [aiOpen, setAiOpen] = useState(false);
  const [detailDoctor, setDetailDoctor] = useState(null);
  const [booking, setBooking] = useState(null); // { doctor, locationId }
  const [reviewDoctor, setReviewDoctor] = useState(null);

  useEffect(() => {
    apiFetch('/api/specialities').then(r => setSpecialities(r.specialities)).catch(() => {});
  }, []);
  useEffect(() => {
    if (view !== 'clinics') return;
    apiFetch(`/api/clinics${toQuery(userLocation ? { userLat: userLocation.lat, userLng: userLocation.lng } : {})}`).then(r => setClinics(r.clinics)).catch(e => setError(e.message));
  }, [view, userLocation]);

  useEffect(() => {
    if (view !== 'find-doctors') return undefined;
    const ctrl = new AbortController();
    setLoading(true);
    const q = { ...filters, clinicId, includeOnline: filters.maxKm ? 'true' : undefined, ...(userLocation ? { userLat: userLocation.lat, userLng: userLocation.lng } : {}) };
    apiFetch(`/api/doctors${toQuery(q)}`, { signal: ctrl.signal })
      .then(r => { setDoctors(r.doctors); setError(''); })
      .catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [view, filters, clinicId, userLocation]);

  const updateFilters = patch => setFilters(f => ({ ...f, ...patch }));
  const locate = () => {
    if (!navigator.geolocation) { toast.error('Location is not available on this device'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(pos => {
      const loc = { lat: Math.round(pos.coords.latitude * 1e5) / 1e5, lng: Math.round(pos.coords.longitude * 1e5) / 1e5 };
      setUserLocation(loc); sessionStorage.setItem('fad_user_loc', JSON.stringify(loc));
      setLocating(false); updateFilters({ sortBy: 'distance' });
    }, () => {
      setLocating(false);
      if (user?.lat) { const loc = { lat: user.lat, lng: user.lng }; setUserLocation(loc); updateFilters({ sortBy: 'distance' }); toast.info('Using your saved home location'); }
      else toast.error('Location permission denied. Allow location access or save your address in your profile.');
    }, { timeout: 10000, maximumAge: 300000 });
  };

  const requireLogin = () => { setAuthNotice(''); setAuthOpen(true); };
  const logout = () => { clearSession('patient'); setSessionState(null); setUser(null); if (['my-bookings', 'profile'].includes(view)) go('find-doctors'); };
  const openBooking = (doctor, locationId) => { setDetailDoctor(null); setBooking({ doctor, locationId }); };

  const clinicName = clinicId && (clinics.find(c => c.id === clinicId)?.name || doctors.find(d => d.clinics?.some(c => c.clinicId === clinicId))?.clinics.find(c => c.clinicId === clinicId)?.clinicName);

  const signInPrompt = (what) => (
    <div className="fx-empty">
      <KeyRound size={34} />
      <h3>Sign in to see {what}</h3>
      <p className="adm-muted">Use your mobile number — no password needed.</p>
      <button className="btn-primary adm-btn" onClick={requireLogin}>Sign in with mobile</button>
    </div>
  );

  let content;
  if (view === 'my-bookings') content = session ? <PatientBookings client={client} onFindDoctors={() => go('find-doctors')} onReview={d => setReviewDoctor(d)} /> : signInPrompt('your appointments');
  else if (view === 'profile') content = session ? <PatientProfile client={client} onUserChange={u => setUser(u)} /> : signInPrompt('your profile');
  else if (view === 'clinics') {
    content = (
      <div className="doctors-grid">
        {clinics.length === 0 && <p className="adm-muted">Loading clinics…</p>}
        {clinics.map(c => (
          <article key={c.id} className={`doc-card fx-clinic-card ${c.isPremium ? 'premium-highlight' : ''}`}>
            {c.photo ? <img src={c.photo} alt="" loading="lazy" className="fx-clinic-logo" /> : <div className="fx-clinic-logo fx-clinic-ph"><Building2 size={28} /></div>}
            <div className="fx-row fx-wrap" style={{ gap: 6 }}><h3>{c.name}</h3>{c.plan?.verifiedBadge && <span className="badge-verified">Verified</span>}</div>
            <p className="fx-doc-spec">{c.type} • {c.sector}</p>
            <p className="fx-doc-meta"><MapPin size={12} /> {c.address}{c.distance != null ? ` • ${c.distance.toFixed(1)} km` : ''}</p>
            {c.facilities?.length > 0 && <div className="fx-chips">{c.facilities.slice(0, 5).map(f => <span key={f} className="fx-chip">{f}</span>)}</div>}
            <div className="fx-doc-foot">
              <span className="adm-small"><strong>{c.doctorIds?.length || 0}</strong> doctors</span>
              <div className="fx-row">
                {c.directionsUrl && <a className="btn-secondary adm-btn adm-btn-sm" href={c.directionsUrl} target="_blank" rel="noopener noreferrer" aria-label="Directions"><Navigation size={14} /></a>}
                <button className="btn-primary adm-btn adm-btn-sm" onClick={() => navigate(`/?clinic=${c.id}`)}>View doctors</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  } else {
    content = (
      <>
        <DoctorFilters specialities={specialities} filters={filters} onChange={updateFilters} onReset={() => setFilters({ ...DEFAULT_FILTERS })} userLocation={userLocation} onLocate={locate} locating={locating} onOpenAi={() => setAiOpen(true)} />
        {clinicId && <div className="fx-filter-chip">Doctors at <strong>{clinicName || 'selected clinic'}</strong><button onClick={() => setParams(p => { const n = new URLSearchParams(p); n.delete('clinic'); return n; })} aria-label="Clear clinic filter"><X size={14} /></button></div>}
        <div className="fx-results-head" id="doctor-results">
          <h2>{filters.speciality !== 'all' ? filters.speciality : 'Doctors'} <span>({doctors.length})</span></h2>
        </div>
        {error && <div className="adm-alert adm-alert-error">{error}</div>}
        {loading && !doctors.length ? <div className="fx-center"><Loader2 className="adm-spin" /> Finding doctors…</div> : doctors.length === 0 ? (
          <div className="fx-empty">
            <Stethoscope size={36} />
            <h3>No matching doctors</h3>
            <p className="adm-muted">Try another speciality, a wider distance, or describe your symptoms to the AI.</p>
            <div className="fx-row fx-center-row"><button className="btn-secondary adm-btn" onClick={() => setFilters({ ...DEFAULT_FILTERS })}>Reset filters</button><button className="btn-primary adm-btn" onClick={() => setAiOpen(true)}><Sparkles size={14} /> Ask AI</button></div>
          </div>
        ) : (
          <div className="doctors-grid" style={{ opacity: loading ? 0.6 : 1 }}>
            {doctors.map(d => <DoctorCard key={d.id} doctor={d} onSelectDoctor={setDetailDoctor} onBookDoctor={doc => openBooking(doc)} />)}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="app-container">
      <Sidebar currentView={view} onSelectView={go} currentUser={session ? user : null} onOpenLogin={requireLogin} onOpenAi={() => setAiOpen(true)} onLogout={logout} />
      <div className="workspace-wrapper">
        <InstallBanner />
        <div className="mobile-top-bar">
          <div className="fx-row"><div className="fx-logo fx-logo-sm"><Stethoscope size={18} /></div><span className="fx-logo-text">FindA<span>Doc</span></span></div>
          {session ? <button className="badge-verified" onClick={() => go('profile')}><UserCheck size={11} /> {(user?.name && user.name !== 'Patient User' ? user.name : 'Profile').split(' ')[0]}</button>
            : <button onClick={requireLogin} className="btn-primary adm-btn adm-btn-sm"><KeyRound size={13} /> Sign in</button>}
        </div>
        <div className="desktop-topbar">
          <strong>{TITLES[view]}</strong>
          <div className="fx-row">
            <a href="/doctor" className="adm-link">For doctors</a>
            <a href="/clinic" className="adm-link">For clinics</a>
            {session ? <button className="badge-verified" onClick={() => go('profile')}><UserCheck size={13} /> {user?.name && user.name !== 'Patient User' ? user.name : user?.phone}</button>
              : <button onClick={requireLogin} className="btn-primary adm-btn adm-btn-sm"><KeyRound size={14} /> Sign in</button>}
          </div>
        </div>
        <main className="workspace-content">
          {view !== 'find-doctors' && <h1 className="fx-page-title">{TITLES[view]}</h1>}
          {content}
        </main>
        <nav className="mobile-bottom-nav" aria-label="Main">
          <button onClick={() => go('find-doctors')} className={`nav-tab-btn ${view === 'find-doctors' ? 'active' : ''}`}><Stethoscope size={20} /><span>Doctors</span></button>
          <button onClick={() => setAiOpen(true)} className="nav-tab-btn"><Sparkles size={20} /><span>AI search</span></button>
          <button onClick={() => go('clinics')} className={`nav-tab-btn ${view === 'clinics' ? 'active' : ''}`}><Building2 size={20} /><span>Clinics</span></button>
          <button onClick={() => go('my-bookings')} className={`nav-tab-btn ${view === 'my-bookings' ? 'active' : ''}`}><Calendar size={20} /><span>Bookings</span></button>
          <button onClick={() => go('profile')} className={`nav-tab-btn ${view === 'profile' ? 'active' : ''}`}><UserRound size={20} /><span>Profile</span></button>
        </nav>
      </div>

      <AiSearchModal open={aiOpen} onClose={() => setAiOpen(false)} userLocation={userLocation}
        onSelectSpeciality={s => { setAiOpen(false); if (view !== 'find-doctors') go('find-doctors'); updateFilters({ speciality: s, search: '' }); setTimeout(() => document.getElementById('doctor-results')?.scrollIntoView({ behavior: 'smooth' }), 300); }}
        onOpenDoctor={d => { setAiOpen(false); setDetailDoctor(d); }} />
      <PatientAuthModal isOpen={authOpen} notice={authNotice} onClose={() => setAuthOpen(false)} onSuccess={u => { setSessionState(getSession('patient')); setUser(u); setAuthNotice(''); toast.success('Signed in'); }} />
      <DoctorDetailModal doctor={detailDoctor} isOpen={Boolean(detailDoctor)} onClose={() => setDetailDoctor(null)} onBookDoctor={openBooking} onReview={d => setReviewDoctor(d)} userLocation={userLocation} />
      <BookingModal doctor={booking?.doctor} initialLocationId={booking?.locationId} isOpen={Boolean(booking)} onClose={() => setBooking(null)} onRequireLogin={requireLogin} onSessionExpired={onExpired} onBooked={() => {}} />
      <ReviewModal doctor={reviewDoctor} isOpen={Boolean(reviewDoctor)} onClose={() => setReviewDoctor(null)} onTriggerOtpLogin={requireLogin} onReviewSubmitted={(r, m) => { if (m) toast.success(m); }} />
    </div>
  );
}

export default function PatientApp() {
  return <ToastProvider><Patient /></ToastProvider>;
}
