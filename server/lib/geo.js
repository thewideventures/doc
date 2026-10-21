// Geo + address helpers. Points are GeoJSON: { type: 'Point', coordinates: [lng, lat] }.
const num = v => (v === null || v === undefined || v === '' ? NaN : Number(v));

export function toPoint(lat, lng) {
  const la = num(lat), lo = num(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180 || (la === 0 && lo === 0)) return undefined;
  return { type: 'Point', coordinates: [Math.round(lo * 1e6) / 1e6, Math.round(la * 1e6) / 1e6] };
}

export function latLng(point) {
  const c = point?.coordinates;
  return Array.isArray(c) && c.length === 2 ? { lat: c[1], lng: c[0] } : null;
}

export function haversineKm(a, b) {
  if (!a || !b) return null;
  const R = 6371, rad = d => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)) * 10) / 10;
}

const clip = (v, n = 160) => String(v ?? '').trim().slice(0, n);

export function normalizeAddress(a = {}) {
  const out = {
    line: clip(a.line, 200), area: clip(a.area), city: clip(a.city, 80), district: clip(a.district, 80),
    state: clip(a.state, 80), pincode: clip(a.pincode, 10).replace(/[^0-9]/g, ''), landmark: clip(a.landmark), formatted: clip(a.formatted, 300)
  };
  if (out.pincode && !/^\d{6}$/.test(out.pincode)) throw Object.assign(new Error('PIN code must be 6 digits'), { status: 400 });
  return out;
}

export function formatAddress(a = {}) {
  if (!a) return '';
  const parts = [a.line, a.area, a.city, a.district && a.district !== a.city ? a.district : '', a.state].filter(Boolean);
  const s = parts.join(', ');
  return a.pincode ? `${s}${s ? ' - ' : ''}${a.pincode}` : s || a.formatted || '';
}

export function directionsUrl(point) {
  const p = latLng(point);
  return p ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}` : '';
}
