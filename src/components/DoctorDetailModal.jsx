import React, { useEffect, useState } from 'react';
import { X, Star, BadgeCheck, Navigation, Briefcase, GraduationCap, Languages, MapPin, Clock, Share2, Loader2, MessageSquarePlus, ShieldCheck, Phone } from 'lucide-react';
import { apiFetch, inr, fmtTime } from '../lib/api';
import { ModeBadge, KIND_ICON } from './BookingModal';
import { RegistrationBadge } from './DoctorCard';
import { useT } from '../i18n';

/** Business numbers are masked in public data; the full number is fetched only when the user taps Call. */
function CallButton({ doctorId, locationId, masked }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const call = async () => {
    setBusy(true); setErr('');
    try {
      const r = await apiFetch(`/doctors/${encodeURIComponent(doctorId)}/locations/${encodeURIComponent(locationId)}/contact`);
      if (/^\+?\d{10,13}$/.test(r.phone || '')) window.location.href = `tel:${r.phone}`;
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return <button type="button" className="btn-secondary adm-btn adm-btn-sm" onClick={call} disabled={busy} title={err || masked}><Phone size={14} /> {busy ? t('doc.calling') : t('doc.call')}</button>;
}

const km = d => (d === null || d === undefined ? '' : d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`);
const sessionsText = s => (s?.sessions || []).map(x => `${fmtTime(x.start)}–${fmtTime(x.end)}`).join(', ');

/** Full doctor profile (used in the modal and on the SEO page /doctors/:slug). */
export function DoctorProfileView({ doctor, reviews = [], onBook, onReview, compact }) {
  const t = useT();
  const share = async () => {
    const url = `${window.location.origin}/doctors/${doctor.slug}`;
    try { if (navigator.share) await navigator.share({ title: doctor.name, url }); else { await navigator.clipboard.writeText(url); alert(t('doc.linkCopied')); } } catch { /* cancelled */ }
  };
  return (
    <div className="fx-profile">
      <header className="fx-profile-head">
        <img src={doctor.photo} alt={doctor.name} />
        <div>
          <h2>{doctor.name} {doctor.plan?.verifiedBadge && <BadgeCheck size={18} className="fx-verified" aria-label={t('doc.verified')} />}</h2>
          <p className="fx-doc-spec">{doctor.title || (doctor.specialities || []).join(', ')}</p>
          <p className="fx-doc-meta"><GraduationCap size={13} /> {doctor.qualifications}</p>
          <p className="fx-doc-meta"><Briefcase size={13} /> {t('doc.yearsExp', { n: doctor.experienceYears || 0 })} • <Star size={13} className="fx-star" /> {Number(doctor.rating || 0).toFixed(1)} ({t('doc.reviewsCount', { n: doctor.reviewCount || 0 })})</p>
          {doctor.languages?.length > 0 && <p className="fx-doc-meta"><Languages size={13} /> {doctor.languages.join(', ')}</p>}
          {doctor.registrationNumber && <p className="fx-doc-meta"><ShieldCheck size={13} /> {t('doc.regNo')} {doctor.registrationNumber}{doctor.councilName ? ` • ${doctor.councilName}` : ''}</p>}
          <RegistrationBadge doctor={doctor} full />
        </div>
        <button className="adm-icon-btn" onClick={share} aria-label={t('doc.share')}><Share2 size={17} /></button>
      </header>
      <div className="fx-chips">{(doctor.specialities || []).map(s => <span key={s} className="fx-chip">{s}</span>)}</div>
      {doctor.bio && <section><h4 className="fx-label">{t('doc.about')}</h4><p className="fx-about">{doctor.bio}</p></section>}

      <section>
        <h4 className="fx-label"><MapPin size={14} /> {t('doc.whereConsult')}</h4>
        {(doctor.locations || []).length === 0 && <p className="adm-muted adm-small">{t('doc.noLocations')}</p>}
        <div className="fx-loc-grid">
          {(doctor.locations || []).map(l => {
            const I = KIND_ICON[l.kind] || MapPin;
            const q = l.quote;
            return (
              <div key={l.id} className="fx-loc-card">
                <div className="fx-loc-card-head"><span className="fx-loc-icon"><I size={18} /></span><div><strong>{l.name}</strong><small>{t(`kind.${l.kind}`)}{l.distance ? ` • ${km(l.distance)}` : ''}</small></div></div>
                <p className="adm-small">{l.addressText}</p>
                <p className="adm-small adm-muted"><Clock size={12} /> {(l.schedule?.days || []).join(', ')} • {sessionsText(l.schedule)}</p>
                {l.notes && <p className="adm-small adm-muted">{l.notes}</p>}
                <div className="fx-row fx-wrap"><ModeBadge mode={q?.mode || l.bookingMode} tokenAmount={q?.tokenAmount ?? l.tokenAmount} /><span className="adm-small">{t('doc.fee')} <strong>{inr(l.fee)}</strong></span>{q?.payNow > 0 && <span className="adm-small adm-muted">{t('doc.payOnline', { amount: inr(q.payNow) })}</span>}</div>
                <div className="fx-row fx-mt">
                  {l.directionsUrl && <a className="btn-secondary adm-btn adm-btn-sm" href={l.directionsUrl} target="_blank" rel="noopener noreferrer"><Navigation size={14} /> {t('common.directions')}</a>}
                  {(l.hasPhone || l.phone) && <CallButton doctorId={doctor.id} locationId={l.id} masked={l.phone} />}
                  {onBook && doctor.bookingEnabled && <button className="btn-primary adm-btn adm-btn-sm" onClick={() => onBook(doctor, l.id)} data-testid="book-location">{t('doc.bookHere')}</button>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <div className="fx-row fx-between"><h4 className="fx-label">{t('doc.reviews')}</h4>{onReview && <button className="adm-link" onClick={() => onReview(doctor)}><MessageSquarePlus size={14} /> {t('doc.howToReview')}</button>}</div>
        <p className="adm-small adm-muted">{t('doc.reviewPolicy')}</p>
        {reviews.length === 0 ? <p className="adm-muted adm-small">{t('doc.noReviews')}</p> : (
          <ul className="fx-reviews">
            {reviews.slice(0, compact ? 5 : 20).map(r => (
              <li key={r.id}>
                <div className="fx-row fx-between"><strong>{r.userName}</strong><span className="adm-small">{'★'.repeat(r.rating)}<span className="adm-muted">{'★'.repeat(5 - r.rating)}</span></span></div>
                {r.verifiedVisit && <small className="fx-verified-visit" data-testid="verified-visit"><BadgeCheck size={11} /> {t('doc.verifiedVisit')}</small>}
                <p>{r.comment}</p>
                <small className="adm-muted">{r.date}</small>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function DoctorDetailModal({ doctor, isOpen, onClose, onBookDoctor, onReview, userLocation }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!isOpen || !doctor) return undefined;
    setData(null); setError('');
    const q = userLocation ? `?userLat=${userLocation.lat}&userLng=${userLocation.lng}` : '';
    apiFetch(`/api/doctors/${encodeURIComponent(doctor.id)}${q}`).then(setData).catch(e => setError(e.message));
    const h = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [isOpen, doctor?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!isOpen || !doctor) return null;
  return (
    <div className="fx-overlay" onClick={onClose}>
      <div className="fx-sheet fx-sheet-lg" role="dialog" aria-modal="true" aria-label={doctor.name} onClick={e => e.stopPropagation()}>
        <div className="fx-sheet-head"><h3>{t('doc.profile')}</h3><button className="adm-icon-btn" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button></div>
        <div className="fx-sheet-body">
          {error && <div className="adm-alert adm-alert-error">{error}</div>}
          {!data && !error ? <div className="fx-center"><Loader2 className="adm-spin" /></div> : data && (
            <DoctorProfileView doctor={data.doctor} reviews={data.reviews} compact onBook={(d, locId) => onBookDoctor(d, locId)} onReview={onReview} />
          )}
        </div>
        {data?.doctor?.bookingEnabled && (
          <div className="adm-modal-foot"><button className="btn-primary adm-btn fx-grow" onClick={() => onBookDoctor(data.doctor)}>{t('doc.bookAppointment')}</button></div>
        )}
      </div>
    </div>
  );
}
