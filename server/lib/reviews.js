import { Doctor, Review, PUBLIC_REVIEW_FILTER } from '../models/index.js';
import { getSettings } from './settings.js';
import { screenReviewText } from './moderation.js';

/** Recompute a doctor's public rating from public (visible/approved) reviews only. */
export async function recalcDoctorRating(doctorId) {
  const reviews = await Review.find({ doctorId, ...PUBLIC_REVIEW_FILTER }).select('rating').lean();
  const update = { reviewCount: reviews.length };
  if (reviews.length) update.rating = Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10;
  await Doctor.updateOne({ id: doctorId }, update);
}

/** Re-scan all non-deleted, non-approved reviews against the current word list (also used as backfill). */
export async function rescanReviews({ unflagCleanAutoFlags = true } = {}) {
  const settings = await getSettings({ fresh: true });
  const reviews = await Review.find({ moderationStatus: { $nin: ['deleted', 'approved'] } });
  let newlyFlagged = 0, unflagged = 0;
  const touched = new Set();
  for (const r of reviews) {
    const screen = screenReviewText(r.comment, settings);
    if (screen.isFlagged) {
      const was = r.moderationStatus;
      r.isFlagged = true;
      r.badWordsFound = screen.badWordsFound;
      r.flagReason = screen.flagReason;
      r.sentiment = 'flagged';
      r.moderationStatus = 'flagged';
      if (was !== 'flagged') { newlyFlagged++; touched.add(r.doctorId); }
      await r.save();
    } else if (r.moderationStatus === 'flagged' && unflagCleanAutoFlags && r.flagReason?.startsWith('Abusive / profane language detected')) {
      // Only auto-unflag reviews that were flagged by this word list (e.g. word removed from list)
      r.isFlagged = false; r.badWordsFound = []; r.flagReason = ''; r.moderationStatus = 'visible';
      r.sentiment = r.rating >= 4 ? 'positive' : r.rating === 3 ? 'neutral' : 'negative';
      unflagged++; touched.add(r.doctorId);
      await r.save();
    } else if (!r.moderationStatus) {
      r.moderationStatus = r.isFlagged ? 'flagged' : 'visible';
      await r.save();
    }
  }
  for (const id of touched) await recalcDoctorRating(id);
  return { scanned: reviews.length, newlyFlagged, unflagged };
}

