import React, { useRef, useState } from 'react';
import { FileText, Upload, Loader2, Trash2, ExternalLink } from 'lucide-react';
import { fmtDateLong } from '../lib/api';

const TYPES = { registration_certificate: 'Medical registration certificate', degree_certificate: 'Degree certificate', id_proof: 'Government ID proof', other: 'Other' };
const STATUS_TONE = { submitted: 'amber', verified: 'green', rejected: 'rose' };

/** Verification documents for doctors (private; visible to the doctor and FindADoc admins only). */
export default function DocumentUpload({ client, documents = [], onChange, maxMb = 8 }) {
  const [docType, setDocType] = useState('registration_certificate');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(null);

  const pick = async e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/pdf|jpe?g|png|webp/i.test(f.type || f.name)) { setError('Upload a PDF, JPG or PNG file.'); return; }
    if (f.size > maxMb * 1024 * 1024) { setError(`File is larger than ${maxMb} MB.`); return; }
    setBusy(true); setError('');
    try {
      await client.upload(f, { purpose: 'doctor_document', docType }, f.name);
      const r = await client.get('/doctor-portal/documents');
      onChange(r.items);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const view = async d => {
    try {
      const url = URL.createObjectURL(await client.blob(`/doctor-portal/documents/${encodeURIComponent(d.id)}/file`));
      const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) { setError(err.message); }
  };
  const remove = async d => {
    try { await client.del(`/doctor-portal/documents/${d.id}`); onChange(documents.filter(x => x.id !== d.id)); } catch (err) { setError(err.message); }
  };

  return (
    <div className="fx-docs">
      <div className="fx-row fx-wrap">
        <select className="adm-select" value={docType} onChange={e => setDocType(e.target.value)} aria-label="Document type">
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button type="button" className="btn-secondary adm-btn" onClick={() => ref.current?.click()} disabled={busy || documents.length >= 6}>
          {busy ? <Loader2 size={15} className="adm-spin" /> : <Upload size={15} />} Upload (PDF / image, max {maxMb} MB)
        </button>
        <input ref={ref} type="file" hidden accept="application/pdf,image/jpeg,image/png,image/webp" onChange={pick} />
      </div>
      {error && <small className="fx-error" role="alert">{error}</small>}
      {documents.length === 0 ? <p className="adm-muted adm-small">No documents uploaded yet. Uploading your registration certificate speeds up verification.</p> : (
        <ul className="fx-doc-list">
          {documents.map(d => (
            <li key={d.id}>
              <FileText size={18} />
              <div><strong>{d.label || TYPES[d.docType]}</strong><small>{d.originalName} • {fmtDateLong(d.uploadedAt)}</small></div>
              <span className={`adm-badge adm-badge-${STATUS_TONE[d.status] || 'slate'}`}>{d.status}</span>
              <button type="button" className="adm-icon-btn" onClick={() => view(d)} aria-label="View document"><ExternalLink size={15} /></button>
              {d.status !== 'verified' && <button type="button" className="adm-icon-btn" onClick={() => remove(d)} aria-label="Delete document"><Trash2 size={15} /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
