// Small fetch wrapper for the admin REST API (/api/admin/*). The access token comes from the in-memory
// admin session (admin/session.js) and is refreshed transparently via the httpOnly refresh cookie.
import { adminToken, refreshAdmin, clearAdminSession } from './session';
import { csrfToken } from '../lib/api';

export const SESSION_EXPIRED_MSG = 'Session expired, please log in again';

/** Authenticated fetch with one refresh-and-retry on 401. */
async function authedFetch(url, opts = {}) {
  const go = async token => fetch(url, { ...opts, credentials: 'same-origin', headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(opts.method && opts.method !== 'GET' ? { 'X-CSRF-Token': csrfToken() } : {}) } });
  let res = await go(await adminToken());
  if (res.status === 401) {
    const s = await refreshAdmin();
    if (s?.token) res = await go(s.token);
  }
  return res;
}
export { authedFetch as adminFetch };

/** onUnauthorized(message) is called on a final 401 so the app can show the login screen. */
// eslint-disable-next-line no-unused-vars
export function createAdminApi(_session, onUnauthorized) {
  const expired = () => { clearAdminSession({ remote: false }); onUnauthorized?.(SESSION_EXPIRED_MSG); return new Error(SESSION_EXPIRED_MSG); };
  async function request(method, path, body) {
    const res = await authedFetch(`/api/admin${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (res.status === 401) throw expired();
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  return {
    get: (path, params) => request('GET', params ? `${path}?${toQuery(params)}` : path),
    post: (path, body = {}) => request('POST', path, body),
    put: (path, body = {}) => request('PUT', path, body),
    del: (path, body) => request('DELETE', path, body),
    /** Fetch a protected file (e.g. verification document) and open it in a new tab. */
    async openFile(path) {
      const res = await authedFetch(`/api/admin${path}`);
      if (res.status === 401) throw expired();
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || 'Could not open the file'); }
      const url = URL.createObjectURL(await res.blob());
      // window.open(..., 'noopener') always returns null, so use a single anchor click instead
      const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    async download(path, params, filename) {
      const res = await authedFetch(`/api/admin${path}?${toQuery(params)}`);
      if (res.status === 401) throw expired();
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const name = (cd.match(/filename="([^"]+)"/) || [])[1] || filename || 'export.csv';
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };
}

export function toQuery(params = {}) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') q.set(k, v);
  });
  return q.toString();
}

export const inr = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
export const inr2 = n => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = d => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + ' IST' : '—');
