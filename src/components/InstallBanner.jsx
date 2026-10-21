import React, { useEffect, useState } from 'react';
import { Smartphone, Download, X, Share, PlusSquare } from 'lucide-react';
import { shouldOfferInstall, dismissInstall, canPromptInstall, onInstallAvailability, promptInstall, isIos, isStandalone } from '../lib/device';

/** Add-to-Home-Screen banner: mobile devices only, never on desktop, never when already installed (standalone). */
export default function InstallBanner() {
  const [show, setShow] = useState(false);
  const [canPrompt, setCanPrompt] = useState(canPromptInstall());
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const check = () => setShow(shouldOfferInstall());
    check();
    const off = onInstallAvailability(v => { setCanPrompt(v); if (!v && isStandalone()) setShow(false); });
    window.addEventListener('resize', check);
    const mq = window.matchMedia?.('(display-mode: standalone)');
    mq?.addEventListener?.('change', check);
    return () => { off(); window.removeEventListener('resize', check); mq?.removeEventListener?.('change', check); };
  }, []);
  if (!show) return null;
  const install = async () => {
    if (canPrompt) { const r = await promptInstall(); if (r === 'accepted') setShow(false); return; }
    setHelp(true);
  };
  const close = () => { dismissInstall(); setShow(false); };
  return (
    <>
      <div className="fx-a2hs" role="region" aria-label="Install app" data-testid="a2hs-banner">
        <Smartphone size={18} />
        <span>Add <strong>FindADoc</strong> to your home screen for one-tap booking</span>
        <button className="fx-a2hs-btn" onClick={install}><Download size={13} /> Install</button>
        <button className="fx-a2hs-x" onClick={close} aria-label="Dismiss"><X size={15} /></button>
      </div>
      {help && (
        <div className="fx-overlay fx-overlay-top" onClick={() => setHelp(false)}>
          <div className="fx-sheet fx-sheet-sm" role="dialog" aria-modal="true" aria-label="How to install" onClick={e => e.stopPropagation()}>
            <div className="fx-sheet-head"><h3>Add to Home Screen</h3><button className="adm-icon-btn" onClick={() => setHelp(false)} aria-label="Close"><X size={18} /></button></div>
            <div className="fx-sheet-body">
              {isIos() ? (
                <ol className="fx-steps"><li>Tap <Share size={14} /> <strong>Share</strong> in Safari's toolbar.</li><li>Choose <PlusSquare size={14} /> <strong>Add to Home Screen</strong>.</li><li>Tap <strong>Add</strong>.</li></ol>
              ) : (
                <ol className="fx-steps"><li>Open the browser menu (⋮).</li><li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Confirm.</li></ol>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
