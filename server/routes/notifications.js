import express from 'express';
import { Notification } from '../models/index.js';
import { requireUser } from '../lib/userAuth.js';
import { recipientFromAuth } from '../lib/notify.js';
import { parsePaging } from '../lib/http.js';
import { wrap } from './common.js';

const router = express.Router();
router.use(requireUser());

router.get('/', wrap(async (req, res) => {
  const r = recipientFromAuth(req.auth);
  const filter = { recipientType: r.type, recipientId: r.id };
  if (req.query.unread === 'true') filter.readAt = null;
  const paging = parsePaging(req.query, { defaultLimit: 20, maxLimit: 50 });
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(paging.skip).limit(paging.limit).select('-_id -__v -recipientId').lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipientType: r.type, recipientId: r.id, readAt: null })
  ]);
  res.json({ items, total, page: paging.page, limit: paging.limit, pages: Math.max(1, Math.ceil(total / paging.limit)), unread });
}));

router.post('/read-all', wrap(async (req, res) => {
  const r = recipientFromAuth(req.auth);
  const out = await Notification.updateMany({ recipientType: r.type, recipientId: r.id, readAt: null }, { readAt: new Date() });
  res.json({ success: true, updated: out.modifiedCount });
}));

router.post('/:id/read', wrap(async (req, res) => {
  const r = recipientFromAuth(req.auth);
  await Notification.updateOne({ id: req.params.id, recipientType: r.type, recipientId: r.id }, { readAt: new Date() });
  res.json({ success: true });
}));

export default router;
