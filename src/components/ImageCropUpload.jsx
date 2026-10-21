import React, { useCallback, useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { Camera, RotateCw, RotateCcw, ZoomIn, ZoomOut, Loader2, Trash2, Upload, X, Check } from 'lucide-react';
import { cropImage } from '../lib/image';

const MAX_INPUT_MB = 15;

/**
 * Photo picker with a crop step (zoom, rotate, square / round), compressed client side (WebP, JPEG fallback)
 * then uploaded via `upload(blob, filename)` which must resolve to { url }.
 */
export default function ImageCropUpload({ value, onChange, upload, label = 'Photo', shape = 'round', aspect = 1, maxSize = 800, hint, disabled }) {
  const [src, setSrc] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [cropShape, setCropShape] = useState(shape);
  const [area, setArea] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);

  const pick = e => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(f.type) && !/\.(jpe?g|png|webp)$/i.test(f.name)) { setError('Please choose a JPG, PNG or WEBP image.'); return; }
    if (f.size > MAX_INPUT_MB * 1024 * 1024) { setError(`That photo is larger than ${MAX_INPUT_MB} MB.`); return; }
    setError('');
    setCrop({ x: 0, y: 0 }); setZoom(1); setRotation(0); setCropShape(shape);
    setSrc(URL.createObjectURL(f));
  };

  const onCropComplete = useCallback((_, px) => setArea(px), []);

  const save = async () => {
    if (!area) return;
    setBusy(true); setError('');
    try {
      const out = await cropImage(src, area, { rotation, maxSize });
      const res = await upload(out.blob, `photo.${out.ext}`);
      onChange(res.url);
      setSrc('');
    } catch (e) {
      setError(e.message || 'Upload failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="fx-photo">
      <div className={`fx-photo-preview ${shape === 'round' ? 'round' : ''}`} style={{ aspectRatio: String(aspect) }}>
        {value ? <img src={value} alt={label} /> : <Camera size={26} aria-hidden="true" />}
      </div>
      <div className="fx-photo-side">
        <strong className="adm-small">{label}</strong>
        {hint && <small className="adm-muted">{hint}</small>}
        <div className="fx-row">
          <button type="button" className="btn-secondary adm-btn adm-btn-sm" onClick={() => fileRef.current?.click()} disabled={disabled}><Upload size={14} /> {value ? 'Change' : 'Upload'}</button>
          {value && <button type="button" className="adm-btn adm-btn-danger-soft adm-btn-sm" onClick={() => onChange('')} disabled={disabled}><Trash2 size={14} /> Remove</button>}
        </div>
        {error && <small className="fx-error" role="alert">{error}</small>}
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pick} aria-label={`Choose ${label}`} />

      {src && (
        <div className="fx-overlay" onClick={() => !busy && setSrc('')}>
          <div className="fx-sheet fx-crop" role="dialog" aria-modal="true" aria-label="Crop photo" onClick={e => e.stopPropagation()}>
            <div className="fx-sheet-head"><h3>Crop {label.toLowerCase()}</h3><button className="adm-icon-btn" onClick={() => setSrc('')} disabled={busy} aria-label="Cancel"><X size={18} /></button></div>
            <div className="fx-crop-area">
              <Cropper image={src} crop={crop} zoom={zoom} rotation={rotation} aspect={aspect} cropShape={cropShape === 'round' ? 'round' : 'rect'} showGrid={cropShape !== 'round'}
                onCropChange={setCrop} onZoomChange={setZoom} onRotationChange={setRotation} onCropComplete={onCropComplete} />
            </div>
            <div className="fx-crop-controls">
              <label className="fx-slider"><ZoomOut size={15} /><input type="range" min={1} max={4} step={0.01} value={zoom} onChange={e => setZoom(Number(e.target.value))} aria-label="Zoom" /><ZoomIn size={15} /></label>
              <div className="fx-row">
                <button type="button" className="btn-secondary adm-btn adm-btn-sm" onClick={() => setRotation(r => (r + 270) % 360)} aria-label="Rotate left"><RotateCcw size={14} /></button>
                <button type="button" className="btn-secondary adm-btn adm-btn-sm" onClick={() => setRotation(r => (r + 90) % 360)} aria-label="Rotate right"><RotateCw size={14} /></button>
                {aspect === 1 && (
                  <div className="fx-seg" role="group" aria-label="Crop shape">
                    <button type="button" className={cropShape === 'round' ? 'on' : ''} onClick={() => setCropShape('round')}>Circle</button>
                    <button type="button" className={cropShape === 'rect' ? 'on' : ''} onClick={() => setCropShape('rect')}>Square</button>
                  </div>
                )}
              </div>
            </div>
            <div className="adm-modal-foot">
              <button type="button" className="btn-secondary adm-btn" onClick={() => setSrc('')} disabled={busy}>Cancel</button>
              <button type="button" className="btn-primary adm-btn" onClick={save} disabled={busy || !area} data-testid="crop-save">{busy ? <Loader2 size={15} className="adm-spin" /> : <Check size={15} />} Save photo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
