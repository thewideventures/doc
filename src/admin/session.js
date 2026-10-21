// Admin session: access token in memory only; rotating httpOnly refresh cookie (path /api/admin/auth).
// sessionStorage keeps only a "signed in in this tab" hint (no token).
import { csrfToken } from '../lib/api';

const HINT = 'fad_admin_hint';
let state = null; // { token, exp, username }
let inflight = null;

function jwtExpMs(token) {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch { return Date.now() + 5 * 60000; }
}
const hint = { get: () => { try { return sessionStorage.getItem(HINT); } catch { return null; } }, set: v => { try { v ? sessionStorage.setItem(HINT, '1') : sessionStorage.removeItem(HINT); ['fad_admin_token', 'fad_admin_user'].forEach(k => sessionStorage.removeItem(k)); } catch { /* ignore */ } } };

export function setAdminSession(token, username) {
  state = { token, exp: jwtExpMs(token), username: username || state?.username || 'admin' };
  hint.set(true);
  return state;
}
export const adminSession = () => state;
export const hasAdminHint = () => Boolean(hint.get());

export function clearAdminSession({ remote = true } = {}) {
  const had = state;
  state = null; hint.set(false);
  if (remote) fetch('/api/admin/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken(), ...(had?.token ? { Authorization: `Bearer ${had.token}` } : {}) }, body: '{}' }).catch(() => {});
}

export function refreshAdmin() {
  if (inflight) return inflight;
  inflight = (async () => {
    for (let i = 0; i < 3; i++) {
      let res;
      try { res = await fetch('/api/admin/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() }, body: '{}' }); }
      catch { return state; }
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.adminToken) return setAdminSession(d.adminToken, d.adminUser?.username);
      if (res.status === 409) { await new Promise(r => setTimeout(r, 400)); continue; }
      state = null; hint.set(false);
      return null;
    }
    return state;
  })().finally(() => { inflight = null; });
  return inflight;
}

/** Valid access token (refreshing when close to expiry), or '' when signed out. */
export async function adminToken() {
  if (state && state.exp - Date.now() < 30 * 1000) await refreshAdmin();
  return state?.token || '';
}

setInterval(() => { if (state && state.exp - Date.now() < 90 * 1000 && document.visibilityState === 'visible') refreshAdmin(); }, 30 * 1000);
