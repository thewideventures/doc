// India-time (IST, UTC+05:30) helpers — independent of the server's own timezone.
const IST_OFFSET_MS = 330 * 60 * 1000;
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const isDateStr = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(`${s}T00:00:00Z`));
export const isTimeStr = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export function todayIST(now = Date.now()) {
  return new Date(now + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(dateStr) {
  return WEEKDAYS[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
}

/** Absolute instant of an IST local date + HH:MM. */
export function istInstant(dateStr, time) {
  return new Date(Date.parse(`${dateStr}T${time}:00Z`) - IST_OFFSET_MS);
}

const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toHHMM = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Slot times ('HH:MM') a schedule offers on a date (ignores bookings). */
export function slotsForDate(schedule = {}, dateStr) {
  if (!isDateStr(dateStr)) return [];
  if ((schedule.blockedDates || []).includes(dateStr)) return [];
  const days = schedule.days?.length ? schedule.days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (!days.includes(weekdayOf(dateStr))) return [];
  if (schedule.slots?.length) return [...new Set(schedule.slots.filter(isTimeStr))].sort();
  const step = Math.min(240, Math.max(5, Number(schedule.slotMinutes) || 20));
  const out = [];
  for (const s of schedule.sessions || []) {
    if (!isTimeStr(s.start) || !isTimeStr(s.end)) continue;
    for (let m = toMin(s.start); m + step <= toMin(s.end); m += step) out.push(toHHMM(m));
  }
  return [...new Set(out)].sort();
}

/** Convert legacy '09:30 AM' style slots to 'HH:MM'. */
export function to24h(label) {
  const m = String(label || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = (m[3] || '').toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h < 24 ? `${String(h).padStart(2, '0')}:${m[2]}` : null;
}

export function validateSchedule(input = {}) {
  const days = (Array.isArray(input.days) ? input.days : []).filter(d => WEEKDAYS.includes(d));
  const sessions = (Array.isArray(input.sessions) ? input.sessions : [])
    .map(s => ({ start: String(s?.start || ''), end: String(s?.end || '') }))
    .filter(s => isTimeStr(s.start) && isTimeStr(s.end));
  for (const s of sessions) if (toMin(s.end) <= toMin(s.start)) throw Object.assign(new Error(`Session ${s.start}–${s.end}: end must be after start`), { status: 400 });
  const slotMinutes = Math.min(240, Math.max(5, parseInt(input.slotMinutes, 10) || 20));
  const slots = (Array.isArray(input.slots) ? input.slots : []).map(String).filter(isTimeStr).slice(0, 96);
  const blockedDates = (Array.isArray(input.blockedDates) ? input.blockedDates : []).filter(isDateStr).slice(0, 120);
  const advanceDays = Math.min(90, Math.max(1, parseInt(input.advanceDays, 10) || 14));
  if (!days.length) throw Object.assign(new Error('Choose at least one consultation day'), { status: 400 });
  if (!sessions.length && !slots.length) throw Object.assign(new Error('Add at least one session (start–end time)'), { status: 400 });
  return { days, sessions, slotMinutes, slots, blockedDates, advanceDays };
}
