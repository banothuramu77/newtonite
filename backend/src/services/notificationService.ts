import db from '../db/database';
import { v4 as uuidv4 } from 'uuid';

interface NotificationJob {
  id: string;
  user_id: string;
  work_item_id: string | null;
  type: string;
  message: string;
  attempts: number;
}

const MAX_ATTEMPTS = 5;
const LEASE_SECONDS = 30;
const POLL_INTERVAL_MS = 1000;
const MAX_JOBS_PER_POLL = 50;
let workerRunning = false;
let worker: NodeJS.Timeout | undefined;

export function queueNotification(
  userId: string,
  workItemId: string | null,
  type: string,
  message: string
): void {
  db.prepare(
    `INSERT INTO notification_jobs (id, user_id, work_item_id, type, message)
     VALUES (?, ?, ?, ?, ?)`
  ).run(uuidv4(), userId, workItemId, type, message);
}

function claimNextJob(): NotificationJob | undefined {
  const claim = db.transaction(() => {
    db.prepare(
      `UPDATE notification_jobs
       SET state = 'FAILED', locked_until = NULL,
           last_error = coalesce(last_error, 'Worker lease expired on final attempt')
       WHERE state = 'PROCESSING' AND attempts >= ?
         AND locked_until <= datetime('now')`
    ).run(MAX_ATTEMPTS);

    const job = db.prepare(
      `SELECT id, user_id, work_item_id, type, message, attempts
       FROM notification_jobs
       WHERE attempts < ?
         AND (
           (state = 'PENDING' AND available_at <= datetime('now'))
           OR (state = 'PROCESSING' AND locked_until <= datetime('now'))
         )
       ORDER BY created_at ASC
       LIMIT 1`
    ).get(MAX_ATTEMPTS) as NotificationJob | undefined;

    if (!job) return undefined;

    db.prepare(
      `UPDATE notification_jobs
       SET state = 'PROCESSING', attempts = attempts + 1,
           locked_until = datetime('now', ?)
       WHERE id = ?`
    ).run(`+${LEASE_SECONDS} seconds`, job.id);

    return { ...job, attempts: job.attempts + 1 };
  });
  return claim.immediate();
}

function deliverJob(job: NotificationJob): void {
  const deliver = db.transaction(() => {
    db.prepare(
      `INSERT INTO notifications (id, user_id, work_item_id, type, message)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    ).run(job.id, job.user_id, job.work_item_id, job.type, job.message);

    db.prepare(
      `UPDATE notification_jobs
       SET state = 'COMPLETED', completed_at = datetime('now'),
           locked_until = NULL, last_error = NULL
       WHERE id = ?`
    ).run(job.id);
  });
  deliver.immediate();
}

function rescheduleJob(job: NotificationJob, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const retryDelaySeconds = Math.min(300, 2 ** (job.attempts - 1));
  const retry = db.prepare(
    `UPDATE notification_jobs
     SET state = ?, available_at = datetime('now', ?), locked_until = NULL,
         last_error = ?
     WHERE id = ?`
  );

  if (job.attempts >= MAX_ATTEMPTS) {
    retry.run('FAILED', '+0 seconds', message.slice(0, 1000), job.id);
    console.error(`[NotificationService] Job ${job.id} failed permanently`, error);
    return;
  }

  retry.run(
    'PENDING',
    `+${retryDelaySeconds} seconds`,
    message.slice(0, 1000),
    job.id
  );
  console.error(
    `[NotificationService] Job ${job.id} failed on attempt ${job.attempts}; retrying`,
    error
  );
}

export function processNextNotificationJob(): boolean {
  const job = claimNextJob();
  if (!job) return false;

  try {
    deliverJob(job);
  } catch (error) {
    rescheduleJob(job, error);
  }
  return true;
}

export function startNotificationWorker(): void {
  if (worker) return;
  worker = setInterval(() => {
    if (workerRunning) return;
    workerRunning = true;
    try {
      for (let processed = 0; processed < MAX_JOBS_PER_POLL; processed += 1) {
        if (!processNextNotificationJob()) break;
      }
    } catch (error) {
      console.error('[NotificationService] Worker iteration failed', error);
    } finally {
      workerRunning = false;
    }
  }, POLL_INTERVAL_MS);
  worker.unref();
}

export function getUserNotifications(
  userId: string,
  limit = 20,
  offset = 0
): {
  notifications: unknown[];
  total: number;
  unreadCount: number;
} {
  const notifications = db.prepare(
    `SELECT n.*, wi.title as work_item_title
     FROM notifications n
     LEFT JOIN work_items wi ON n.work_item_id = wi.id
     WHERE n.user_id = ?
     ORDER BY n.created_at DESC, n.id DESC
     LIMIT ? OFFSET ?`
  ).all(userId, limit, offset);

  const { total } = db.prepare(
    'SELECT COUNT(*) as total FROM notifications WHERE user_id = ?'
  ).get(userId) as { total: number };

  const { unreadCount } = db.prepare(
    'SELECT COUNT(*) as unreadCount FROM notifications WHERE user_id = ? AND read = 0'
  ).get(userId) as { unreadCount: number };

  return { notifications, total, unreadCount };
}

export function markNotificationRead(
  notificationId: string,
  userId: string
): boolean {
  const result = db.prepare(
    'UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?'
  ).run(notificationId, userId);
  return result.changes > 0;
}

export function markAllRead(userId: string): void {
  db.prepare(
    'UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0'
  ).run(userId);
}
