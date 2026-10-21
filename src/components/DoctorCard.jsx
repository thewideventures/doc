import React from 'react';
import { Star, MapPin, BadgeCheck, Crown, Navigation, Video, Home, Briefcase, Languages } from 'lucide-react';
import { inr } from '../lib/api';
import { ModeBadge } from './BookingModal';

const km = d => (d === null || d === undefined ? '' : d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(d < 10 ? 1 : 0)} km`);

export default function DoctorCard({ doctor, onSelectDoctor, onBookDoctor }) {
  const locs = doctor.locations || [];
  const nearest = locs.find(l => l.id === doctor.nearestLocationId) || locs.find(l => l.kind !== 'online') || locs[0];
  const hasOnline = locs.some(l => l.kind === 'online');
  const hasHome = locs.some(l => l.kind === 'home_visit');
  const featured = doctor.plan?.featured || doctor.plan?.code === 'premium';
  return (
    <article className={`doc-card fx-doc-card ${doctor.isPremium ? 'premium-highlight' : ''}`}>
      <button className="fx-doc-card-main" onClick={() => onSelectDoctor(doctor)} aria-label={`View ${doctor.name}`}>
        <img src={doctor.photo} alt="" loading="lazy" className="fx-doc-photo" />
        <div className="fx-doc-info">
          <div className="fx-row fx-wrap" style={{ gap: 6 }}>
            <h3>{doctor.name}</h3>
            {doctor.plan?.verifiedBadge && <BadgeCheck size={16} className="fx-verified" aria-label="Verified" />}
            {featured && <span className="badge-premium"><Crown size={10} /> Featured</span>}
          </div>
          <p className="fx-doc-spec">{(doctor.specialities || []).slice(0, 2).join(' • ')}</p>
          <p className="fx-doc-meta">{doctor.qualifications}</p>
          <p className="fx-doc-meta"><Briefcase size={12} /> {doctor.experienceYears || 0} yrs • <Star size={12} className="fx-star" /> {Number(doctor.rating || 0).toFixed(1)} ({doctor.reviewCount || 0})</p>
          {doctor.languages?.length > 0 && <p className="fx-doc-meta"><Languages size={12} /> {doctor.languages.slice(0, 3).join(', ')}</p>}
        </div>
      </button>
      {nearest && (
        <div className="fx-doc-loc">
          <MapPin size={13} />
          <span>{nearest.kind === 'online' ? 'Online consultation' : `${nearest.name}${nearest.address?.area || nearest.address?.city ? `, ${nearest.address.area || nearest.address.city}` : ''}`}</span>
          {doctor.distance !== null && doctor.distance !== undefined && <strong>{km(doctor.distance)}</strong>}
        </div>
      )}
      <div className="fx-row fx-wrap fx-doc-badges">
        {(doctor.bookingModes || []).map(m => <ModeBadge key={m} mode={m} />)}
        {hasOnline && <span className="adm-badge adm-badge-purple"><Video size={11} /> Online</span>}
        {hasHome && <span className="adm-badge adm-badge-slate"><Home size={11} /> Home visit</span>}
        {locs.length > 1 && <span className="adm-small adm-muted">{locs.length} locations</span>}
      </div>
      <div className="fx-doc-foot">
        <div><small className="adm-muted">Fee from</small><strong>{inr(doctor.consultationFee)}</strong></div>
        <div className="fx-row">
          {nearest?.directionsUrl && <a className="btn-secondary adm-btn adm-btn-sm" href={nearest.directionsUrl} target="_blank" rel="noopener noreferrer" aria-label="Get directions"><Navigation size={14} /></a>}
          <button className="btn-primary adm-btn adm-btn-sm" disabled={!doctor.bookingEnabled} onClick={() => onBookDoctor(doctor)}>{doctor.bookingEnabled ? 'Book' : 'Not bookable'}</button>
        </div>
      </div>
    </article>
  );
}
