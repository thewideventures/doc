import { useCallback, useEffect, useRef, useState } from 'react';

// Web Speech API wrapper. Supported in Chrome / Edge / Safari (webkit prefix); not in Firefox.
export default function useSpeechRecognition({ lang = 'en-IN', onFinal } = {}) {
  const Impl = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
  const supported = Boolean(Impl);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const recRef = useRef(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  const stop = useCallback(() => { try { recRef.current?.stop(); } catch { /* noop */ } }, []);

  const start = useCallback(() => {
    if (!supported) { setError('Voice input is not supported in this browser. Please type your symptoms (try Chrome, Edge or Safari for voice).'); return; }
    setError(''); setInterim('');
    try { recRef.current?.abort(); } catch { /* noop */ }
    const rec = new Impl();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => setListening(true);
    rec.onresult = e => {
      let finalText = '', interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t; else interimText += t;
      }
      setInterim(interimText);
      if (finalText) finalRef.current?.(finalText.trim());
    };
    rec.onerror = e => {
      const map = {
        'not-allowed': 'Microphone permission was denied. Allow microphone access in your browser settings, or type instead.',
        'service-not-allowed': 'Voice input is blocked in this browser. Please type your symptoms.',
        'no-speech': 'We did not hear anything. Tap the mic and try again.',
        'audio-capture': 'No microphone found on this device.',
        network: 'Voice recognition needs an internet connection.'
      };
      setError(map[e.error] || 'Voice input stopped. Please try again or type your symptoms.');
    };
    rec.onend = () => { setListening(false); setInterim(''); };
    recRef.current = rec;
    try { rec.start(); } catch { setError('Could not start the microphone. Please try again.'); }
  }, [Impl, lang, supported]);

  useEffect(() => () => { try { recRef.current?.abort(); } catch { /* noop */ } }, []);

  return { supported, listening, interim, error, start, stop, setError };
}
