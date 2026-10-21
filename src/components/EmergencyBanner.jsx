import React, { useEffect, useRef, useState } from 'react';
import { PhoneCall, ShieldAlert, MapPin, Navigation, Loader2, X, Hospital } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useT } from '../i18n';

const km = d => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`);

/**
 * Full-screen emergency banner shown when triage detects a red flag.
 * Big tap targets for 108 / 112 (and Tele-MANAS 14416 for self-harm), plus nearest 24x7 hospitals.
 */
export default function EmergencyBanner({ redFlags = [], numbers = [], userLocation, onClose }) {
  const t = useT();
  const [loc, setLoc] = useState(userLocation || null);
  const [state, setState] = useState('idle'); // idle | locating | loading | done | denied | error
  const [data, setData] = useState(null);
  const callRef = useRef(null);

  useEffect(() => { callRef.current?.focus(); }, []);
  useEffect(() => {
    if (!loc) return;
    setState('loading');
    apiFetch(`/api/emergency/hospitals?lat=${loc.lat}&lng=${loc.lng}`)
      .then(r => { setData(r); setState('done'); })
      .catch(() => setState('error'));
  }, [loc]);

  const locate = () => {
    if (!navigator.geolocation) { setState('denied'); return; }
    setState('locating');
    navigator.geolocation.getCurrentPosition(
      p => setLoc({ lat: Math.round(p.coords.latitude * 1e4) / 1e4, lng: Math.round(p.coords.longitude * 1e4) / 1e4 }),
      () => setState('denied'), { timeout: 10000, maximumAge: 300000 });
  };
  const nums = numbers.length ? numbers : [{ id: 'ambulance', number: '108' }, { id: 'emergency', number: '112' }];
  const mapsSearch = data?.mapsSearchUrl || 'https://www.google.com/maps/search/?api=1&query=hospital%20emergency%20near%20me';

  return (
    <div className="fx-emerg" role="alertdialog" aria-modal="true" aria-labelledby="emerg-title" aria-describedby="emerg-desc" data-testid="emergency-banner">
      <div className="fx-emerg-inner">
        <div className="fx-emerg-head">
          <ShieldAlert size={34} aria-hidden="true" />
          <div>
            <h2 id="emerg-title">{t('emerg.title')}</h2>
            <p id="emerg-desc">{t('emerg.body')}</p>
          </div>
        </div>
        {redFlags.length > 0 && (
          <ul className="fx-emerg-flags" aria-label={t('emerg.flags')}>
            {redFlags.map(f => <li key={f.id}>{t(`flag.${f.id}`)}</li>)}
          </ul>
        )}
        <div className="fx-emerg-calls">
          {nums.map((n, i) => (
            <a key={n.id} ref={i === 0 ? callRef : undefined} href={`tel:${n.number}`} className={`fx-emerg-call ${n.id === 'telemanas' ? 'alt' : ''}`} data-testid={`call-${n.number}`}>
              <PhoneCall size={22} aria-hidden="true" />
              <span><strong>{t('emerg.call', { number: n.number })}</strong><small>{t(`emerg.num.${n.id}`)}</small></span>
            </a>
          ))}
        </div>

        <section className="fx-emerg-hosp" aria-label={t('emerg.nearest')}>
          <h3><Hospital size={18} /> {t('emerg.nearest')}</h3>
          {!loc && state !== 'locating' && (
            <button type="button" className="adm-btn btn-secondary" onClick={locate}><MapPin size={15} /> {t('emerg.useLocation')}</button>
          )}
          {(state === 'locating' || state === 'loading') && <p><Loader2 size={15} className="adm-spin" /> {t('emerg.searching')}</p>}
          {state === 'denied' && <p className="adm-small">{t('emerg.locationDenied')}</p>}
          {state === 'done' && data?.hospitals?.length === 0 && <p className="adm-small">{t('emerg.noneListed')}</p>}
          {state === 'done' && data?.hospitals?.length > 0 && (
            <ul className="fx-emerg-list">
              {data.hospitals.map(h => (
                <li key={h.id}>
                  <div><strong>{h.name}</strong><small>{h.address}{' • '}{km(h.distanceKm)}{h.is24x7 ? ` • ${t('emerg.open24')}` : ''}</small></div>
                  <div className="fx-row">
                    {h.phone && <a className="adm-btn adm-btn-sm adm-btn-danger" href={`tel:${h.phone}`} aria-label={t('emerg.callHospital', { name: h.name })}><PhoneCall size={14} /></a>}
                    <a className="adm-btn adm-btn-sm btn-secondary" href={h.directionsUrl} target="_blank" rel="noopener noreferrer" aria-label={t('emerg.directionsTo', { name: h.name })}><Navigation size={14} /></a>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <a className="adm-link" href={mapsSearch} target="_blank" rel="noopener noreferrer"><MapPin size={13} /> {t('emerg.openMaps')}</a>
        </section>

        <p className="fx-emerg-disc">{t('ai.disclaimer')}</p>
        <button type="button" className="fx-emerg-close" onClick={onClose} data-testid="emergency-close"><X size={15} /> {t('emerg.close')}</button>
      </div>
    </div>
  );
}
