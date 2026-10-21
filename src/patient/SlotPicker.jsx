import React, { useEffect, useState } from 'react';
import { Calendar, Clock, Loader2 } from 'lucide-react';
import { fmtTime } from '../lib/api';
import { useI18n } from '../i18n';

/** Date strip + slot grid. loadSlots(date) -> Promise<{ slots: [{ time, available }] }> */
export default function SlotPicker({ dates = [], loadSlots, value, onChange, exclude }) {
  const { t, meta } = useI18n();
  const [date, setDate] = useState(dates[0] || '');
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!date && dates[0]) setDate(dates[0]); }, [dates]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!date) return;
    let live = true;
    setLoading(true); setError(''); onChange?.(null);
    loadSlots(date).then(r => { if (live) setSlots(r.slots || []); }).catch(e => live && setError(e.message)).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [date]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = slots.filter(s => !(exclude && exclude.date === date && exclude.time === s.time));
  return (
    <div>
      <h4 className="fx-label"><Calendar size={14} /> {t('book.chooseDate')}</h4>
      {dates.length === 0 ? <p className="adm-muted">{t('book.noAvailability')}</p> : (
        <div className="fx-date-strip">
          {dates.map(d => {
            const dt = new Date(`${d}T00:00:00+05:30`);
            return (
              <button key={d} type="button" className={`fx-date ${d === date ? 'on' : ''}`} onClick={() => setDate(d)} aria-pressed={d === date}>
                <small>{dt.toLocaleDateString(meta.locale, { weekday: 'short', timeZone: 'Asia/Kolkata' })}</small>
                <strong>{dt.toLocaleDateString(meta.locale, { day: '2-digit', timeZone: 'Asia/Kolkata' })}</strong>
                <small>{dt.toLocaleDateString(meta.locale, { month: 'short', timeZone: 'Asia/Kolkata' })}</small>
              </button>
            );
          })}
        </div>
      )}
      <h4 className="fx-label"><Clock size={14} /> {t('book.chooseTime')}</h4>
      {error && <p className="adm-small adm-text-danger">{error}</p>}
      {loading ? <div className="fx-center"><Loader2 className="adm-spin" size={16} /> {t('book.checkingSlots')}</div> : (
        shown.filter(s => s.available).length === 0 ? <p className="adm-muted">{t('book.allBooked')}</p> : (
          <div className="fx-slots">
            {shown.map(s => (
              <button key={s.time} type="button" disabled={!s.available} className={`fx-slot ${value?.date === date && value?.time === s.time ? 'on' : ''}`} onClick={() => onChange?.({ date, time: s.time })}>{fmtTime(s.time)}</button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

/** Next n IST dates as YYYY-MM-DD (fallback when the API does not supply a date list). */
export function nextDates(n = 14) {
  const out = [];
  const base = Date.now() + 330 * 60000;
  for (let i = 0; i < n; i++) out.push(new Date(base + i * 86400000).toISOString().slice(0, 10));
  return out;
}
