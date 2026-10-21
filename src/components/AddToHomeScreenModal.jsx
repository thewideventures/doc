import React from 'react';
import { Smartphone, Share, PlusSquare, CheckCircle, X, Download } from 'lucide-react';

export default function AddToHomeScreenModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '40px', height: '40px', borderRadius: '12px', background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0284c7' }}>
              <Smartphone size={22} />
            </div>
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: '800' }}>Add to Home Screen</h3>
              <p style={{ fontSize: '12px', color: '#64748b' }}>Use FindADoc just like a native mobile app</p>
            </div>
          </div>
          <button onClick={onClose} style={{ background: '#f1f5f9', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={18} color="#64748b" />
          </button>
        </div>

        <div style={{ background: '#f8fafc', borderRadius: '16px', padding: '16px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
          <h4 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ background: '#0284c7', color: 'white', borderRadius: '50%', width: '18px', height: '18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px' }}>1</span>
            For iPhone & iPad (Safari):
          </h4>
          <ol style={{ fontSize: '13px', color: '#475569', paddingLeft: '22px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              Tap the <strong>Share</strong> button <Share size={15} color="#0284c7" /> in Safari's bottom toolbar.
            </li>
            <li style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              Scroll down and tap <strong>"Add to Home Screen"</strong> <PlusSquare size={15} color="#0284c7" />.
            </li>
            <li>Tap <strong>Add</strong> in the top right corner.</li>
          </ol>
        </div>

        <div style={{ background: '#f8fafc', borderRadius: '16px', padding: '16px', border: '1px solid #e2e8f0', marginBottom: '20px' }}>
          <h4 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ background: '#059669', color: 'white', borderRadius: '50%', width: '18px', height: '18px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px' }}>2</span>
            For Android (Chrome / Brave):
          </h4>
          <ol style={{ fontSize: '13px', color: '#475569', paddingLeft: '22px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li>Tap the <strong>3 vertical dots</strong> (Menu) in the top-right corner.</li>
            <li>Select <strong>"Install App"</strong> or <strong>"Add to Home Screen"</strong>.</li>
            <li>Confirm installation to enjoy full offline access!</li>
          </ol>
        </div>

        <button 
          onClick={onClose}
          className="btn-primary" 
          style={{ width: '100%', padding: '12px', fontSize: '14px' }}
        >
          <CheckCircle size={18} /> Got it, let's explore doctors
        </button>
      </div>
    </div>
  );
}
