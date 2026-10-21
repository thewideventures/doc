// Express application (no DB connection / listen here, so tests can mount it in-process).
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import hpp from 'hpp';
import { config } from './lib/config.js';
import log from './lib/logger.js';
import { securityHeaders, permissionsPolicy, corsMiddleware, originGuard, sanitizeRequest, responseScrubber, cspDirectives } from './lib/security.js';
import { limits, rateLimit } from './lib/rateLimit.js';
import { requireAdminAuth, adminLogin, adminRefresh, adminLogout, auditMutations } from './lib/adminAuth.js';
import { requireCsrf } from './lib/security.js';
import adminRouter from './routes/admin.js';
import legacyAdminRouter from './routes/legacyAdmin.js';
import publicRouter from './routes/public.js';
import authRouter from './routes/auth.js';
import uploadsRouter from './routes/uploads.js';
import notificationsRouter from './routes/notifications.js';
import { paymentsRouter, subscriptionsRouter, razorpayWebhook } from './routes/payments.js';
import meRouter from './routes/me.js';
import doctorPortalRouter from './routes/doctorPortal.js';
import clinicPortalRouter from './routes/clinicPortal.js';
import { UPLOAD_ROOT, PUBLIC_URL_PREFIX } from './lib/storage/index.js';
import { wrap } from './routes/common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('query parser', 'simple'); // no nested objects from the query string (?a[$ne]=x)

  app.use(securityHeaders());
  app.use(permissionsPolicy);
  app.use('/api', corsMiddleware());
  app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  // Razorpay webhook: raw body for signature verification — must be registered BEFORE the JSON parser.
  app.post('/api/payments/razorpay/webhook', rateLimit({ name: 'rzp-webhook', windowMs: 60 * 1000, max: 600 }), express.raw({ type: '*/*', limit: '512kb' }), wrap(razorpayWebhook));

  app.use('/api', limits.global());
  app.use(express.json({ limit: '100kb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '20kb', parameterLimit: 50 }));
  app.use(cookieParser());
  app.use(hpp());
  app.use('/api', sanitizeRequest);
  app.use('/api', originGuard);
  app.use('/api', responseScrubber);

  // Public uploaded files (re-encoded images). Private documents are only streamed by authorised routes.
  app.use(PUBLIC_URL_PREFIX, express.static(path.join(UPLOAD_ROOT, 'public'), {
    index: false, dotfiles: 'deny', fallthrough: false, maxAge: '30d', immutable: true,
    setHeaders: res => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"); res.setHeader('Cross-Origin-Resource-Policy', 'same-site'); }
  }));

  // ---------------------------------------------------------------- admin auth
  const adminAuthLimit = rateLimit({ name: 'admin-login', windowMs: 15 * 60 * 1000, max: 20, message: 'Too many admin login attempts from this network. Try again later.' });
  app.post('/api/admin/login', adminAuthLimit, wrap(adminLogin));
  app.post('/api/admin/auth/login', adminAuthLimit, wrap(adminLogin));
  app.post('/api/admin/auth/refresh', rateLimit({ name: 'admin-refresh', windowMs: 15 * 60 * 1000, max: 200 }), requireCsrf, wrap(adminRefresh));
  app.post('/api/admin/auth/logout', requireCsrf, wrap(adminLogout));
  app.get('/api/admin/auth/me', requireAdminAuth, (req, res) => res.json({ adminUser: { username: req.admin.username, role: req.admin.role, totp: Boolean(config.admin.totpSecret) } }));

  app.use('/api/admin', auditMutations);
  app.use('/api/specialities', auditMutations);
  app.use('/api/admin', adminRouter);
  app.use(legacyAdminRouter); // classic console endpoints under /api/admin/* and POST /api/specialities

  // ---------------------------------------------------------------- user-facing API
  app.use('/api/auth', limits.auth());
  app.use('/api/auth', authRouter);
  app.use('/api/uploads', limits.uploads(), uploadsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/payments', limits.payments(), paymentsRouter);
  app.use('/api/subscriptions', limits.payments(), subscriptionsRouter);
  app.use('/api/me', meRouter);
  app.use('/api/doctor-portal', doctorPortalRouter);
  app.use('/api/clinic-portal', clinicPortalRouter);
  app.use('/api', publicRouter);

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found', code: 'NOT_FOUND' }));

  // ---------------------------------------------------------------- built SPA (production)
  const dist = path.join(__dirname, '..', 'dist');
  if (config.serveDist && fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
    app.get(/^\/(?!api\/).*/, (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(dist, 'index.html')); });
  }

  // Body-parser / multer / unexpected errors -> JSON (no stack traces or internals in responses)
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
    if (err?.status === 404 && req.path.startsWith(PUBLIC_URL_PREFIX)) return res.status(404).json({ error: 'File not found' });
    if (err?.status && err.status < 500) return res.status(err.status).json({ error: err.expose === false ? 'Bad request' : err.message });
    log.error('Unhandled error', { method: req.method, path: req.path, err });
    res.status(500).json({ error: 'Something went wrong' });
  });
  return app;
}

export { cspDirectives };
