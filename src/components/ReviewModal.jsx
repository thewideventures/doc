import React, { useEffect, useState } from 'react';
import { X, Star, BadgeCheck } from 'lucide-react';
import { createClient, getSession, fmtDate } from '../lib/api';
import { useT } from '../i18n';

/**
 * Review for ONE completed booking (server enforces: own booking, Completed, one review per booking).
 * doctor = { id, name, bookingId, date }
 */
export default function ReviewModal({ doctor, isOpen, onClose, onReviewSubmitted, onTriggerOtpLogin }) {
  const t = useT();
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (isOpen) { setRating(5); setComment(''); setError(''); } }, [isOpen, doctor?.bookingId]);

  if (!isOpen || !doctor) return null;

  const handleSubmit = async e => {
    e?.preventDefault();
    if (!comment.trim()) { setError(t('review.writeSomething')); return; }
    if (!getSession('patient')) { onTriggerOtpLogin?.(); return; }
    setError(''); setLoading(true);
    try {
      const data = await createClient('patient').post('/reviews', { doctorId: doctor.id, bookingId: doctor.bookingId, rating, comment: comment.trim() });
      onReviewSubmitted?.(data.review, data.moderated ? t('review.moderated') : t('review.published'));
      onClose();
    } catch (err) { setError(err.message); } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content fx-review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title" onClick={e => e.stopPropagation()}>
        <div className="fx-row fx-between" style={{ marginBottom: 14 }}>
          <div className="fx-row">
            <span className="fx-review-icon"><Star size={20} fill="#d97706" /></span>
            <div>
              <h3 id="review-title">{t('review.title', { name: doctor.name })}</h3>
              {doctor.date && <p className="adm-small adm-muted">{t('review.visitOn', { date: fmtDate(doctor.date) })}</p>}
            </div>
          </div>
          <button className="adm-icon-btn" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
        </div>
        {!doctor.bookingId ? (
          <p className="fx-note fx-note-info">{t('doc.reviewPolicy')}</p>
        ) : (
          <form onSubmit={handleSubmit} className="adm-form">
            {error && <div className="adm-alert adm-alert-error" role="alert">{error}</div>}
            <div className="fx-stars" role="radiogroup" aria-label={t('review.rating')}>
              {[1, 2, 3, 4, 5].map(star => (
                <button key={star} type="button" role="radio" aria-checked={rating === star} aria-label={t('review.stars', { n: star })} onClick={() => setRating(star)}>
                  <Star size={32} color="#d97706" fill={star <= rating ? '#f59e0b' : 'none'} />
                </button>
              ))}
            </div>
            <label className="adm-field"><span>{t('review.experience')}</span>
              <textarea rows={4} value={comment} maxLength={1000} onChange={e => setComment(e.target.value)} placeholder={t('review.placeholder')} required data-testid="review-text" />
            </label>
            <p className="adm-small adm-muted"><BadgeCheck size={12} /> {t('review.verifiedNote')}</p>
            <button type="submit" disabled={loading} className="btn-primary adm-btn" data-testid="review-submit">{loading ? t('common.saving') : t('review.submit')}</button>
          </form>
        )}
      </div>
    </div>
  );
}
