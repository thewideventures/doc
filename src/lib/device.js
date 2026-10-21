// Device helpers for the Add-to-Home-Screen prompt (mobile only, never when already installed).
let deferredPrompt = null;
const listeners = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    listeners.forEach(fn => fn(true));
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; listeners.forEach(fn => fn(false)); });
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || window.matchMedia?.('(display-mode: fullscreen)').matches || window.navigator.standalone === true;
}

const MOBILE_UA = /Android|iPhone|iPod|iPad|Mobile|IEMobile|Opera Mini|webOS|BlackBerry/i;

/** Mobile = mobile user agent, or (touch-primary pointer AND small viewport). Desktops never qualify. */
export function isMobileDevice() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const uaMobile = navigator.userAgentData?.mobile === true || MOBILE_UA.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); // iPadOS
  const coarse = window.matchMedia?.('(pointer: coarse)').matches && (navigator.maxTouchPoints || 0) > 0;
  const small = Math.min(window.innerWidth, window.screen?.width || window.innerWidth) <= 820;
  return uaMobile || (coarse && small);
}

export const isIos = () => /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

export function canPromptInstall() { return Boolean(deferredPrompt); }
export function onInstallAvailability(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
  deferredPrompt = null;
  return choice.outcome;
}

/** Should the A2HS banner be shown at all? */
export function shouldOfferInstall() {
  if (!isMobileDevice() || isStandalone()) return false;
  const until = Number(localStorage.getItem('fad_a2hs_dismissed_until') || 0);
  return Date.now() > until;
}
export function dismissInstall(days = 14) {
  localStorage.setItem('fad_a2hs_dismissed_until', String(Date.now() + days * 86400000));
}
