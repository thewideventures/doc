import { DEFAULT_BAD_WORDS } from '../config/profanity.js';

const LEET = { '@': 'a', '4': 'a', '$': 's', '5': 's', '0': 'o', '1': 'i', '!': 'i', '3': 'e', '7': 't', '+': 't' };

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Lowercase, de-leet and split into tokens (letters only, any script).
function normalise(text) {
  const lower = String(text || '').toLowerCase();
  const deLeet = lower.replace(/[@4$5013!7+]/g, ch => LEET[ch] || ch);
  return deLeet;
}

function collapseRepeats(token) {
  return token.replace(/(.)\1{2,}/g, '$1$1'); // "fuuuuck" -> "fuuck"
}
function collapseAllRepeats(token) {
  return token.replace(/(.)\1+/g, '$1'); // "fuuck" -> "fuck"
}

/**
 * Build a matcher from the effective word list.
 * Returns a function(text) -> array of matched list entries.
 */
export function buildMatcher(words) {
  const singles = new Set();
  const singlesCollapsed = new Map(); // collapsed form -> original entry
  const phrases = [];
  const starred = []; // entries containing '*', e.g. f*ck

  for (const raw of words) {
    const w = String(raw || '').toLowerCase().trim();
    if (!w) continue;
    if (w.includes('*')) {
      starred.push({ entry: w, re: new RegExp(`(^|[^\\p{L}])${escapeRegex(w)}($|[^\\p{L}])`, 'u') });
      continue;
    }
    if (/\s/.test(w)) {
      const pattern = w.split(/\s+/).map(escapeRegex).join('[^\\p{L}]+');
      phrases.push({ entry: w, re: new RegExp(`(^|[^\\p{L}])${pattern}($|[^\\p{L}])`, 'u') });
    } else {
      singles.add(w);
      // Only use collapsed matching for longer words to avoid false positives.
      if (w.length >= 4) singlesCollapsed.set(collapseAllRepeats(w), w);
    }
  }

  return function match(text) {
    const found = new Set();
    const lowerRaw = String(text || '').toLowerCase();
    for (const s of starred) if (s.re.test(lowerRaw)) found.add(s.entry);

    const norm = normalise(text);
    // Join single letters separated by dots/dashes/spaces: "f.u.c.k" / "f u c k" -> "fuck"
    const joined = norm.replace(/\b(?:\p{L}[.\-_ ]){2,}\p{L}\b/gu, m => m.replace(/[.\-_ ]/g, ''));
    const tokens = joined.split(/[^\p{L}]+/u).filter(Boolean);

    for (const t of tokens) {
      if (singles.has(t)) { found.add(t); continue; }
      const c1 = collapseRepeats(t);
      if (singles.has(c1)) { found.add(c1); continue; }
      const c2 = collapseAllRepeats(t);
      if (t.length >= 4 && singlesCollapsed.has(c2)) found.add(singlesCollapsed.get(c2));
    }
    for (const p of phrases) if (p.re.test(joined)) found.add(p.entry);
    return [...found];
  };
}

let cached = { key: '', match: buildMatcher(DEFAULT_BAD_WORDS), words: DEFAULT_BAD_WORDS };

export function getEffectiveWordList(settings) {
  const disabled = new Set((settings?.disabledBadWords || []).map(w => w.toLowerCase().trim()));
  const extra = (settings?.extraBadWords || []).map(w => w.toLowerCase().trim()).filter(Boolean);
  return [...new Set([...DEFAULT_BAD_WORDS.filter(w => !disabled.has(w)), ...extra])];
}

export function getMatcher(settings) {
  const key = JSON.stringify([settings?.extraBadWords || [], settings?.disabledBadWords || []]);
  if (cached.key !== key) {
    const words = getEffectiveWordList(settings);
    cached = { key, words, match: buildMatcher(words) };
  }
  return cached.match;
}

/** Returns moderation fields to set on a review given its comment. */
export function screenReviewText(text, settings) {
  const badWordsFound = getMatcher(settings)(text);
  if (badWordsFound.length) {
    return {
      isFlagged: true,
      badWordsFound,
      flagReason: `Abusive / profane language detected (${badWordsFound.map(w => `"${w}"`).join(', ')})`,
      sentiment: 'flagged'
    };
  }
  return { isFlagged: false, badWordsFound: [], flagReason: '' };
}
