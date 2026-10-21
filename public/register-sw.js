// Service worker registration (external file so the Content-Security-Policy needs no inline scripts)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => console.log('SW registration note:', err));
  });
}
