import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, Mic, MicOff, X, Send, AlertTriangle, Loader2, ShieldAlert, Stethoscope, MapPin, Star, ChevronRight } from 'lucide-react';
import useSpeechRecognition from '../hooks/useSpeechRecognition';
import { apiFetch, inr } from '../lib/api';

const LANGS = [
  { code: 'en-IN', label: 'English' },
  { code: 'hi-IN', label: 'हिंदी' },
  { code: 'ml-IN', label: 'മലയാളം' },
  { code: 'ta-IN', label: 'தமிழ்' }
];
const EXAMPLES = ['Fever and sore throat for 3 days', 'Skin rash and itching', 'Chest pain while climbing stairs', 'My child has ear pain', 'घुटनों में दर्द', 'തലവേദനയും പനിയും'];

/**
 * AI symptom search panel (opened from the sparkle button in the search bar).
 * Reuses /api/ai-symptom-triage; results link to matching doctors.
 */
export default function AiSearchModal({ open, onClose, userLocation, onSelectSpeciality, onOpenDoctor }) {
  const [text, setText] = useState('');
  const [lang, setLang] = useState(() => localStorage.getItem('fad_voice_lang') || 'en-IN');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const inputRef = useRef(null);
  const speech = useSpeechRecognition({ lang, onFinal: t => setText(prev => (prev ? `${prev.trim()} ${t}` : t)) });

  useEffect(() => {
    if (!open) { speech.stop(); return; }
    const h = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    document.body.style.overflow = 'hidden';
    setTimeout(() => inputRef.current?.focus(), 50);
    return () => { window.removeEventListener('keydown', h); document.body.style.overflow = ''; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { localStorage.setItem('fad_voice_lang', lang); }, [lang]);

  const analyse = async (q = text) => {
    const query = q.trim();
    if (query.length < 3) { setError('Describe your symptoms in a few words.'); return; }
    speech.stop();
    setError(''); setLoading(true);
    try {
      const data = await apiFetch('/api/ai-symptom-triage', { method: 'POST', body: { symptomsText: query, userLat: userLocation?.lat, userLng: userLocation?.lng } });
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally { setLoading(false); }
  };

  if (!open) return null;
  const urg = result?.urgencyLevel;

  return (
    <div className="fx-overlay" onClick={onClose}>
      <div className="fx-sheet fx-ai" role="dialog" aria-modal="true" aria-labelledby="ai-title" onClick={e => e.stopPropagation()}>
        <div className="fx-sheet-head">
          <div className="fx-ai-title">
            <span className="fx-ai-badge"><Sparkles size={16} /></span>
            <div>
              <h3 id="ai-title">AI symptom search</h3>
              <small>Speak or type — we’ll suggest the right specialist</small>
            </div>
          </div>
          <button className="adm-icon-btn" onClick={onClose} aria-label="Close AI search"><X size={18} /></button>
        </div>

        <div className="fx-sheet-body">
          <div className={`fx-ai-input ${speech.listening ? 'listening' : ''}`}>
            <textarea
              ref={inputRef}
              rows={3}
              value={speech.listening && speech.interim ? `${text} ${speech.interim}`.trim() : text}
              onChange={e => setText(e.target.value)}
              placeholder="e.g. I have had fever, body pain and cough since yesterday"
              aria-label="Describe your symptoms"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) analyse(); }}
              maxLength={1000}
            />
            <div className="fx-ai-controls">
              <select value={lang} onChange={e => setLang(e.target.value)} aria-label="Voice language" className="adm-select adm-select-sm">
                {LANGS.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
              <button
                type="button"
                className={`fx-mic ${speech.listening ? 'on' : ''}`}
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
                aria-pressed={speech.listening}
                aria-label={speech.listening ? 'Stop voice input' : 'Start voice input'}
                title={speech.supported ? 'Voice input' : 'Voice input not supported in this browser'}
              >
                {speech.listening ? <MicOff size={18} /> : <Mic size={18} />}
                {speech.listening && <span className="fx-pulse" aria-hidden="true" />}
              </button>
              <button type="button" className="btn-primary fx-ai-go" onClick={() => analyse()} disabled={loading}>
                {loading ? <Loader2 size={16} className="adm-spin" /> : <Send size={16} />} Find specialist
              </button>
            </div>
            {speech.listening && (
              <div className="fx-listening" role="status"><span className="fx-wave"><i /><i /><i /><i /><i /></span> Listening… speak now</div>
            )}
          </div>
          {!speech.supported && <p className="fx-note"><MicOff size={14} /> Voice input isn’t supported in this browser (e.g. Firefox). You can still type your symptoms.</p>}
          {speech.error && <p className="fx-note fx-note-warn" role="alert"><AlertTriangle size={14} /> {speech.error}</p>}
          {error && <div className="adm-alert adm-alert-error" role="alert">{error}</div>}

          {!result && !loading && (
            <div className="fx-chips" aria-label="Examples">
              {EXAMPLES.map(x => <button key={x} type="button" className="fx-chip" onClick={() => { setText(x); analyse(x); }}>{x}</button>)}
            </div>
          )}

          {result && (
            <div className="fx-ai-result" aria-live="polite">
              {urg === 'emergency' && (
                <div className="fx-emergency" role="alert"><ShieldAlert size={20} /><div><strong>{result.urgency}</strong><span>{result.nextSteps}</span></div><a href="tel:112" className="adm-btn adm-btn-danger adm-btn-sm">Call 112</a></div>
              )}
              <div className="fx-ai-card">
                <div className="fx-ai-row">
                  <div>
                    <small className="adm-muted">Suggested specialist</small>
                    <h4>{result.detectedIllnessCategory}</h4>
                  </div>
                  <span className={`adm-badge adm-badge-${urg === 'emergency' ? 'red' : urg === 'priority' ? 'amber' : 'green'}`}>{urg === 'routine' ? 'Routine' : urg === 'priority' ? 'Within 24 h' : 'Emergency'}</span>
                </div>
                <p>{result.aiExplanation}</p>
                {result.alternatives?.length > 0 && <p className="adm-small adm-muted">Also consider: {result.alternatives.map(a => a.name).join(', ')}</p>}
                <div className="fx-ai-actions">
                  <button className="btn-primary adm-btn" onClick={() => { onSelectSpeciality(result.detectedIllnessCategory); onClose(); }}>
                    <Stethoscope size={15} /> See all {result.detectedIllnessCategory} doctors
                  </button>
                  <button className="btn-secondary adm-btn" onClick={() => { setResult(null); setText(''); inputRef.current?.focus(); }}>New search</button>
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
                          <small>{d.specialities?.slice(0, 2).join(', ')} • {d.experienceYears} yrs</small>
                          <small><Star size={11} /> {Number(d.rating || 0).toFixed(1)} {d.distance != null && <><MapPin size={11} /> {d.distance} km</>} • from {inr(d.consultationFee)}</small>
                        </div>
                        {d.plan?.featured && <span className="adm-badge adm-badge-purple">Featured</span>}
                        <ChevronRight size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : <p className="adm-muted adm-small">No verified {result.detectedIllnessCategory}s are listed yet. Try a General Physician.</p>}
              <p className="fx-disclaimer">{result.disclaimer}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
