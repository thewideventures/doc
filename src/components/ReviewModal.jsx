import React, { useState } from 'react';
import { X, Star, CheckCircle, MessageSquare } from 'lucide-react';
import { createClient, getSession } from '../lib/api';

export default function ReviewModal({ doctor, user, isOpen, onClose, onReviewSubmitted, onTriggerOtpLogin }) {
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen || !doctor) return null;

  const handleSubmit = async (e) => {
    e?.preventDefault();
    if (!comment || !comment.trim()) {
      setError('Please write your review feedback');
      return;
    }

    if (!getSession('patient')) {
      onTriggerOtpLogin();
      return;
    }

    setError('');
    setLoading(true);

    try {
      const data = await createClient('patient').post('/reviews', { doctorId: doctor.id, rating, comment: comment.trim() });

      if (onReviewSubmitted) onReviewSubmitted(data.review, data.message);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '38px', height: '38px', borderRadius: '12px', background: '#fef3c7', color: '#d97706', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Star size={20} fill="#d97706" />
            </div>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: '800' }}>Review {doctor.name}</h3>
              <p style={{ fontSize: '12px', color: '#64748b' }}>Help other patients with verified feedback</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: '#f1f5f9', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={18} color="#64748b" />
          </button>
        </div>

        {error && (
          <div style={{ background: '#fef2f2', color: '#b91c1c', padding: '10px 14px', borderRadius: '12px', fontSize: '12px', marginBottom: '14px', border: '1px solid #fecaca' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Star selector */}
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <span style={{ fontSize: '12px', color: '#64748b', display: 'block', marginBottom: '8px', fontWeight: '600' }}>
              Select Overall Rating:
            </span>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setRating(star)}
                  style={{ background: 'transparent', padding: '4px' }}
                >
                  <Star
                    size={32}
                    color="#d97706"
                    fill={star <= rating ? '#f59e0b' : 'none'}
                    style={{ transition: 'transform 0.15s ease' }}
                  />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={{ fontSize: '12px', fontWeight: '700', color: '#334155', marginBottom: '4px', display: 'block' }}>
              Your Detailed Experience:
            </label>
            <textarea
              rows={4}
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="e.g. Dr. Ramesh diagnosed my allergic asthma immediately. Clear prescription, polite and punctual..."
              required
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '14px',
                border: '1px solid #cbd5e1',
                fontSize: '13px',
                lineHeight: '1.5'
              }}
            />
          </div>

          <p style={{ fontSize: '11px', color: '#64748b' }}>
            🔒 If you booked this doctor through FindADoc, your review will automatically feature the <strong>Verified Booking Badge</strong>.
          </p>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary"
            style={{ width: '100%', padding: '12px' }}
          >
            {loading ? 'Submitting...' : 'Post Verified Review'}
          </button>
        </form>
      </div>
    </div>
  );
}
