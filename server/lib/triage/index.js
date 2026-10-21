// Rule-based symptom triage. NOT a diagnosis: it screens for red flags first (emergency => 108 / 112),
// asks short follow-up questions, then suggests a speciality. Pure functions (unit-testable, no DB).
import { RED_FLAGS, GROUPS, SPECIALITY_KEYWORDS } from './dictionary.js';

export const EMERGENCY_NUMBERS = [
  { id: 'ambulance', number: '108', label: 'Ambulance' },
  { id: 'emergency', number: '112', label: 'National emergency' }
];
export const MENTAL_HEALTH_HELPLINE = { id: 'telemanas', number: '14416', label: 'Tele-MANAS (24x7 mental health)' };

export const QUESTION_IDS = ['warning', 'duration', 'severity', 'age', 'sex', 'pregnancy', 'conditions'];
export const DURATIONS = ['lt1d', '1to3d', '4to7d', '1to4w', 'gt1m'];
export const CONDITIONS = ['diabetes', 'hypertension', 'heart_disease', 'asthma_copd', 'kidney', 'immunocompromised', 'none'];

const LATIN = /^[\x00-\x7f]+$/;
export function normalise(s) { return String(s || '').normalize('NFC').toLowerCase().replace(/[\u200b-\u200d]/g, '').replace(/[.,;:!?()"'`]/g, ' ').replace(/\s+/g, ' ').trim().replace(/(^| )mein(?= |$)/g, '$1me'); } // Hinglish 'mein' == 'me'

function hit(text, compact, kw) {
  const k = normalise(kw);
  if (!k) return false;
  if (LATIN.test(k)) {
    if (k.length <= 4) return new RegExp(`(^|[^a-z0-9])${k.replace(/[-]/g, '\\-')}([^a-z0-9]|$)`).test(text);
    const idx = text.indexOf(k);
    if (idx >= 0) {
      // English negation right before the phrase ("no chest pain") — anything else is treated as present
      const before = text.slice(Math.max(0, idx - 9), idx);
      if (/(^|\s)(no|not|without|denies|never)\s$/.test(before)) return false;
      return true;
    }
    return k.length >= 6 && compact.includes(k.replace(/\s+/g, ''));
  }
  return text.includes(k) || compact.includes(k.replace(/\s+/g, ''));
}
export function matches(text, list) {
  const t = normalise(text);
  const c = t.replace(/\s+/g, '');
  return list.filter(k => hit(t, c, k));
}

/** Red flags from the free text, the warning checklist answer and rule combinations. */
export function detectRedFlags(text, answers = {}) {
  const found = new Map();
  for (const [id, def] of Object.entries(RED_FLAGS)) {
    const m = matches(text, def.kw);
    if (m.length) found.set(id, { id, label: def.label, matched: m.slice(0, 3) });
  }
  for (const id of Array.isArray(answers.warning) ? answers.warning : []) {
    if (RED_FLAGS[id] && !found.has(id)) found.set(id, { id, label: RED_FLAGS[id].label, matched: ['checklist'] });
  }
  const fever = matches(text, GROUPS.fever).length > 0;
  const highFever = matches(text, GROUPS.high_fever).length > 0;
  const infantWords = matches(text, GROUPS.infant).length > 0;
  const ageMonths = answers.age != null ? Number(answers.age) * 12 + (Number(answers.ageMonths) || 0) : null;
  // High fever in infants: any fever under 3 months; high fever / severity >= 7 under 12 months
  if (fever && ((ageMonths !== null && ageMonths < 3) || ((ageMonths !== null ? ageMonths < 12 : infantWords) && (highFever || Number(answers.severity) >= 7)))) {
    found.set('infant_fever', { id: 'infant_fever', label: 'High fever in an infant', matched: ['age'] });
  }
  // Pregnancy with bleeding / severe abdominal pain / severe headache
  if (answers.pregnancy === 'yes' && (matches(text, GROUPS.bleeding).length || matches(text, GROUPS.abdominal_pain).length || matches(text, GROUPS.severe_headache).length)) {
    found.set('pregnancy_warning', { id: 'pregnancy_warning', label: 'Bleeding, severe pain or headache in pregnancy', matched: ['pregnancy'] });
  }
  return [...found.values()];
}

/** Which follow-up questions still need an answer. */
export function pendingQuestions(answers = {}) {
  const q = [];
  if (answers.warning === undefined) q.push('warning');
  if (!answers.duration) q.push('duration');
  if (answers.severity === undefined || answers.severity === null) q.push('severity');
  if (answers.age === undefined || answers.age === null) q.push('age');
  if (!answers.sex) q.push('sex');
  const age = Number(answers.age);
  if (answers.sex === 'female' && (!Number.isFinite(age) || (age >= 12 && age <= 55)) && !answers.pregnancy) q.push('pregnancy');
  if (!answers.conditions) q.push('conditions');
  return q;
}

/** Speciality scoring: DB keywords + built-in multilingual dictionary. */
export function scoreSpecialities(text, specialities) {
  const t = normalise(text);
  const c = t.replace(/\s+/g, '');
  return specialities.map(spec => {
    const kws = [...new Set([...(spec.keywords || []), ...(SPECIALITY_KEYWORDS[spec.id] || [])])];
    const matched = kws.filter(k => hit(t, c, k));
    let score = matched.length * 10;
    if (spec.name && t.includes(spec.name.toLowerCase())) { score += 20; matched.push(spec.name); }
    return { spec, score, matched };
  }).sort((a, b) => b.score - a.score);
}

/** Urgency from answers (red flags handled separately). */
export function urgencyFor(text, answers = {}) {
  const sev = Number(answers.severity);
  const age = Number(answers.age);
  const conditions = Array.isArray(answers.conditions) ? answers.conditions.filter(x => x !== 'none') : [];
  const fever = matches(text, GROUPS.fever).length > 0;
  const breathing = matches(text, GROUPS.breathing_mild).length > 0;
  const reasons = [];
  if (sev >= 8) reasons.push('severity');
  if (matches(text, GROUPS.high_fever).length) reasons.push('high_fever');
  if ((age >= 65 || (Number.isFinite(age) && age < 5)) && (fever || breathing)) reasons.push('age_risk');
  if (conditions.length && (fever || breathing || sev >= 6)) reasons.push('conditions');
  if (answers.pregnancy === 'yes') reasons.push('pregnancy');
  if (reasons.length) return { level: 'priority', reasons };
  if (answers.duration === 'gt1m' || answers.duration === '1to4w') return { level: 'routine', reasons: ['long_duration'] };
  return { level: 'routine', reasons: [] };
}

/** Prefer paediatrics for children and gynaecology for pregnancy when nothing more specific matched. */
export function adjustSpeciality(scored, answers = {}) {
  const top = scored[0];
  const age = Number(answers.age);
  const byId = id => scored.find(s => s.spec.id === id);
  if (Number.isFinite(age) && age < 14 && byId('pediatrics') && (!top || top.score <= 10 || top.spec.id === 'general_physician')) return byId('pediatrics');
  if (answers.pregnancy === 'yes' && byId('gynecology') && (!top || top.score <= 10 || top.spec.id === 'general_physician')) return byId('gynecology');
  return top && top.score > 0 ? top : null;
}
