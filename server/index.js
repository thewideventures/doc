import 'dotenv/config';
import { config, assertConfig } from './lib/config.js';
import log from './lib/logger.js';

assertConfig(log); // exits in production when secrets / modes are unsafe

const { connectDB } = await import('./db.js');
const { createApp } = await import('./app.js');
const { releaseExpiredHolds } = await import('./lib/bookings.js');
const { sweepExpiredSubscriptions } = await import('./lib/subscriptions.js');
const { retryPendingWebhooks } = await import('./lib/payments/apply.js');

const app = createApp();

// Background sweeps: expired payment holds, expired subscriptions, webhook retries
function startSweeps() {
  const run = async () => {
    try { await releaseExpiredHolds(); } catch (e) { log.error('Hold sweep failed', { err: e.message }); }
    try { await sweepExpiredSubscriptions(); } catch (e) { log.error('Subscription sweep failed', { err: e.message }); }
    try { await retryPendingWebhooks(); } catch (e) { log.error('Webhook retry sweep failed', { err: e.message }); }
  };
  setInterval(run, 60 * 1000).unref();
  run();
}

process.on('unhandledRejection', err => log.error('Unhandled promise rejection', { err }));

await connectDB();
app.listen(config.port, () => {
  log.info(`FindADoc server listening on port ${config.port} (${config.isProd ? 'production' : 'development'})`);
  log.info(`Payments mode: ${config.payments.mode}${config.payments.mode === 'razorpay' ? ` (${config.payments.keyId.startsWith('rzp_live_') ? 'LIVE' : 'TEST'} keys, webhook secret ${config.payments.webhookSecret ? 'set' : 'MISSING'})` : ''}`);
  log.info(`OTP delivery: ${config.otp.demo ? 'DEMO MODE (fixed OTP 123456) — development only' : config.otp.provider}`);
  log.info(`Admin: password ${config.admin.passwordHash ? 'bcrypt hash' : 'plaintext (legacy)'}, 2FA ${config.admin.totpSecret ? 'on' : 'off'}`);
  if (config.otp.demo) log.warn('*** DEMO OTP IS ENABLED — anyone can sign in to any phone number with 123456. Never use this in production. ***');
});
startSweeps();
