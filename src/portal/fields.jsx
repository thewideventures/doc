import React, { useState } from 'react';
import { X, Plus } from 'lucide-react';

/** Multi-select from a list (chips). max: -1 = unlimited. */
export function ChipSelect({ options, value = [], onChange, max = -1, placeholder = 'Search…', limitNote }) {
  const [q, setQ] = useState('');
  const atMax = max !== -1 && value.length >= max;
  const filtered = options.filter(o => !value.includes(o) && o.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
  return (
    <div className="fx-chipselect">
      <div className="fx-chips">
        {value.map(v => <span key={v} className="fx-chip on">{v}<button type="button" onClick={() => onChange(value.filter(x => x !== v))} aria-label={`Remove ${v}`}><X size={12} /></button></span>)}
        {!value.length && <span className="adm-muted adm-small">None selected</span>}
      </div>
      {atMax ? <small className="adm-muted">{limitNote || `Maximum ${max} selected.`}</small> : (
        <>
          <input className="adm-select" value={q} onChange={e => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
          {q && filtered.length === 0 && <small className="adm-muted">No match.</small>}
          <div className="fx-chips fx-chip-options">
            {(q ? filtered : filtered.slice(0, 12)).map(o => <button type="button" key={o} className="fx-chip" onClick={() => { onChange([...value, o]); setQ(''); }}><Plus size={12} /> {o}</button>)}
          </div>
        </>
      )}
    </div>
  );
}

/** Free-text tags (languages, facilities). */
export function TagInput({ value = [], onChange, suggestions = [], placeholder = 'Type and press Enter', max = 20 }) {
  const [t, setT] = useState('');
  const add = v => {
    const s = v.trim().replace(/,$/, '');
    if (!s || value.some(x => x.toLowerCase() === s.toLowerCase()) || value.length >= max) return;
    onChange([...value, s]); setT('');
  };
  return (
    <div className="fx-chipselect">
      <div className="fx-chips">
        {value.map(v => <span key={v} className="fx-chip on">{v}<button type="button" onClick={() => onChange(value.filter(x => x !== v))} aria-label={`Remove ${v}`}><X size={12} /></button></span>)}
      </div>
      <input className="adm-select" value={t} onChange={e => setT(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(t); } }} onBlur={() => t && add(t)} placeholder={placeholder} aria-label={placeholder} />
      {suggestions.filter(s => !value.includes(s)).length > 0 && (
        <div className="fx-chips fx-chip-options">{suggestions.filter(s => !value.includes(s)).slice(0, 10).map(s => <button type="button" key={s} className="fx-chip" onClick={() => add(s)}><Plus size={12} /> {s}</button>)}</div>
      )}
    </div>
  );
}

export const LANGUAGES = ['English', 'Malayalam', 'Hindi', 'Tamil', 'Kannada', 'Telugu', 'Marathi', 'Bengali', 'Gujarati', 'Urdu', 'Arabic', 'Punjabi'];
export const COUNCILS = ['Travancore-Cochin Medical Council', 'Karnataka Medical Council', 'Tamil Nadu Medical Council', 'Maharashtra Medical Council', 'Delhi Medical Council', 'Telangana State Medical Council', 'Andhra Pradesh Medical Council', 'West Bengal Medical Council', 'Gujarat Medical Council', 'National Medical Commission (NMC)', 'Other State Medical Council'];

/** Doctor identity fields shared by registration & profile. */
export function DoctorFields({ value, onChange, specialities = [], maxSpecialities = 2, planName = 'Basic' }) {
  const set = patch => onChange({ ...value, ...patch });
  return (
    <div className="adm-form">
      <div className="fx-grid">
        <label className="adm-field"><span>Full name *</span><input value={value.name || ''} onChange={e => set({ name: e.target.value })} placeholder="Dr. Anjali Menon" autoComplete="name" /></label>
        <label className="adm-field"><span>Professional title</span><input value={value.title || ''} onChange={e => set({ title: e.target.value })} placeholder="Consultant Cardiologist" /></label>
        <label className="adm-field"><span>Qualifications *</span><input value={value.qualifications || ''} onChange={e => set({ qualifications: e.target.value })} placeholder="MBBS, MD (General Medicine)" /></label>
        <label className="adm-field"><span>Experience (years) *</span><input type="number" min="0" max="70" inputMode="numeric" value={value.experienceYears ?? ''} onChange={e => set({ experienceYears: e.target.value })} /></label>
        <label className="adm-field"><span>Medical registration number *</span><input value={value.registrationNumber || ''} onChange={e => set({ registrationNumber: e.target.value.toUpperCase() })} placeholder="e.g. TCMC 45231" /></label>
        <label className="adm-field"><span>Medical council</span>
          <input list="fx-councils" value={value.councilName || ''} onChange={e => set({ councilName: e.target.value })} placeholder="Choose or type" />
          <datalist id="fx-councils">{COUNCILS.map(c => <option key={c} value={c} />)}</datalist>
        </label>
        <label className="adm-field"><span>Registration year</span><input type="number" min="1950" max={new Date().getFullYear()} value={value.registrationYear ?? ''} onChange={e => set({ registrationYear: e.target.value })} /></label>
        <label className="adm-field"><span>Gender</span>
          <select value={value.gender || ''} onChange={e => set({ gender: e.target.value })}><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select>
        </label>
      </div>
      <div className="adm-field"><span>Specialities * <small className="adm-muted">({planName} plan: up to {maxSpecialities === -1 ? 'unlimited' : maxSpecialities})</small></span>
        <ChipSelect options={specialities} value={value.specialities || []} onChange={v => set({ specialities: v })} max={maxSpecialities} placeholder="Search specialities" limitNote={`Your ${planName} plan allows ${maxSpecialities}. Upgrade to add more.`} />
      </div>
      <div className="adm-field"><span>Languages spoken</span><TagInput value={value.languages || []} onChange={v => set({ languages: v })} suggestions={LANGUAGES} placeholder="Add a language" max={12} /></div>
      <label className="adm-field"><span>About you</span><textarea rows={4} maxLength={2000} value={value.bio || ''} onChange={e => set({ bio: e.target.value })} placeholder="Your approach, areas of interest, procedures and past hospitals (40+ characters)" /><small className="adm-muted">{(value.bio || '').length}/2000</small></label>
    </div>
  );
}
