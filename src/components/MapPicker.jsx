import React, { useEffect, useRef, useState } from 'react';
import { Search, LocateFixed, Loader2, MapPin } from 'lucide-react';

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
const DEFAULT_CENTER = { lat: 10.8505, lng: 76.2711 }; // Kerala
const NOMINATIM = 'https://nominatim.openstreetmap.org';

// ---------------------------------------------------------------------------
// Address normalisation (Nominatim + Google -> our address fields)
// ---------------------------------------------------------------------------
function fromNominatim(r) {
  const a = r?.address || {};
  return {
    line: [a.house_number, a.road || a.pedestrian].filter(Boolean).join(', '),
    area: a.suburb || a.neighbourhood || a.quarter || a.hamlet || '',
    city: a.city || a.town || a.village || a.municipality || '',
    district: a.state_district || a.county || '',
    state: a.state || '',
    pincode: (a.postcode || '').replace(/\D/g, '').slice(0, 6),
    formatted: r?.display_name || ''
  };
}
function fromGoogle(place) {
  const get = (...types) => (place?.address_components || place?.addressComponents || []).find(c => types.some(t => c.types.includes(t)));
  const name = c => c?.long_name || c?.longText || '';
  return {
    line: [name(get('street_number')), name(get('route'))].filter(Boolean).join(', ') || name(get('premise')),
    area: name(get('sublocality_level_1', 'sublocality', 'neighborhood')),
    city: name(get('locality', 'administrative_area_level_3')),
    district: name(get('administrative_area_level_2')),
    state: name(get('administrative_area_level_1')),
    pincode: name(get('postal_code')).replace(/\D/g, '').slice(0, 6),
    formatted: place?.formatted_address || place?.formattedAddress || ''
  };
}

