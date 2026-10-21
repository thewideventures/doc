import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Stethoscope, ArrowLeft, Loader2 } from 'lucide-react';
import { ToastProvider } from '../admin/ui';
import { apiFetch, getSession } from '../lib/api';
import { DoctorProfileView } from '../components/DoctorDetailModal';
import BookingModal from '../components/BookingModal';
import PatientAuthModal from '../components/PatientAuthModal';
import ReviewModal from '../components/ReviewModal';

function setMeta(name, content, attr = 'name') {
  let el = document.head.querySelector(`meta[${attr}="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute(attr, name); document.head.appendChild(el); }
  el.setAttribute('content', content);
}

/** Public, shareable doctor page (/doctors/:slug) with title, description, canonical and schema.org JSON-LD. */
export default function DoctorProfilePage() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [booking, setBooking] = useState(null);
  const [auth, setAuth] = useState(false);
  const [review, setReview] = useState(null);

  useEffect(() => {
    setData(null); setError('');
    apiFetch(`/api/doctors/${encodeURIComponent(slug)}`).then(setData).catch(e => setError(e.status === 404 ? 'This doctor profile is not available.' : e.message));
  }, [slug]);

  useEffect(() => {
    if (!data) return undefined;
    const d = data.doctor;
    const prevTitle = document.title;
    const city = d.city || d.locations?.find(l => l.address?.city)?.address.city || '';
    const spec = (d.specialities || []).slice(0, 2).join(', ');
    document.title = `${d.name} — ${spec}${city ? ` in ${city}` : ''} | Book on FindADoc`;
    const desc = `${d.name}, ${d.qualifications}. ${d.experienceYears || 0} years experience. ${spec}${city ? ` in ${city}` : ''}. Rated ${Number(d.rating || 0).toFixed(1)}/5. Book an appointment online.`;
    setMeta('description', desc);
    setMeta('og:title', document.title, 'property'); setMeta('og:description', desc, 'property'); setMeta('og:image', d.photo, 'property'); setMeta('og:type', 'profile', 'property');
    let canon = document.head.querySelector('link[rel="canonical"]');
    if (!canon) { canon = document.createElement('link'); canon.rel = 'canonical'; document.head.appendChild(canon); }
    canon.href = `${window.location.origin}/doctors/${d.slug}`;
    const ld = document.createElement('script');
    ld.type = 'application/ld+json'; ld.id = 'fad-doctor-ld';
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Physician', name: d.name, image: d.photo, medicalSpecialty: d.specialities,
      description: d.bio || desc, url: canon.href, priceRange: '₹',
      ...(d.reviewCount ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: Number(d.rating || 0).toFixed(1), reviewCount: d.reviewCount } } : {}),
      address: (d.locations || []).filter(l => l.address).slice(0, 3).map(l => ({ '@type': 'PostalAddress', streetAddress: l.address.line, addressLocality: l.address.city, addressRegion: l.address.state, postalCode: l.address.pincode, addressCountry: 'IN' }))
    }).replace(/</g, '\\u003c');
    document.getElementById('fad-doctor-ld')?.remove();
    document.head.appendChild(ld);
    return () => { document.title = prevTitle; ld.remove(); };
  }, [data]);

  return (
    <ToastProvider>
      <div className="fx-public-page">
        <header className="fx-public-head">
          <Link to="/" className="fx-row"><span className="fx-logo fx-logo-sm"><Stethoscope size={18} /></span><span className="fx-logo-text">FindA<span>Doc</span></span></Link>
          <Link to="/" className="adm-link"><ArrowLeft size={13} /> All doctors</Link>
        </header>
        <main className="fx-public-main">
          {error && <div className="adm-alert adm-alert-error">{error}</div>}
          {!data && !error && <div className="fx-center"><Loader2 className="adm-spin" /></div>}
          {data && (
            <div className="adm-card">
              <DoctorProfileView doctor={data.doctor} reviews={data.reviews} onBook={(d, locationId) => setBooking({ doctor: d, locationId })} onReview={d => (getSession('patient') ? setReview(d) : setAuth(true))} />
              {data.doctor.bookingEnabled && <button className="btn-primary adm-btn fx-mt fx-grow" style={{ width: '100%' }} onClick={() => setBooking({ doctor: data.doctor })}>Book appointment</button>}
            </div>
          )}
        </main>
        <BookingModal doctor={booking?.doctor} initialLocationId={booking?.locationId} isOpen={Boolean(booking)} onClose={() => setBooking(null)} onRequireLogin={() => setAuth(true)} onSessionExpired={() => setAuth(true)} />
        <PatientAuthModal isOpen={auth} onClose={() => setAuth(false)} onSuccess={() => setAuth(false)} />
        <ReviewModal doctor={review} isOpen={Boolean(review)} onClose={() => setReview(null)} onTriggerOtpLogin={() => setAuth(true)} />
      </div>
    </ToastProvider>
  );
}
