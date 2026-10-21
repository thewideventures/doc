// Background jobs (node-cron, every minute by default; SCHEDULER_CRON to change, SCHEDULER_ENABLED=false to
// disable on extra app instances). Each job is idempotent and safe to run on several instances at once
// (atomic claims / unique keys), but running the scheduler on one instance is recommended.
import cron from 'node-cron';
import { config } from './config.js';
import log from './logger.js';
import { dispatchDueMessages } from './messaging/index.js';
import { expireWaitlistOffers } from './waitlist.js';
import { expireLabHolds } from './labs.js';
import { sweepDeletions } from './privacy.js';

export const JOBS = {
  messages: () => dispatchDueMessages(),
  waitlist: () => expireWaitlistOffers(),
  labHolds: () => expireLabHolds(),
  deletions: () => sweepDeletions()
};

let running = false;
export async function runJobsOnce() {
  if (running) return;
  running = true;
  try {
    for (const [name, fn] of Object.entries(JOBS)) {
      try { await fn(); } catch (e) { log.error('Scheduled job failed', { job: name, err: e.message }); }
    }
  } finally { running = false; }
}

export function startScheduler() {
  if (!config.schedulerEnabled) { log.info('Scheduler disabled (SCHEDULER_ENABLED=false)'); return null; }
  if (!cron.validate(config.schedulerCron)) { log.error(`Invalid SCHEDULER_CRON "${config.schedulerCron}" — scheduler not started`); return null; }
  const task = cron.schedule(config.schedulerCron, runJobsOnce, { noOverlap: true, name: 'findadoc-jobs' });
  log.info(`Scheduler started (${config.schedulerCron}): reminders, waitlist offers, lab payment holds, DPDP deletions`);
  return task;
}
