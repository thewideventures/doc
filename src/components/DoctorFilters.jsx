import React, { useEffect, useState } from 'react';
import { Search, Sparkles, LocateFixed, Loader2, SlidersHorizontal, X, MapPin } from 'lucide-react';

const SORTS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'distance', label: 'Nearest first' },
  { value: 'rating', label: 'Top rated' },
  { value: 'experience', label: 'Most experienced' },
  { value: 'fee_low', label: 'Fee: low to high' },
  { value: 'fee_high', label: 'Fee: high to low' }
];
const RADII = [{ value: '', label: 'Any distance' }, { value: '3', label: 'Within 3 km' }, { value: '5', label: 'Within 5 km' }, { value: '10', label: 'Within 10 km' }, { value: '25', label: 'Within 25 km' }, { value: '50', label: 'Within 50 km' }];

/**
 * Search bar (with the AI sparkle button inside its right edge) + near-me + filters.
 * filters: { search, speciality, sector, minExp, minRating, sortBy, maxKm, mode, kind, gender, language }
 */
export default function DoctorFilters({ specialities = [], filters, onChange, onReset, userLocation, onLocate, locating, onOpenAi }) {
  const [draft, setDraft] = useState(filters.search || '');
  const [open, setOpen] = useState(false);
  useEffect(() => { setDraft(filters.search || ''); }, [filters.search]);
  useEffect(() => {
    const t = setTimeout(() => { if (draft !== (filters.search || '')) onChange({ search: draft }); }, 350);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeCount = ['sector', 'minExp', 'minRating', 'mode', 'kind', 'gender', 'language'].filter(k => filters[k] && filters[k] !== 'all').length;
  const sel = (key, label, options) => (
    <label className="adm-filter"><span>{label}</span>
      <select className="adm-select" value={filters[key] || ''} onChange={e => onChange({ [key]: e.target.value })}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </label>
  );

  return (
    <section className="fx-search-wrap" aria-label="Search doctors">
      <div className="fx-searchbar">
        <Search size={18} className="fx-search-icon" aria-hidden="true" />
        <input type="search" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Search doctor, speciality, clinic, area or PIN" aria-label="Search doctors" enterKeyHint="search" />
        {draft && <button type="button" className="fx-search-clear" onClick={() => setDraft('')} aria-label="Clear search"><X size={15} /></button>}
        <button type="button" className="fx-ai-btn" onClick={onOpenAi} aria-label="Ask AI: describe your symptoms" title="Describe symptoms — AI suggests the right specialist" data-testid="ai-search-button">
          <Sparkles size={17} /><span>AI</span>
        </button>
      </div>

      <div className="fx-filter-row">
        <button type="button" className={`fx-pill ${userLocation ? 'on' : ''}`} onClick={onLocate} disabled={locating} aria-pressed={Boolean(userLocation)}>
          {locating ? <Loader2 size={14} className="adm-spin" /> : <LocateFixed size={14} />} {userLocation ? 'Near me' : 'Use my location'}
        </button>
        {userLocation && (
          <select className="fx-pill-select" value={filters.maxKm || ''} onChange={e => onChange({ maxKm: e.target.value, sortBy: e.target.value ? 'distance' : filters.sortBy })} aria-label="Distance">
            {RADII.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        )}
        <select className="fx-pill-select" value={filters.speciality || 'all'} onChange={e => onChange({ speciality: e.target.value })} aria-label="Speciality">
          <option value="all">All specialities</option>
          {specialities.map(s => <option key={s.id || s.name} value={s.name}>{s.name}</option>)}
        </select>
        <select className="fx-pill-select" value={filters.sortBy || 'recommended'} onChange={e => onChange({ sortBy: e.target.value })} aria-label="Sort by">
          {SORTS.filter(s => s.value !== 'distance' || userLocation).map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button type="button" className={`fx-pill ${activeCount ? 'on' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <SlidersHorizontal size={14} /> Filters{activeCount ? ` (${activeCount})` : ''}
        </button>
      </div>

      {open && (
        <div className="fx-filter-panel">
          <div className="adm-filters">
            {sel('kind', 'Consultation', [{ value: '', label: 'Any' }, { value: 'clinic', label: 'At a clinic' }, { value: 'own_clinic', label: "Doctor's own clinic" }, { value: 'hospital', label: 'Hospital' }, { value: 'home_visit', label: 'Home visit' }, { value: 'online', label: 'Online' }])}
            {sel('mode', 'Booking', [{ value: '', label: 'Any' }, { value: 'free', label: 'Free booking' }, { value: 'token', label: 'Booking amount' }, { value: 'paid', label: 'Prepaid' }])}
            {sel('sector', 'Sector', [{ value: 'all', label: 'Any' }, { value: 'Private', label: 'Private' }, { value: 'Government', label: 'Government' }])}
            {sel('minExp', 'Experience', [{ value: '', label: 'Any' }, { value: '5', label: '5+ years' }, { value: '10', label: '10+ years' }, { value: '20', label: '20+ years' }])}
            {sel('minRating', 'Rating', [{ value: '', label: 'Any' }, { value: '4', label: '4★ & up' }, { value: '4.5', label: '4.5★ & up' }])}
            {sel('gender', 'Doctor gender', [{ value: '', label: 'Any' }, { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' }])}
            {sel('language', 'Language', [{ value: '', label: 'Any' }, ...['English', 'Malayalam', 'Hindi', 'Tamil', 'Kannada', 'Telugu'].map(l => ({ value: l, label: l }))])}
            <button type="button" className="adm-btn btn-secondary adm-btn-sm" onClick={() => { onReset(); setOpen(false); }}>Reset</button>
          </div>
        </div>
      )}
      {userLocation && <p className="fx-near-note"><MapPin size={12} /> Showing distance from your location{filters.maxKm ? ` • within ${filters.maxKm} km` : ''}</p>}
    </section>
  );
}
