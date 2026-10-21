// Client API helpers for patient / doctor / clinic sessions.
// Security model: the short-lived access token lives ONLY in memory (never localStorage); a rotating httpOnly
// refresh cookie restores the session on reload (POST /api/auth/refresh, CSRF double-submit header).
// localStorage keeps just a "was signed in" hint per role — no token, no PII.
const HINT = { patient: 'fad_patient_hint', doctor: 'fad_doctor_hint', clinic: 'fad_clinic_hint' };
const LEGACY = { patient: ['fad_patient_session', 'fad_patient_user'], doctor: ['fad_doctor_session'], clinic: ['fad_clinic_session'] };
export const SESSION_EXPIRED_MSG = 'Session expired, please log in again';

const mem = {}; // role -> { token, exp, user, role, doctor?, clinic? }
const listeners = new Set();
export const onSessionChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = role => listeners.forEach(fn => { try { fn(role, mem[role] || null); } catch { /* ignore */ } });

function safeLocal(fn) { try { return fn(); } catch { return null; } }
function jwtExpMs(token) {
  try { const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return p.exp ? p.exp * 1000 : 0; } catch { return 0; }
}
export function csrfToken() {
  const m = document.cookie.match(/(?:^|;\s*)fad_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/** Current in-memory session (token may be near expiry — clients refresh automatically). */
export function getSession(role) {
  const s = mem[role];
  return s?.token ? s : null;
}
export function setSession(role, data = {}) {
  const next = { ...(mem[role] || {}), ...data, role };
  if (data.token) next.exp = jwtExpMs(data.token) || Date.now() + (data.expiresIn || 900) * 1000;
  mem[role] = next;
  safeLocal(() => { localStorage.setItem(HINT[role], '1'); (LEGACY[role] || []).forEach(k => localStorage.removeItem(k)); });
  emit(role);
  return next;
}
/** Drop the session locally; remote=true also revokes it on the server (logout). */
export function clearSession(role, { remote = true } = {}) {
  const had = mem[role];
  delete mem[role];
  safeLocal(() => { localStorage.removeItem(HINT[role]); (LEGACY[role] || []).forEach(k => localStorage.removeItem(k)); });
  if (remote) {
    fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken(), ...(had?.token ? { Authorization: `Bearer ${had.token}` } : {}) }, body: JSON.stringify({ role }) }).catch(() => {});
  }
  emit(role);
}

const inflight = {};
/** Rotate the refresh cookie -> new access token. Resolves to the session or null (signed out). */
export function refreshSession(role) {
  if (inflight[role]) return inflight[role];
  inflight[role] = (async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() }, body: JSON.stringify({ role }) });
      } catch { return getSession(role); } // offline: keep what we have
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.token) {
        return setSession(role, { token: data.token, expiresIn: data.expiresIn, user: data.user, ...(data.doctor ? { doctor: data.doctor } : {}), ...(data.clinic ? { clinic: data.clinic } : {}) });
      }
      if (res.status === 409 && data.code === 'REFRESH_RACE') { await new Promise(r => setTimeout(r, 400)); continue; }
      clearSession(role, { remote: false });
      if (res.status === 403 && data.code) { const e = new ApiError(data.error || 'Account blocked', 403, data.code, data); e.blocked = true; throw e; }
      return null;
    }
    return getSession(role);
  })().finally(() => { delete inflight[role]; });
  return inflight[role];
}

export const hasSessionHint = role => Boolean(safeLocal(() => localStorage.getItem(HINT[role])));

/** On app start: restore any session whose hint exists (one refresh call per signed-in role). */
export async function restoreSessions(roles = ['patient', 'doctor', 'clinic']) {
  await Promise.all(roles.filter(hasSessionHint).map(r => refreshSession(r).catch(() => null)));
}

// proactive refresh shortly before the access token expires
setInterval(() => {
  for (const role of Object.keys(mem)) {
    const s = mem[role];
    if (s?.token && s.exp && s.exp - Date.now() < 90 * 1000 && document.visibilityState === 'visible') refreshSession(role).catch(() => {});
  }
}, 30 * 1000);

async function freshToken(role) {
  let s = getSession(role);
  if (s && s.exp && s.exp - Date.now() < 20 * 1000) s = await refreshSession(role).catch(() => null);
  return s?.token || '';
}

