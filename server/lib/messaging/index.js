// Outbound patient messages. Everything goes through ScheduledMessage rows so sends are durable, de-duplicated
// (dedupeKey), retried with backoff and auditable. In-app notifications are always delivered; WhatsApp / SMS
// only when the patient opted in (notificationPrefs + Consent record) and the channel is configured.
import crypto from 'crypto';
import { ScheduledMessage, User } from '../../models/index.js';
import { notify } from '../notify.js';
import { render } from './templates.js';
import { sendWhatsApp, whatsappConfigured } from './whatsapp.js';
import { sendNotificationSms, reminderSmsConfigured } from '../sms/index.js';
import log from '../logger.js';

const MAX_ATTEMPTS = 4;
const mid = () => `msg-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;

/** Queue (or schedule) a message. Returns the row, or null when the dedupeKey already exists. */
export async function queueMessage({ kind, userId = '', phone = '', bookingId = '', refId = '', lang, params = {}, sendAt = new Date(), dedupeKey }) {
  if (!dedupeKey) dedupeKey = `${kind}:${refId || bookingId}:${sendAt.getTime()}`;
  let language = lang;
  if (!language && userId) language = (await User.findOne({ id: userId }).select('preferredLanguage').lean())?.preferredLanguage;
  try {
    return await ScheduledMessage.create({ id: mid(), dedupeKey, kind, userId, phone, bookingId, refId, lang: language || 'en', params, sendAt });
  } catch (e) {
    if (e?.code === 11000) return null;
    throw e;
  }
}

export async function cancelMessages(filter) {
  const r = await ScheduledMessage.updateMany({ ...filter, status: 'pending' }, { $set: { status: 'cancelled' } });
  return r.modifiedCount;
}

async function deliver(msg) {
  const user = msg.userId ? await User.findOne({ id: msg.userId }).select('id phone notificationPrefs status anonymisedAt preferredLanguage').lean() : null;
  if (msg.userId && (!user || user.anonymisedAt || user.status === 'deleted')) return { status: 'skipped', channels: [] };
  const phone = msg.phone || user?.phone || '';
  const { title, body } = render(msg.kind, msg.lang || user?.preferredLanguage || 'en', msg.params || {});
  const channels = [];
  if (user) {
    await notify({ type: 'patient', id: user.id }, { type: 'reminder', title, body, data: { bookingId: msg.bookingId || undefined, refId: msg.refId || undefined, kind: msg.kind } });
    channels.push({ channel: 'inapp', status: 'sent', at: new Date() });
  }
  // Medicine reminders carry their own per-prescription channel opt-in
  const prefs = msg.kind === 'medicine' ? { whatsapp: Boolean(msg.params?._wa), sms: Boolean(msg.params?._sms) } : (user?.notificationPrefs || {});
  let transientError = null;
  if (phone && prefs.whatsapp && whatsappConfigured()) {
    try { channels.push({ channel: 'whatsapp', status: 'sent', providerId: String(await sendWhatsApp({ phone, kind: msg.kind, lang: msg.lang, params: msg.params, text: body }) || ''), at: new Date() }); }
    catch (e) { channels.push({ channel: 'whatsapp', status: 'failed', error: e.message.slice(0, 200), at: new Date() }); if (!e.permanent) transientError = e; }
  }
  if (phone && prefs.sms && reminderSmsConfigured()) {
    try { await sendNotificationSms(phone, `FindADoc: ${body}`); channels.push({ channel: 'sms', status: 'sent', at: new Date() }); }
    catch (e) { channels.push({ channel: 'sms', status: 'failed', error: e.message.slice(0, 200), at: new Date() }); if (!e.permanent) transientError = e; }
  }
  return { status: channels.some(c => c.status === 'sent') ? 'sent' : (transientError ? 'retry' : 'skipped'), channels, error: transientError?.message };
}

/** Send everything due. Each row is claimed atomically (pending -> sending) so parallel workers never double-send. */
export async function dispatchDueMessages({ limit = 100 } = {}) {
  let sent = 0;
  // Rows stuck in "sending" (crash mid-send) go back to pending after 10 minutes
  await ScheduledMessage.updateMany({ status: 'sending', updatedAt: { $lt: new Date(Date.now() - 10 * 60000) } }, { $set: { status: 'pending' } });
  for (let i = 0; i < limit; i++) {
    const msg = await ScheduledMessage.findOneAndUpdate(
      { status: 'pending', sendAt: { $lte: new Date() } },
      { $set: { status: 'sending' }, $inc: { attempts: 1 } },
      { sort: { sendAt: 1 }, new: true }
    );
    if (!msg) break;
    try {
      const r = await deliver(msg);
      if (r.status === 'retry' && msg.attempts < MAX_ATTEMPTS) {
        await ScheduledMessage.updateOne({ id: msg.id }, { $set: { status: 'pending', sendAt: new Date(Date.now() + msg.attempts * 5 * 60000), lastError: r.error || '', channels: r.channels } });
      } else {
        await ScheduledMessage.updateOne({ id: msg.id }, { $set: { status: r.status === 'retry' ? 'failed' : r.status, channels: r.channels, sentAt: new Date(), lastError: r.error || '' } });
        if (r.status === 'sent') sent++;
      }
    } catch (e) {
      log.error('Message dispatch failed', { id: msg.id, kind: msg.kind, err: e.message });
      await ScheduledMessage.updateOne({ id: msg.id }, { $set: { status: msg.attempts < MAX_ATTEMPTS ? 'pending' : 'failed', sendAt: new Date(Date.now() + 5 * 60000), lastError: e.message.slice(0, 200) } });
    }
  }
  return sent;
}
