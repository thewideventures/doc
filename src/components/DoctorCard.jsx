import React from 'react';
import { Star, MapPin, BadgeCheck, Crown, Navigation, Video, Home, Briefcase, Languages, ShieldCheck } from 'lucide-react';
import { inr } from '../lib/api';
import { ModeBadge } from './BookingModal';
import { useT } from '../i18n';

/** NMC/State council registration verified by admin (shows council + number). */
export function RegistrationBadge({ doctor, full = false }) {
  const t = useT();
  if (!doctor?.registrationVerified) return null;
  return (
    <span className="fx-reg-badge" title={`${doctor.councilName || ''} ${doctor.registrationNumber || ''}`.trim()} data-testid="reg-badge">
      <ShieldCheck size={12} /> {t('doc.regVerified')}{full && doctor.registrationNumber ? ` • ${doctor.councilName ? `${doctor.councilName} ` : ''}${t('doc.regNo')} ${doctor.registrationNumber}` : ''}
    </span>
  );
}

const km = d => (d === null || d === undefined ? '' : d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(d < 10 ? 1 : 0)} km`);

export default function DoctorCard({ doctor, onSelectDoctor, onBookDoctor }) {
  const t = useT();
  const locs = doctor.locations || [];
  const nearest = locs.find(l => l.id === doctor.nearestLocationId) || locs.find(l => l.kind !== 'online') || locs[0];
  const hasOnline = locs.some(l => l.kind === 'online');
  const hasHome = locs.some(l => l.kind === 'home_visit');
  const featured = doctor.plan?.featured || doctor.plan?.code === 'premium';
  return (
    <article className={`doc-card fx-doc-card ${doctor.isPremium ? 'premium-highlight' : ''}`}>
      <button className="fx-doc-card-main" onClick={() => onSelectDoctor(doctor)} aria-label={t('doc.view', { name: doctor.name })}>
        <img src={doctor.photo} alt="" loading="lazy" className="fx-doc-photo" />
        <div className="fx-doc-info">
          <div className="fx-row fx-wrap" style={{ gap: 6 }}>
            <h3>{doctor.name}</h3>
            {doctor.plan?.verifiedBadge && <BadgeCheck size={16} className="fx-verified" aria-label={t('doc.verified')} />}
            {featured && <span className="badge-premium"><Crown size={10} /> {t('doc.featured')}</span>}
          </div>
          <div className="fx-row fx-wrap" style={{ gap: 6 }}>
            <RegistrationBadge doctor={doctor} />
          </div>
          <p className="fx-doc-spec">{(doctor.specialities || []).slice(0, 2).join(' • ')}</p>
          <p className="fx-doc-meta">{doctor.qualifications}</p>
          <p className="fx-doc-meta"><Briefcase size={12} /> {t('doc.years', { n: doctor.experienceYears || 0 })} • <Star size={12} className="fx-star" /> {Number(doctor.rating || 0).toFixed(1)} ({doctor.reviewCount || 0})</p>
          {doctor.languages?.length > 0 && <p className="fx-doc-meta"><Languages size={12} /> {doctor.languages.slice(0, 3).join(', ')}</p>}
        </div>
      </button>
      {nearest && (
        <div className="fx-doc-loc">
          <MapPin size={13} />
          <span>{nearest.kind === 'online' ? t('doc.onlineConsult') : `${nearest.name}${nearest.address?.area || nearest.address?.city ? `, ${nearest.address.area || nearest.address.city}` : ''}`}</span>
          {doctor.distance !== null && doctor.distance !== undefined && <strong>{km(doctor.distance)}</strong>}
        </div>
      )}
      <div className="fx-row fx-wrap fx-doc-badges">
        {(doctor.bookingModes || []).map(m => <ModeBadge key={m} mode={m} />)}
        {hasOnline && <span className="adm-badge adm-badge-purple"><Video size={11} /> {t('doc.online')}</span>}
        {hasHome && <span className="adm-badge adm-badge-slate"><Home size={11} /> {t('kind.home_visit')}</span>}
        {locs.length > 1 && <span className="adm-small adm-muted">{t('doc.locations', { n: locs.length })}</span>}
      </div>
      <div className="fx-doc-foot">
        <div><small className="adm-muted">{t('doc.feeFrom')}</small><strong>{inr(doctor.consultationFee)}</strong></div>
        <div className="fx-row">
          {nearest?.directionsUrl && <a className="btn-secondary adm-btn adm-btn-sm" href={nearest.directionsUrl} target="_blank" rel="noopener noreferrer" aria-label={t('common.directions')}><Navigation size={14} /></a>}
          <button className="btn-primary adm-btn adm-btn-sm" disabled={!doctor.bookingEnabled} onClick={() => onBookDoctor(doctor)}>{doctor.bookingEnabled ? t('doc.book') : t('doc.notBookable')}</button>
        </div>
      </div>
    </article>
  );
}
