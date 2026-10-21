// Tiny in-process hook bus so booking state changes can drive reminders, waitlist offers and queues
// without circular imports. Listeners are awaited; a failing listener is logged and never breaks the caller.
import log from './logger.js';

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export async function emit(event, payload) {
  for (const fn of listeners.get(event) || []) {
    try { await fn(payload); } catch (e) { log.error('Event listener failed', { event, err: e.message }); }
  }
}
