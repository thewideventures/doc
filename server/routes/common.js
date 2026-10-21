// Shared helpers for route modules.
import log from '../lib/logger.js';

export const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(err => {
  if (res.headersSent) return;
  if (err?.status && err.status < 500) {
    if (err.retryAfter) res.setHeader('Retry-After', err.retryAfter);
    return res.status(err.status).json({ error: err.message, code: err.code, ...(err.reason ? { reason: err.reason } : {}) });
  }
  if (err?.status && err.status >= 500 && err.expose !== false) return res.status(err.status).json({ error: err.message, code: err.code });
  if (err?.name === 'ZodError') return res.status(400).json({ error: err.issues?.[0]?.message || 'Invalid input', code: 'VALIDATION_ERROR' });
  if (err?.name === 'ValidationError') return res.status(400).json({ error: Object.values(err.errors || {})[0]?.message || 'Invalid input', code: 'VALIDATION_ERROR' });
  if (err?.name === 'CastError') return res.status(400).json({ error: 'Invalid input', code: 'VALIDATION_ERROR' });
  log.error('API error', { method: req.method, path: req.originalUrl.split('?')[0], err });
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

export const str = (v, n = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').trim().slice(0, n);
export const strList = (v, n = 20, len = 60) => [...new Set((Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(x => str(x, len)).filter(Boolean))].slice(0, n);
export const bad = (msg, code) => Object.assign(new Error(msg), { status: 400, code });
