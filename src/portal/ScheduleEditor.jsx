import React from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { WEEKDAYS } from '../lib/api';

export const DEFAULT_SCHEDULE = { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], sessions: [{ start: '09:30', end: '13:00' }, { start: '17:00', end: '20:00' }], slotMinutes: 20, advanceDays: 14, blockedDates: [] };

const slotCount = s => (s.sessions || []).reduce((n, x) => {
  const [a, b] = [x.start, x.end].map(t => (/^\d{2}:\d{2}$/.test(t || '') ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : NaN));
  return n + (b > a ? Math.floor((b - a) / (Number(s.slotMinutes) || 20)) : 0);
}, 0);

/** Weekly schedule: days, sessions (start–end), slot length, booking window and blocked dates (leave). */
export default function ScheduleEditor({ value, onChange }) {
  const s = { ...DEFAULT_SCHEDULE, ...(value || {}) };
  const set = patch => onChange({ ...s, ...patch });
  const toggleDay = d => set({ days: s.days.includes(d) ? s.days.filter(x => x !== d) : WEEKDAYS.filter(x => x === d || s.days.includes(x)) });
  const setSession = (i, k, v) => set({ sessions: s.sessions.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const [blocked, setBlocked] = React.useState('');
  return (
    <div className="fx-schedule">
      <div className="fx-label">Consultation days</div>
      <div className="fx-days" role="group" aria-label="Consultation days">
        {WEEKDAYS.map(d => <button key={d} type="button" className={`fx-day ${s.days.includes(d) ? 'on' : ''}`} aria-pressed={s.days.includes(d)} onClick={() => toggleDay(d)}>{d}</button>)}
      </div>
      <div className="fx-label">Sessions</div>
      {s.sessions.map((x, i) => (
        <div key={i} className="fx-row fx-session">
          <input type="time" className="adm-select" value={x.start} onChange={e => setSession(i, 'start', e.target.value)} aria-label="Session start" />
          <span>to</span>
          <input type="time" className="adm-select" value={x.end} onChange={e => setSession(i, 'end', e.target.value)} aria-label="Session end" />
          {s.sessions.length > 1 && <button type="button" className="adm-icon-btn" onClick={() => set({ sessions: s.sessions.filter((_, j) => j !== i) })} aria-label="Remove session"><Trash2 size={15} /></button>}
        </div>
      ))}
      {s.sessions.length < 4 && <button type="button" className="adm-link" onClick={() => set({ sessions: [...s.sessions, { start: '18:00', end: '20:00' }] })}><Plus size={14} /> Add session</button>}
      <div className="fx-grid fx-grid-3" style={{ marginTop: 10 }}>
        <label className="adm-field"><span>Slot length</span>
          <select value={s.slotMinutes} onChange={e => set({ slotMinutes: Number(e.target.value) })}>{[10, 15, 20, 30, 45, 60].map(m => <option key={m} value={m}>{m} minutes</option>)}</select>
        </label>
        <label className="adm-field"><span>Bookings open for</span>
          <select value={s.advanceDays} onChange={e => set({ advanceDays: Number(e.target.value) })}>{[3, 7, 14, 30, 60].map(m => <option key={m} value={m}>next {m} days</option>)}</select>
        </label>
        <label className="adm-field"><span>Leave / blocked date</span>
          <span className="fx-row">
            <input type="date" value={blocked} onChange={e => setBlocked(e.target.value)} />
            <button type="button" className="btn-secondary adm-btn adm-btn-sm" disabled={!blocked} onClick={() => { set({ blockedDates: [...new Set([...(s.blockedDates || []), blocked])].sort() }); setBlocked(''); }}>Add</button>
          </span>
        </label>
      </div>
      {(s.blockedDates || []).length > 0 && (
        <div className="fx-chips">{s.blockedDates.map(d => <button type="button" key={d} className="fx-chip" onClick={() => set({ blockedDates: s.blockedDates.filter(x => x !== d) })} title="Remove">{d} ✕</button>)}</div>
      )}
      <small className="adm-muted">{slotCount(s)} slots per day on {s.days.length} day{s.days.length === 1 ? '' : 's'} a week.</small>
    </div>
  );
}
