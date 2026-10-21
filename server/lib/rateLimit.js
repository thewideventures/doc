// Rate limiting on top of express-rate-limit (in-memory store; swap in a Redis store for multi-instance deployments).
// The client IP comes from req.ip, which honours the TRUST_PROXY hop count (never a blindly trusted X-Forwarded-For).
import { rateLimit as erl, ipKeyGenerator } from 'express-rate-limit';

export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

const ipKey = req => ipKeyGenerator(clientIp(req)); // IPv6 addresses are grouped by /56

/**
 * rateLimit({ name, windowMs, max, key: req => string, message, skipSuccessful })
 * key defaults to client IP. Several limiters can be chained on one route.
 */
export function rateLimit({ name, windowMs, max, key, message, skipSuccessful = false }) {
  return erl({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: skipSuccessful,
    keyGenerator: req => `${name}:${(key ? key(req) : ipKey(req)) || 'anon'}`,
    validate: { keyGeneratorIpFallback: false, trustProxy: false, xForwardedForHeader: false },
    handler: (req, res, next, opts) => {
      const retry = Math.max(1, Math.ceil((req.rateLimit.resetTime ? req.rateLimit.resetTime.getTime() - Date.now() : opts.windowMs) / 1000));
      res.setHeader('Retry-After', retry);
      res.status(429).json({ error: message || `Too many requests. Please try again in ${Math.ceil(retry / 60)} minute(s).`, code: 'RATE_LIMITED', retryAfter: retry });
    }
  });
}

export const phoneKey = req => String(req.body?.phone || '').replace(/\D/g, '').slice(-10);
export const userKey = req => req.auth?.uid || ipKey(req);

// Shared limiter tiers
export const limits = {
  global: () => rateLimit({ name: 'global', windowMs: 15 * 60 * 1000, max: Number(process.env.RATE_LIMIT_GLOBAL || 1500) }),
  auth: () => rateLimit({ name: 'auth', windowMs: 15 * 60 * 1000, max: 100, message: 'Too many sign-in attempts. Please wait a few minutes.' }),
  payments: () => rateLimit({ name: 'payments-ip', windowMs: 15 * 60 * 1000, max: 120 }),
  uploads: () => rateLimit({ name: 'uploads-ip', windowMs: 60 * 60 * 1000, max: 120, message: 'Upload limit reached. Please try again later.' })
};
