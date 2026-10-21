import React, { useState } from 'react';
import { Sparkles, Bot, AlertTriangle, CheckCircle, ArrowRight, Activity, RefreshCw } from 'lucide-react';

export default function AiSymptomTriage({ onSelectSpeciality, onSearchResults }) {
  const [symptoms, setSymptoms] = useState('');
  const [loading, setLoading] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState('');

  const sampleQueries = [
    { label: "🫁 Cough & Shortness of Breath (English)", text: "I have persistent dry cough and chest tightness when breathing" },
    { label: "🫁 सांस लेने में तकलीफ और खांसी (Hindi)", text: "मुझे बहुत तेज खांसी और सांस फूलने की समस्या हो रही है" },
    { label: "👂 Ear ache & throat irritation", text: "Severe sharp pain inside right ear and sore throat" },
    { label: "❤️ Chest heaviness & rapid heartbeat", text: "Heaviness in center of chest and feeling high blood pressure" },
    { label: "✨ Red itchy skin rashes", text: "Spreading red itchy patches and eczema on arms and neck" }
  ];

  const handleAnalyze = async (queryText) => {
    const textToSubmit = queryText || symptoms;
    if (!textToSubmit || !textToSubmit.trim()) {
      setError('Please type your symptoms or select an example above');
      return;
    }

    setError('');
    setLoading(true);
    setAnalysis(null);

    try {
      const res = await fetch('/api/ai-symptom-triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symptomsText: textToSubmit })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to analyze symptoms');

      setAnalysis(data);
      if (onSearchResults && data.matchingDoctors) {
        onSearchResults(data.matchingDoctors, data.detectedIllnessCategory);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleApplySpeciality = () => {
    if (analysis && analysis.detectedIllnessCategory) {
      onSelectSpeciality(analysis.detectedIllnessCategory);
    }
  };

  return (
    <div style={{
      background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
      borderRadius: '24px',
      border: '1.5px solid #bae6fd',
      padding: '20px',
      marginBottom: '24px',
      boxShadow: '0 8px 24px -6px rgba(2, 132, 199, 0.12)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
            color: 'white',
            width: '32px',
            height: '32px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 10px rgba(2, 132, 199, 0.3)'
          }}>
            <Bot size={18} />
          </div>
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: '800', color: '#0369a1', display: 'flex', alignItems: 'center', gap: '6px' }}>
              Multilingual Symptom AI Specialist Finder
              <span style={{ fontSize: '10px', background: '#0284c7', color: 'white', padding: '1px 6px', borderRadius: '6px', fontWeight: '800' }}>AI</span>
            </h3>
            <p style={{ fontSize: '12px', color: '#0284c7' }}>
              Describe symptoms in any language (English, हिंदी, Español, etc.) — our AI suggests the exact doctor
            </p>
          </div>
        </div>
      </div>

      {/* Quick sample chips */}
      <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '8px', marginBottom: '10px' }}>
        {sampleQueries.map((sample, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => {
              setSymptoms(sample.text);
              handleAnalyze(sample.text);
            }}
            style={{
              whiteSpace: 'nowrap',
              fontSize: '11px',
              padding: '5px 10px',
              borderRadius: '9999px',
              background: '#ffffff',
              border: '1px solid #bae6fd',
              color: '#0369a1',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            {sample.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            type="text"
            value={symptoms}
            onChange={e => setSymptoms(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAnalyze(); }}
            placeholder="e.g. Sharp chest pain, shortness of breath, chronic cough, skin allergy..."
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: '14px',
              border: '1px solid #93c5fd',
              background: '#ffffff',
              fontSize: '14px',
              color: '#0f172a',
              boxShadow: '0 2px 8px rgba(0,0,0,0.03)'
            }}
          />
        </div>
        <button
          onClick={() => handleAnalyze()}
          disabled={loading}
          className="btn-primary"
          style={{ padding: '12px 18px', whiteSpace: 'nowrap', borderRadius: '14px' }}
        >
          {loading ? (
            <RefreshCw size={18} className="animate-spin" />
          ) : (
            <>
              <Sparkles size={16} />
              <span>Ask AI</span>
            </>
          )}
        </button>
      </div>

      {error && (
        <div style={{ color: '#b91c1c', fontSize: '12px', marginTop: '8px', fontWeight: '600' }}>
          {error}
        </div>
      )}

      {/* AI Triage Recommendation Result Box */}
      {analysis && (
        <div style={{
          marginTop: '16px',
          background: '#ffffff',
          borderRadius: '18px',
          padding: '16px',
          border: '1px solid #93c5fd',
          boxShadow: '0 6px 16px rgba(2, 132, 199, 0.08)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
            <div>
              <span style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#64748b', fontWeight: '700' }}>
                Recommended Specialist
              </span>
              <h4 style={{ fontSize: '20px', fontWeight: '800', color: '#0284c7', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {analysis.detectedIllnessCategory}
                <span style={{ fontSize: '11px', background: '#e0f2fe', color: '#0369a1', padding: '2px 8px', borderRadius: '9999px', fontWeight: '700' }}>
                  {analysis.confidence}
                </span>
              </h4>
            </div>

            {/* Urgency Badge */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              borderRadius: '9999px',
              fontSize: '12px',
              fontWeight: '700',
              background: analysis.urgencyLevel === 'emergency' ? '#fee2e2' : analysis.urgencyLevel === 'priority' ? '#fef3c7' : '#ecfdf5',
              color: analysis.urgencyLevel === 'emergency' ? '#dc2626' : analysis.urgencyLevel === 'priority' ? '#b45309' : '#059669',
              border: `1px solid ${analysis.urgencyLevel === 'emergency' ? '#fca5a5' : analysis.urgencyLevel === 'priority' ? '#fde68a' : '#a7f3d0'}`
            }}>
              {analysis.urgencyLevel === 'emergency' ? <AlertTriangle size={15} /> : <Activity size={15} />}
              <span>{analysis.urgency}</span>
            </div>
          </div>

          <p style={{ fontSize: '13px', color: '#334155', lineHeight: '1.5', marginBottom: '8px' }}>
            {analysis.aiExplanation}
          </p>

          <p style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic', marginBottom: '14px' }}>
            💡 Next Step: {analysis.nextSteps}
          </p>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: '12px', flexWrap: 'wrap', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#059669', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckCircle size={15} /> {analysis.matchingDoctorsCount} verified {analysis.detectedIllnessCategory}s available in your area
            </span>
            <button
              onClick={handleApplySpeciality}
              className="btn-primary"
              style={{ padding: '8px 14px', fontSize: '12px', borderRadius: '10px' }}
            >
              Filter & Book {analysis.detectedIllnessCategory}s <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
