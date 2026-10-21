import React, { useEffect, useState } from 'react';
import { Search, Sparkles, LocateFixed, Loader2, SlidersHorizontal, X, MapPin, CalendarCheck, Video } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useT } from '../i18n';

const SORTS = ['recommended', 'distance', 'rating', 'experience', 'fee_low', 'fee_high'];
const RADII = ['', '3', '5', '10', '25', '50'];
const LANG_OPTIONS = ['English', 'Malayalam', 'Hindi', 'Tamil', 'Kannada', 'Telugu'];
const FEE_RANGES = [{ v: '', min: '', max: '' }, { v: '0-300', min: '0', max: '300' }, { v: '300-500', min: '300', max: '500' }, { v: '500-1000', min: '500', max: '1000' }, { v: '1000-', min: '1000', max: '' }];
export const FILTER_KEYS = ['sector', 'minExp', 'minRating', 'mode', 'kind', 'gender', 'language', 'insurer', 'minFee', 'maxFee'];

/**
 * Search bar (AI sparkle button inside), near-me, quick toggles (available today, video) and the filter panel.
 * filters: { search, speciality, sector, minExp, minRating, sortBy, maxKm, mode, kind, gender, language,
 *            availableToday, video, minFee, maxFee, insurer }
 */
export default function DoctorFilters({ specialities = [], filters, onChange, onReset, userLocation, onLocate, locating, onOpenAi }) {
  const t = useT();
  const [draft, setDraft] = useState(filters.search || '');
  const [open, setOpen] = useState(false);
  const [insurers, setInsurers] = useState([]);
  useEffect(() => { setDraft(filters.search || ''); }, [filters.search]);
  useEffect(() => {
    const id = setTimeout(() => { if (draft !== (filters.search || '')) onChange({ search: draft }); }, 350);
    return () => clearTimeout(id);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !insurers.length) apiFetch('/api/insurers').then(r => setInsurers(r.insurers || [])).catch(() => {}); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeCount = FILTER_KEYS.filter(k => k !== 'maxFee' && filters[k] && filters[k] !== 'all').length + (!filters.minFee && filters.maxFee ? 1 : 0);
  const feeValue = FEE_RANGES.find(r => r.min === (filters.minFee || '') && r.max === (filters.maxFee || ''))?.v ?? '';
  const sel = (key, label, options) => (
    <label className="adm-filter"><span>{label}</span>
      <select className="adm-select" value={filters[key] || ''} onChange={e => onChange({ [key]: e.target.value })} data-testid={`filter-${key}`}>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </label>
  );
  const any = { value: '', label: t('filter.any') };
  const toggle = (key, Icon, label) => (
    <button type="button" className={`fx-pill ${filters[key] === 'true' ? 'on' : ''}`} aria-pressed={filters[key] === 'true'} onClick={() => onChange({ [key]: filters[key] === 'true' ? '' : 'true' })} data-testid={`toggle-${key}`}>
      <Icon size={14} /> {label}
    </button>
  );

  return (
    <section className="fx-search-wrap" aria-label={t('filter.searchDoctors')}>
      <div className="fx-searchbar">
        <Search size={18} className="fx-search-icon" aria-hidden="true" />
        <input type="search" value={draft} onChange={e => setDraft(e.target.value)} placeholder={t('filter.placeholder')} aria-label={t('filter.searchDoctors')} enterKeyHint="search" />
        {draft && <button type="button" className="fx-search-clear" onClick={() => setDraft('')} aria-label={t('filter.clearSearch')}><X size={15} /></button>}
        <button type="button" className="fx-ai-btn" onClick={onOpenAi} aria-label={t('filter.askAi')} title={t('filter.askAi')} data-testid="ai-search-button">
          <Sparkles size={17} /><span>AI</span>
        </button>
      </div>

      <div className="fx-filter-row">
        <button type="button" className={`fx-pill ${userLocation ? 'on' : ''}`} onClick={onLocate} disabled={locating} aria-pressed={Boolean(userLocation)}>
          {locating ? <Loader2 size={14} className="adm-spin" /> : <LocateFixed size={14} />} {userLocation ? t('filter.nearMe') : t('filter.useLocation')}
        </button>
        {userLocation && (
          <select className="fx-pill-select" value={filters.maxKm || ''} onChange={e => onChange({ maxKm: e.target.value, sortBy: e.target.value ? 'distance' : filters.sortBy })} aria-label={t('filter.distance')}>
            {RADII.map(r => <option key={r} value={r}>{r ? t('filter.withinKm', { n: r }) : t('filter.anyDistance')}</option>)}
          </select>
        )}
        {toggle('availableToday', CalendarCheck, t('filter.availableToday'))}
        {toggle('video', Video, t('filter.video'))}
        <select className="fx-pill-select" value={filters.speciality || 'all'} onChange={e => onChange({ speciality: e.target.value })} aria-label={t('filter.speciality')}>
          <option value="all">{t('filter.allSpecialities')}</option>
          {specialities.map(s => <option key={s.id || s.name} value={s.name}>{s.name}</option>)}
        </select>
        <select className="fx-pill-select" value={filters.sortBy || 'recommended'} onChange={e => onChange({ sortBy: e.target.value })} aria-label={t('filter.sortBy')}>
          {SORTS.filter(s => s !== 'distance' || userLocation).map(s => <option key={s} value={s}>{t(`sort.${s}`)}</option>)}
        </select>
        <button type="button" className={`fx-pill ${activeCount ? 'on' : ''}`} onClick={() => setOpen(o => !o)} aria-expanded={open} data-testid="filters-toggle">
          <SlidersHorizontal size={14} /> {t('filter.filters')}{activeCount ? ` (${activeCount})` : ''}
        </button>
      </div>

      {open && (
        <div className="fx-filter-panel">
          <div className="adm-filters">
            {sel('kind', t('filter.consultation'), [any, ...['clinic', 'own_clinic', 'hospital', 'home_visit', 'online'].map(v => ({ value: v, label: t(`kind.${v}`) }))])}
            {sel('mode', t('filter.booking'), [any, ...['free', 'token', 'paid'].map(v => ({ value: v, label: t(`modeopt.${v}`) }))])}
            <label className="adm-filter"><span>{t('filter.fee')}</span>
              <select className="adm-select" value={feeValue} data-testid="filter-fee" onChange={e => { const r = FEE_RANGES.find(x => x.v === e.target.value) || FEE_RANGES[0]; onChange({ minFee: r.min, maxFee: r.max }); }}>
                {FEE_RANGES.map(r => <option key={r.v} value={r.v}>{r.v ? (r.max ? `₹${r.min}–₹${r.max}` : `₹${r.min}+`) : t('filter.any')}</option>)}
              </select>
            </label>
            {sel('insurer', t('filter.insurance'), [any, ...insurers.map(i => ({ value: i, label: i }))])}
            {sel('gender', t('filter.gender'), [any, { value: 'female', label: t('sex.female') }, { value: 'male', label: t('sex.male') }])}
            {sel('language', t('filter.language'), [any, ...LANG_OPTIONS.map(l => ({ value: l, label: t(`langname.${l}`) }))])}
            {sel('sector', t('filter.sector'), [{ value: 'all', label: t('filter.any') }, { value: 'Private', label: t('sector.Private') }, { value: 'Government', label: t('sector.Government') }])}
            {sel('minExp', t('filter.experience'), [any, ...['5', '10', '20'].map(v => ({ value: v, label: t('filter.yearsPlus', { n: v }) }))])}
            {sel('minRating', t('filter.rating'), [any, { value: '4', label: '4★+' }, { value: '4.5', label: '4.5★+' }])}
            <button type="button" className="adm-btn btn-secondary adm-btn-sm" onClick={() => { onReset(); setOpen(false); }}>{t('filter.reset')}</button>
          </div>
        </div>
      )}
      {userLocation && <p className="fx-near-note"><MapPin size={12} /> {filters.maxKm ? t('filter.nearNoteKm', { n: filters.maxKm }) : t('filter.nearNote')}</p>}
    </section>
  );
}
