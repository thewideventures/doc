import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import en from './en.js';
import ml from './ml.js';
import hi from './hi.js';

/** Supported UI languages. `voice` is the Web Speech API language used for voice symptom input. */
export const LANGS = [
  { code: 'en', label: 'English', short: 'EN', voice: 'en-IN', locale: 'en-IN' },
  { code: 'ml', label: 'മലയാളം', short: 'മ', voice: 'ml-IN', locale: 'ml-IN' },
  { code: 'hi', label: 'हिन्दी', short: 'हि', voice: 'hi-IN', locale: 'hi-IN' }
];
export const DICTS = { en, ml, hi };
const STORAGE_KEY = 'fad_lang';
const CODES = LANGS.map(l => l.code);

export function detectLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (CODES.includes(saved)) return saved;
  } catch { /* storage blocked */ }
  const nav = (typeof navigator !== 'undefined' && (navigator.languages || [navigator.language])) || [];
  for (const l of nav) { const c = String(l || '').slice(0, 2).toLowerCase(); if (CODES.includes(c)) return c; }
  return 'en';
}

/** Pure translate: missing keys fall back to English, then to the key itself. {name} placeholders are interpolated. */
/** Label for a stored enum value (e.g. a family relation) that may be legacy free text: falls back to the raw value. */
export const enumLabel = (t, prefix, value) => (value ? t(`${prefix}.${String(value).toLowerCase()}`, { _default: value }) : '');

export function translate(lang, key, vars) {
  const s = DICTS[lang]?.[key] ?? en[key] ?? (vars && vars._default !== undefined ? String(vars._default) : key);
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

const Ctx = createContext({ lang: 'en', setLang: () => {}, t: (k, v) => translate('en', k, v), meta: LANGS[0] });
const listeners = new Set();
/** Subscribe to language changes from outside React (e.g. to persist to the server). */
export const onLangChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(detectLang);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const setLang = useCallback((code, { silent = false } = {}) => {
    if (!CODES.includes(code)) return;
    setLangState(code);
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
    if (!silent) listeners.forEach(fn => { try { fn(code); } catch { /* ignore */ } });
  }, []);
  const value = useMemo(() => ({ lang, setLang, t: (k, v) => translate(lang, k, v), meta: LANGS.find(l => l.code === lang) || LANGS[0] }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;

/** Compact language switcher (select) — persisted in localStorage and, when signed in, on the profile. */
export function LanguageSwitcher({ className = '', compact = false }) {
  const { lang, setLang, t } = useI18n();
  return (
    <label className={`fx-lang ${className}`} title={t('lang.choose')}>
      <span className="fx-sr">{t('lang.choose')}</span>
      <select value={lang} onChange={e => setLang(e.target.value)} aria-label={t('lang.choose')} data-testid="lang-switcher" className="fx-lang-select">
        {LANGS.map(l => <option key={l.code} value={l.code}>{compact ? l.short : l.label}</option>)}
      </select>
    </label>
  );
}
