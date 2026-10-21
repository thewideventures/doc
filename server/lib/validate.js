// Request validation with zod. validate({ body, query, params }) replaces the parsed parts with the
// validated (and coerced / trimmed) values; unknown keys are stripped unless a schema uses .passthrough().
import { z } from 'zod';
import { isValidMobile } from './phone.js';

export { z };

export const zPhone = z.string({ error: 'Enter a valid 10-digit Indian mobile number' }).trim().max(20).refine(isValidMobile, 'Enter a valid 10-digit Indian mobile number');
export const zRole = z.enum(['patient', 'doctor', 'clinic'], { error: 'Invalid account type' });
export const zId = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_\-:.]+$/, 'Invalid id');
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date (YYYY-MM-DD)');
export const zTime = z.string().regex(/^\d{2}:\d{2}$/, 'Invalid time (HH:MM)');
export const zText = (max, min = 0) => z.string().trim().min(min).max(max);
export const zMoney = z.coerce.number().finite().min(0).max(10000000);

function firstMessage(err) {
  const i = err.issues?.[0];
  if (!i) return 'Invalid input';
  const field = i.path?.length ? i.path.join('.') : '';
  const generic = /^(Invalid input|Required|Expected)/i.test(i.message);
  return generic && field ? `Invalid value for ${field}` : i.message;
}

export function validate({ body, query, params } = {}) {
  return (req, res, next) => {
    try {
      if (params) req.params = params.parse(req.params || {});
      if (query) Object.defineProperty(req, 'query', { value: query.parse(req.query || {}), writable: true, configurable: true, enumerable: true });
      if (body) req.body = body.parse(req.body ?? {});
      next();
    } catch (e) {
      if (e instanceof z.ZodError || e?.name === 'ZodError') return res.status(400).json({ error: firstMessage(e), code: 'VALIDATION_ERROR' });
      next(e);
    }
  };
}
