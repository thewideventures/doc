import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Mic, MicOff, X, Send, AlertTriangle, Loader2, Stethoscope, MapPin, Star, ChevronRight, ChevronLeft, Info } from 'lucide-react';
import useSpeechRecognition from '../hooks/useSpeechRecognition';
import { apiFetch, inr } from '../lib/api';
import { useI18n, LANGS } from '../i18n';
import EmergencyBanner from './EmergencyBanner';

const FLAGS = ['chest_pain', 'stroke', 'breathing', 'bleeding', 'unconscious', 'seizure', 'poisoning', 'allergy', 'suicidal'];
const DURATIONS = ['lt1d', '1to3d', '4to7d', '1to4w', 'gt1m'];
const CONDITIONS = ['diabetes', 'hypertension', 'heart_disease', 'asthma_copd', 'kidney', 'immunocompromised'];
const EXAMPLE_KEYS = ['ai.ex1', 'ai.ex2', 'ai.ex3', 'ai.ex4', 'ai.ex5', 'ai.ex6'];

/** One triage question. Calls onAnswer(patch) when the user picks a value. */
function Question({ id, answers, onAnswer, t }) {
  const [draft, setDraft] = useState(() => {
    if (id === 'warning') return answers.warning || [];
    if (id === 'conditions') return answers.conditions || [];
    if (id === 'severity') return answers.severity || 5;
    if (id === 'age') return answers.age ?? '';
    return '';
  });
  const toggle = v => setDraft(d => (d.includes(v) ? d.filter(x => x !== v) : [...d, v]));
  const choice = (key, values, labelPrefix) => (
    <div className="fx-q-options" role="radiogroup" aria-label={t(`q.${id}`)}>
      {values.map(v => (
        <button key={v} type="button" role="radio" aria-checked={answers[key] === v} className={`fx-q-opt ${answers[key] === v ? 'on' : ''}`} onClick={() => onAnswer({ [key]: v })}>{t(`${labelPrefix}.${v}`)}</button>
      ))}
    </div>
  );
  return (
    <div className="fx-q" data-testid={`q-${id}`}>
      <h4>{t(`q.${id}`)}</h4>
      {t(`q.${id}.hint`) !== `q.${id}.hint` && <p className="adm-small adm-muted">{t(`q.${id}.hint`)}</p>}
      {id === 'warning' && (
        <>
          <div className="fx-q-checks">
            {FLAGS.map(f => (
              <label key={f} className={`fx-q-check ${draft.includes(f) ? 'on' : ''}`}>
                <input type="checkbox" checked={draft.includes(f)} onChange={() => toggle(f)} /> <span>{t(`flag.${f}`)}</span>
              </label>
            ))}
          </div>
          <div className="fx-row fx-wrap fx-mt">
            <button type="button" className="btn-secondary adm-btn" onClick={() => onAnswer({ warning: [] })} data-testid="q-none">{t('q.noneOfThese')}</button>
            <button type="button" className="adm-btn adm-btn-danger" disabled={!draft.length} onClick={() => onAnswer({ warning: draft })}>{t('q.haveThese')}</button>
          </div>
        </>
      )}
      {id === 'duration' && choice('duration', DURATIONS, 'dur')}
      {id === 'sex' && choice('sex', ['female', 'male', 'other'], 'sex')}
      {id === 'pregnancy' && choice('pregnancy', ['yes', 'no', 'unsure'], 'preg')}
      {id === 'severity' && (
        <div>
          <div className="fx-q-sev">
            <input type="range" min="1" max="10" value={draft} onChange={e => setDraft(Number(e.target.value))} aria-label={t('q.severity')} />
            <strong className={draft >= 8 ? 'hi' : ''}>{draft}/10</strong>
          </div>
          <div className="fx-row fx-between adm-small adm-muted"><span>{t('sev.mild')}</span><span>{t('sev.worst')}</span></div>
          <button type="button" className="btn-primary adm-btn fx-mt" onClick={() => onAnswer({ severity: draft })}>{t('common.next')}</button>
        </div>
      )}
      {id === 'age' && (
        <form className="fx-row" onSubmit={e => { e.preventDefault(); if (draft !== '' && Number(draft) >= 0) onAnswer({ age: Number(draft) }); }}>
          <input className="adm-input" type="number" inputMode="numeric" min="0" max="120" value={draft} onChange={e => setDraft(e.target.value)} placeholder={t('q.age.placeholder')} aria-label={t('q.age')} style={{ maxWidth: 140 }} />
          <button className="btn-primary adm-btn" disabled={draft === '' || Number(draft) < 0 || Number(draft) > 120}>{t('common.next')}</button>
        </form>
      )}
      {id === 'conditions' && (
        <>
          <div className="fx-q-checks">
            {CONDITIONS.map(c => (
              <label key={c} className={`fx-q-check ${draft.includes(c) ? 'on' : ''}`}>
                <input type="checkbox" checked={draft.includes(c)} onChange={() => toggle(c)} /> <span>{t(`cond.${c}`)}</span>
              </label>
            ))}
          </div>
          <div className="fx-row fx-wrap fx-mt">
            <button type="button" className="btn-secondary adm-btn" onClick={() => onAnswer({ conditions: ['none'] })}>{t('cond.none')}</button>
            <button type="button" className="btn-primary adm-btn" disabled={!draft.length} onClick={() => onAnswer({ conditions: draft })}>{t('common.next')}</button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Multi-step AI symptom triage: describe → follow-up questions (red-flag checklist first) → result.
 * Any red flag at any step opens the full-screen 108/112 emergency banner.
 */
export default function AiSearchModal({ open, onClose, userLocation, onSelectSpeciality, onOpenDoctor }) {
  const { t, lang, meta } = useI18n();
  const [text, setText] = useState('');
  const [voice, setVoice] = useState(meta.voice);
  const [loading, setLoading] = useState(false);
  const [answers, setAnswers] = useState({});
  const [questions, setQuestions] = useState([]);
  const [result, setResult] = useState(null);
  const [emergency, setEmergency] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const speech = useSpeechRecognition({ lang: voice, onFinal: s => setText(prev => (prev ? `${prev.trim()} ${s}` : s)) });

  useEffect(() => { setVoice(meta.voice); }, [meta.voice]);
  useEffect(() => {
    if (!open) { speech.stop(); return undefined; }
    const h = e => { if (e.key === 'Escape' && !emergency) onClose(); };
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [open, emergency]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => { setResult(null); setQuestions([]); setAnswers({}); setText(''); setError(''); setTimeout(() => inputRef.current?.focus(), 30); };

  const run = async ({ q = text, ans = answers, skip = false } = {}) => {
    const query = q.trim();
    if (query.length < 3) { setError(t('ai.tooShort')); return; }
    speech.stop();
    setError(''); setLoading(true);
    try {
      const data = await apiFetch('/api/ai-symptom-triage', { method: 'POST', body: { symptomsText: query, lang, answers: ans, skipQuestions: skip || undefined, userLat: userLocation?.lat, userLng: userLocation?.lng } });
      if (data.stage === 'emergency') { setEmergency(data); setQuestions([]); setResult(null); }
      else if (data.stage === 'questions') { setQuestions(data.questions || []); setResult(null); }
      else { setQuestions([]); setResult(data); }
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };
  const answer = patch => {
    const next = { ...answers, ...patch };
    setAnswers(next);
    // red-flag checklist answered positively → straight to the server (it will return the emergency stage)
    if (patch.warning?.length) { run({ ans: next }); return; }
    const rest = questions.filter(id => next[id] === undefined && !(id === 'pregnancy' && next.sex && next.sex !== 'female'));
    if (rest.length) setQuestions(rest); else run({ ans: next });
  };

  if (!open) return null;
  const urg = result?.urgencyLevel;
  const asking = questions.length > 0 && !result;
  const qid = questions[0];
  const answeredCount = Object.keys(answers).length;

  return (
    <>
      <div className="fx-overlay" onClick={onClose}>
        <div className="fx-sheet fx-ai" role="dialog" aria-modal="true" aria-labelledby="ai-title" onClick={e => e.stopPropagation()}>
          <div className="fx-sheet-head">
            {asking ? <button className="adm-icon-btn" onClick={reset} aria-label={t('common.back')}><ChevronLeft size={18} /></button> : null}
            <div className="fx-ai-title">
              <span className="fx-ai-badge"><Sparkles size={16} /></span>
              <div>
                <h3 id="ai-title">{t('ai.title')}</h3>
                <small>{t('ai.subtitle')}</small>
              </div>
            </div>
            <button className="adm-icon-btn" onClick={onClose} aria-label={t('common.close')}><X size={18} /></button>
          </div>

          <div className="fx-sheet-body">
            <p className="fx-note fx-note-info adm-small" role="note"><Info size={14} /> {t('ai.disclaimerShort')}</p>
            {!asking && !result && (
              <>
                <div className={`fx-ai-input ${speech.listening ? 'listening' : ''}`}>
                  <textarea ref={inputRef} rows={3} value={speech.listening && speech.interim ? `${text} ${speech.interim}`.trim() : text}
                    onChange={e => setText(e.target.value)} placeholder={t('ai.placeholder')} aria-label={t('ai.describe')}
                    onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run(); }} maxLength={1000} data-testid="ai-input" />
                  <div className="fx-ai-controls">
                    <select value={voice} onChange={e => setVoice(e.target.value)} aria-label={t('ai.voiceLang')} className="adm-select adm-select-sm">
                      {LANGS.map(l => <option key={l.voice} value={l.voice}>{l.label}</option>)}
                    </select>
                    <button type="button" className={`fx-mic ${speech.listening ? 'on' : ''}`} onClick={() => (speech.listening ? speech.stop() : speech.start())}
                      aria-pressed={speech.listening} aria-label={speech.listening ? t('ai.stopVoice') : t('ai.startVoice')} title={speech.supported ? t('ai.voice') : t('ai.voiceUnsupported')}>
                      {speech.listening ? <MicOff size={18} /> : <Mic size={18} />}
                      {speech.listening && <span className="fx-pulse" aria-hidden="true" />}
                    </button>
                    <button type="button" className="btn-primary fx-ai-go" onClick={() => { setAnswers({}); run({ ans: {} }); }} disabled={loading} data-testid="ai-go">
                      {loading ? <Loader2 size={16} className="adm-spin" /> : <Send size={16} />} {t('ai.continue')}
                    </button>
                  </div>
                  {speech.listening && <div className="fx-listening" role="status"><span className="fx-wave"><i /><i /><i /><i /><i /></span> {t('ai.listening')}</div>}
                </div>
                {!speech.supported && <p className="fx-note"><MicOff size={14} /> {t('ai.voiceUnsupported')}</p>}
                {speech.error && <p className="fx-note fx-note-warn" role="alert"><AlertTriangle size={14} /> {speech.error}</p>}
                <div className="fx-chips" aria-label={t('ai.examples')}>
                  {EXAMPLE_KEYS.map(k => <button key={k} type="button" className="fx-chip" onClick={() => { setText(t(k)); setAnswers({}); run({ q: t(k), ans: {} }); }}>{t(k)}</button>)}
                </div>
              </>
            )}
            {error && <div className="adm-alert adm-alert-error" role="alert">{error}</div>}

            {asking && qid && (
              <div className="fx-ai-steps" aria-live="polite">
                <p className="adm-small adm-muted">“{text.trim().slice(0, 120)}”</p>
                <div className="fx-progress" aria-hidden="true"><span style={{ width: `${Math.min(95, (answeredCount / (answeredCount + questions.length)) * 100)}%` }} /></div>
                <p className="adm-small adm-muted">{t('ai.step', { n: answeredCount + 1, total: answeredCount + questions.length })}</p>
                <Question key={qid} id={qid} answers={answers} onAnswer={answer} t={t} />
                {loading && <p><Loader2 size={14} className="adm-spin" /> {t('common.loading')}</p>}
                {qid !== 'warning' && <button type="button" className="adm-link fx-mt" onClick={() => run({ skip: true })} disabled={loading}>{t('ai.skip')}</button>}
              </div>
            )}

            {result && (
              <div className="fx-ai-result" aria-live="polite" data-testid="ai-result">
                <div className="fx-ai-card">
                  <div className="fx-ai-row">
                    <div><small className="adm-muted">{t('ai.suggested')}</small><h4>{result.detectedIllnessCategory}</h4></div>
                    <span className={`adm-badge adm-badge-${urg === 'priority' ? 'amber' : 'green'}`}>{t(`urg.${urg}`)}</span>
                  </div>
                  <p>{result.matchedKeywords?.length ? t('ai.matchExplain', { spec: result.detectedIllnessCategory, words: result.matchedKeywords.slice(0, 3).join(', ') }) : t('ai.noMatch')}</p>
                  {result.urgencyReasons?.length > 0 && urg === 'priority' && (
                    <ul className="fx-ai-reasons">{result.urgencyReasons.map(r => <li key={r}>{t(`urgr.${r}`)}</li>)}</ul>
                  )}
                  <p className="adm-small">{urg === 'priority' ? t('ai.nextPriority', { spec: result.detectedIllnessCategory }) : t('ai.nextRoutine', { spec: result.detectedIllnessCategory })}</p>
                  {result.alternatives?.length > 0 && <p className="adm-small adm-muted">{t('ai.alsoConsider')}: {result.alternatives.map(a => a.name).join(', ')}</p>}
                  <div className="fx-ai-actions">
                    <button className="btn-primary adm-btn" onClick={() => { onSelectSpeciality(result.detectedIllnessCategory); onClose(); }}><Stethoscope size={15} /> {t('ai.seeAll', { spec: result.detectedIllnessCategory })}</button>
                    <button className="btn-secondary adm-btn" onClick={reset}>{t('ai.newSearch')}</button>
                  </div>
                </div>
                {result.matchingDoctors?.length > 0 ? (
                  <ul className="fx-ai-docs">
                    {result.matchingDoctors.map(d => (
                      <li key={d.id}>
                        <button type="button" onClick={() => { onOpenDoctor(d); onClose(); }}>
                          <img src={d.photo} alt="" loading="lazy" />
                          <div>
                            <strong>{d.name}</strong>
                            <small>{d.specialities?.slice(0, 2).join(', ')} • {t('doc.years', { n: d.experienceYears || 0 })}</small>
                            <small><Star size={11} /> {Number(d.rating || 0).toFixed(1)} {d.distance != null && <><MapPin size={11} /> {d.distance} km</>} • {t('doc.feeFrom')} {inr(d.consultationFee)}</small>
                          </div>
                          {d.plan?.featured && <span className="adm-badge adm-badge-purple">{t('doc.featured')}</span>}
                          <ChevronRight size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="adm-muted adm-small">{t('ai.noDoctors')}</p>}
                <p className="fx-disclaimer">{t('ai.disclaimer')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
      {emergency && (
        <EmergencyBanner redFlags={emergency.redFlags} numbers={emergency.emergencyNumbers} userLocation={userLocation}
          onClose={() => { setEmergency(null); setAnswers(a => ({ ...a, warning: undefined })); }} />
      )}
    </>
  );
}