export class ApiError extends Error {
  constructor(message, status, code, data) { super(message); this.status = status; this.code = code; this.data = data; }
}

/** fetch wrapper. opts: { method, body, token, form, signal } */
export async function apiFetch(path, { method = 'GET', body, token, form, signal } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !form) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = csrfToken();
  let res;
  try {
    res = await fetch(path.startsWith('/api') ? path : `/api${path}`, { method, headers, credentials: 'same-origin', body: form || (body !== undefined ? JSON.stringify(body) : undefined), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError('Network error — please check your connection and try again.', 0, 'NETWORK');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.code, data);
  return data;
}

export function toQuery(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
  const s = q.toString();
  return s ? `?${s}` : '';
}

/**
 * Role-scoped client compatible with admin/ui useAdminList (get(path, params)).
 * Refreshes the access token transparently; on a final 401 it clears the session and calls onExpired(message).
 */
export function createClient(role, { prefix = '', onExpired, onBlocked } = {}) {
  async function withAuth(run) {
    const had = Boolean(getSession(role));
    const token = await freshToken(role);
    try {
      return await run(token);
    } catch (e) {
      if (e.status === 401 && e.code !== 'PHONE_NOT_VERIFIED' && had) {
        const s = await refreshSession(role).catch(err => { if (err.blocked) { onBlocked?.(err.message); } return null; });
        if (s?.token) return run(s.token);
      }
      if (e.status === 401 && e.code !== 'PHONE_NOT_VERIFIED') {
        clearSession(role, { remote: false });
        onExpired?.(SESSION_EXPIRED_MSG);
        throw new ApiError(SESSION_EXPIRED_MSG, 401, 'SESSION_EXPIRED');
      }
      if (e.status === 403 && ['ACCOUNT_SUSPENDED', 'ACCOUNT_DELETED'].includes(e.code)) {
        clearSession(role, { remote: false });
        onBlocked?.(e.message);
      }
      throw e;
    }
  }
  const req = (method, path, { body, form, params } = {}) => withAuth(token => apiFetch(`${prefix}${path}${params ? toQuery(params) : ''}`, { method, body, form, token }));
  return {
    get: (path, params) => req('GET', path, { params }),
    post: (path, body = {}) => req('POST', path, { body }),
    put: (path, body = {}) => req('PUT', path, { body }),
    del: (path, body) => req('DELETE', path, { body }),
    /** upload(fileOrBlob, { purpose, docType }, filename) */
    upload: (file, fields = {}, filename) => withAuth(token => {
      const f = new FormData();
      Object.entries(fields).forEach(([k, v]) => v !== undefined && f.append(k, v));
      f.append('file', file, filename || file.name || 'upload');
      return apiFetch('/api/uploads', { method: 'POST', form: f, token });
    }),
    /** Multipart upload to a specific endpoint (e.g. /me/records/upload). */
    uploadTo: (path, file, fields = {}, filename) => withAuth(token => {
      const f = new FormData();
      Object.entries(fields).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && f.append(k, v));
      f.append('file', file, filename || file.name || 'upload');
      return apiFetch(`${prefix}${path}`, { method: 'POST', form: f, token });
    }),
    /** Authenticated binary download (private documents) -> Blob */
    blob: path => withAuth(async token => {
      const res = await fetch(path.startsWith('/api') ? path : `/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'same-origin' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(d.error || 'Could not open the file', res.status, d.code, d); }
      return res.blob();
    })
  };
}

export const inr = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const fmtDate = d => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' }) : '—');
export const fmtDateLong = d => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtTime = t => {
  if (!/^\d{2}:\d{2}$/.test(t || '')) return t || '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);

export const LOCATION_KIND_LABEL = { clinic: 'Clinic', own_clinic: 'Own clinic', hospital: 'Hospital', home_visit: 'Home visit', online: 'Online consult' };
export const MODE_LABEL = { free: 'Free booking · pay at clinic', paid: 'Pay full fee online', token: 'Booking amount online · rest at clinic', offline: 'Booked at clinic', legacy: 'Paid online' };
export const MODE_SHORT = { free: 'Free booking', paid: 'Prepaid', token: 'Booking amount', offline: 'Walk-in', legacy: 'Paid' };
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