// ---------------------------------------------------------------------------
// Google Maps loader (only when VITE_GOOGLE_MAPS_API_KEY is set)
// ---------------------------------------------------------------------------
let googlePromise = null;
function loadGoogle() {
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (googlePromise) return googlePromise;
  googlePromise = new Promise((resolve, reject) => {
    const cb = `__fadGmaps${Date.now()}`;
    const timer = setTimeout(() => reject(new Error('Google Maps timed out')), 12000);
    window[cb] = () => { clearTimeout(timer); resolve(window.google); delete window[cb]; };
    window.gm_authFailure = () => { clearTimeout(timer); reject(new Error('Google Maps key rejected')); };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_KEY)}&libraries=places&region=IN&loading=async&callback=${cb}`;
    s.async = true; s.defer = true;
    s.onerror = () => { clearTimeout(timer); reject(new Error('Google Maps failed to load')); };
    document.head.appendChild(s);
  }).catch(e => { googlePromise = null; throw e; });
  return googlePromise;
}

/**
 * Map location picker.
 * - Google Maps (Places autocomplete + draggable marker) when VITE_GOOGLE_MAPS_API_KEY is set
 * - otherwise (or if Google fails) Leaflet + OpenStreetMap with Nominatim search + draggable marker
 * value: { lat, lng } | null; onChange({ lat, lng }, addressFields | null)
 */
export default function MapPicker({ value, onChange, height = 280, label = 'Pin the exact location' }) {
  const [engine, setEngine] = useState(GOOGLE_KEY ? 'google' : 'leaflet');
  const [status, setStatus] = useState('loading');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const mapEl = useRef(null);
  const inputRef = useRef(null);
  const ctl = useRef({});
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const lastSearch = useRef(0);

  const reverse = async (lat, lng) => {
    try {
      if (ctl.current.geocoder) {
        const { results: r } = await ctl.current.geocoder.geocode({ location: { lat, lng } });
        return r?.[0] ? fromGoogle(r[0]) : null;
      }
      const res = await fetch(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&lat=${lat}&lon=${lng}`, { headers: { 'Accept-Language': 'en' } });
      return res.ok ? fromNominatim(await res.json()) : null;
    } catch { return null; }
  };
  const emit = async (lat, lng, address) => {
    const p = { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
    changeRef.current?.(p, address === undefined ? await reverse(p.lat, p.lng) : address);
  };

  // ---------------- init map ----------------
  useEffect(() => {
    let cancelled = false;
    const start = value?.lat ? value : DEFAULT_CENTER;
    const zoom = value?.lat ? 16 : 7;
    setStatus('loading');

    async function initGoogle() {
      const g = await loadGoogle();
      if (cancelled) return;
      const map = new g.maps.Map(mapEl.current, { center: start, zoom, mapTypeControl: false, streetViewControl: false, fullscreenControl: false, gestureHandling: 'greedy' });
      const marker = new g.maps.Marker({ position: start, map, draggable: true, visible: Boolean(value?.lat) });
      marker.addListener('dragend', () => { const p = marker.getPosition(); emit(p.lat(), p.lng()); });
      map.addListener('click', e => { marker.setPosition(e.latLng); marker.setVisible(true); emit(e.latLng.lat(), e.latLng.lng()); });
      ctl.current = {
        geocoder: new g.maps.Geocoder(),
        setPoint: (p, z = 16) => { marker.setPosition(p); marker.setVisible(true); map.setCenter(p); map.setZoom(z); }
      };
      const ac = new g.maps.places.Autocomplete(inputRef.current, { componentRestrictions: { country: 'in' }, fields: ['address_components', 'formatted_address', 'geometry', 'name'] });
      ac.addListener('place_changed', () => {
        const place = ac.getPlace();
        const loc = place?.geometry?.location;
        if (!loc) return;
        ctl.current.setPoint({ lat: loc.lat(), lng: loc.lng() }, 17);
        emit(loc.lat(), loc.lng(), fromGoogle(place));
      });
      setStatus('ready');
    }

    async function initLeaflet() {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !mapEl.current) return;
      const map = L.map(mapEl.current, { zoomControl: true, attributionControl: true }).setView([start.lat, start.lng], zoom);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      const icon = L.divIcon({ className: 'fx-pin', html: '<span></span>', iconSize: [28, 28], iconAnchor: [14, 28] });
      const marker = L.marker([start.lat, start.lng], { draggable: true, icon, keyboard: true, title: 'Drag to the exact location' });
      if (value?.lat) marker.addTo(map);
      marker.on('dragend', () => { const p = marker.getLatLng(); emit(p.lat, p.lng); });
      map.on('click', e => { marker.setLatLng(e.latlng); if (!map.hasLayer(marker)) marker.addTo(map); emit(e.latlng.lat, e.latlng.lng); });
      ctl.current = {
        geocoder: null, map,
        setPoint: (p, z = 16) => { marker.setLatLng([p.lat, p.lng]); if (!map.hasLayer(marker)) marker.addTo(map); map.setView([p.lat, p.lng], z); }
      };
      setTimeout(() => map.invalidateSize(), 150);
      setStatus('ready');
    }

    (engine === 'google' ? initGoogle() : initLeaflet()).catch(err => {
      if (cancelled) return;
      if (engine === 'google') { setError(`${err.message} — using OpenStreetMap instead.`); setEngine('leaflet'); }
      else { setStatus('error'); setError('Map could not be loaded. You can still enter the address manually.'); }
    });
    return () => {
      cancelled = true;
      try { ctl.current.map?.remove(); } catch { /* noop */ }
      ctl.current = {};
    };
  }, [engine]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- Nominatim search (Leaflet mode) ----------------
  useEffect(() => {
    if (engine !== 'leaflet') return undefined;
    const q = query.trim();
    if (q.length < 3) { setResults([]); return undefined; }
    const t = setTimeout(async () => {
      const wait = Math.max(0, 1000 - (Date.now() - lastSearch.current)); // Nominatim policy: max 1 req/s
      await new Promise(r => setTimeout(r, wait));
      lastSearch.current = Date.now();
      setSearching(true);
      try {
        const res = await fetch(`${NOMINATIM}/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=in&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'en' } });
        setResults(res.ok ? await res.json() : []);
      } catch { setResults([]); } finally { setSearching(false); }
    }, 450);
    return () => clearTimeout(t);
  }, [query, engine]);

  const choose = r => {
    const p = { lat: Number(r.lat), lng: Number(r.lon) };
    ctl.current.setPoint?.(p, 17);
    setResults([]); setQuery(r.display_name);
    emit(p.lat, p.lng, fromNominatim(r));
  };

  const locate = () => {
    if (!navigator.geolocation) { setError('Location is not available on this device.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(pos => {
      setLocating(false);
      const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      ctl.current.setPoint?.(p, 17);
      emit(p.lat, p.lng);
    }, () => { setLocating(false); setError('Could not get your location. Search or drag the pin instead.'); }, { enableHighAccuracy: true, timeout: 10000 });
  };

  return (
    <div className="fx-map" data-engine={engine}>
      <div className="fx-map-label"><MapPin size={14} /> {label} <small className="adm-muted">({engine === 'google' ? 'Google Maps' : 'OpenStreetMap'} — search, tap the map or drag the pin)</small></div>
      <div className="fx-map-search">
        <Search size={15} aria-hidden="true" />
        <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search area, landmark or address" aria-label="Search location" autoComplete="off" />
        {searching && <Loader2 size={15} className="adm-spin" />}
        <button type="button" className="adm-btn btn-secondary adm-btn-sm" onClick={locate} disabled={locating}>{locating ? <Loader2 size={14} className="adm-spin" /> : <LocateFixed size={14} />} <span>Use my location</span></button>
        {results.length > 0 && (
          <ul className="fx-map-results" role="listbox">
            {results.map(r => <li key={r.place_id}><button type="button" onClick={() => choose(r)}>{r.display_name}</button></li>)}
          </ul>
        )}
      </div>
      <div ref={mapEl} className="fx-map-canvas" style={{ height }} role="application" aria-label="Map" data-testid="map-canvas">
        {status === 'loading' && <div className="fx-map-loading"><Loader2 size={18} className="adm-spin" /> Loading map…</div>}
      </div>
      {value?.lat ? <small className="adm-muted">Pinned at {value.lat.toFixed(5)}, {value.lng.toFixed(5)}</small> : <small className="adm-muted">No pin yet.</small>}
      {error && <small className="fx-note fx-note-warn">{error}</small>}
    </div>
  );
}

export function AddressFields({ value = {}, onChange, required = true, compact }) {
  const set = (k, v) => onChange({ ...value, [k]: v });
  const F = (k, labelText, props = {}) => (
    <label className="adm-field" style={props.full ? { gridColumn: '1 / -1' } : undefined}>
      <span>{labelText}{props.req && required ? ' *' : ''}</span>
      <input value={value[k] || ''} onChange={e => set(k, k === 'pincode' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value)} inputMode={k === 'pincode' ? 'numeric' : undefined} placeholder={props.ph} autoComplete={props.ac} />
    </label>
  );
  return (
    <div className={`fx-grid ${compact ? 'fx-grid-3' : ''}`}>
      {F('line', 'Building / street', { full: true, req: true, ph: 'e.g. 2nd floor, City Plaza, MG Road', ac: 'address-line1' })}
      {F('area', 'Area / locality', { ph: 'e.g. Kakkanad' })}
      {F('landmark', 'Landmark', { ph: 'Near…' })}
      {F('city', 'City / town', { req: true, ac: 'address-level2' })}
      {F('district', 'District')}
      {F('state', 'State', { req: true, ac: 'address-level1' })}
      {F('pincode', 'PIN code', { req: true, ph: '6 digits', ac: 'postal-code' })}
    </div>
  );
}

/** Merge reverse-geocoded fields into an address without overwriting what the user typed. */
export function mergeAddress(current = {}, found) {
  if (!found) return current;
  const out = { ...current };
  for (const k of ['line', 'area', 'city', 'district', 'state', 'pincode']) if (!out[k] && found[k]) out[k] = found[k];
  if (found.formatted) out.formatted = found.formatted;
  return out;
}
