import { Notification } from '../models/index.js';

/**
 * Create in-app notifications. Never throws (notifications must not break the main action).
 * to: [{ type: 'patient'|'doctor'|'clinic'|'admin', id }]
 */
export async function notify(to, { type = 'info', title, body = '', link = '', data = {} }) {
  try {
    const list = (Array.isArray(to) ? to : [to]).filter(r => r && r.type && r.id);
    const seen = new Set();
    const docs = [];
    for (const r of list) {
      const k = `${r.type}:${r.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      docs.push({
        id: `ntf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        recipientType: r.type, recipientId: r.id, type, title: String(title).slice(0, 160), body: String(body).slice(0, 600), link, data
      });
    }
    if (docs.length) await Notification.insertMany(docs, { ordered: false });
  } catch (err) {
    console.error('Notification error:', err.message);
  }
}

export function recipientFromAuth(auth) {
  if (!auth) return null;
  if (auth.role === 'doctor') return { type: 'doctor', id: auth.doctor.id };
  if (auth.role === 'clinic') return { type: 'clinic', id: auth.clinic.id };
  return { type: 'patient', id: auth.uid };
}
