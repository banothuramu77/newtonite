import db from '../db/database';
import { v4 as uuidv4 } from 'uuid';

interface NotificationJob {
  userId: string;
  workItemId: string | null;
  type: string;
  message: string;
  retries: number;
  nextRetryAt: number;
}

const queue: NotificationJob[] = [];
const MAX_RETRIES = 3;

/**
 * Add a notification to the async processing queue.
 * This returns immediately; actual DB insert happens asynchronously.
 */
export function queueNotification(
  userId: string,
  workItemId: string | null,
  type: string,
  message: string
): void {
  queue.push({
    userId,
    workItemId,
    type,
    message,
    retries: 0,
    nextRetryAt: Date.now(),
  });
}

/**
 * Process a single notification job by inserting into the DB.
 */
async function processJob(job: NotificationJob): Promise<void> {
  db.prepare(
    `INSERT INTO notifications (id, user_id, work_item_id, type, message)
     VALUES (?, ?, ?, ?, ?)`
  ).run(uuidv4(), job.userId, job.workItemId, job.type, job.message);
}

/**
 * Main processing loop — runs every 100ms, processes all ready jobs.
 */
function processingLoop(): void {
  const now = Date.now();
  const ready: NotificationJob[] = [];
  const notReady: NotificationJob[] = [];

  for (const job of queue) {
    if (job.nextRetryAt <= now) {
      ready.push(job);
    } else {
      notReady.push(job);
    }
  }

  // Keep not-ready jobs in queue
  queue.length = 0;
  queue.push(...notReady);

  for (const job of ready) {
    processJob(job).catch((err) => {
      if (job.retries < MAX_RETRIES) {
        const backoffMs = Math.pow(2, job.retries) * 1000;
        console.error(
          `[NotificationService] Job failed (retry ${job.retries + 1}/${MAX_RETRIES}):`,
          err
        );
        queue.push({
          ...job,
          retries: job.retries + 1,
          nextRetryAt: Date.now() + backoffMs,
        });
      } else {
        console.error(
          `[NotificationService] Job permanently failed after ${MAX_RETRIES} retries:`,
          err
        );
      }
    });
  }
}

// Start the processing interval
const interval = setInterval(processingLoop, 100);

// Unref so it doesn't prevent Node.js from exiting in tests
if (interval.unref) {
  interval.unref();
}

/**
 * Get paginated notifications for a user.
 */
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
     ORDER BY n.created_at DESC
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

/**
 * Mark a specific notification as read.
 */
export function markNotificationRead(
  notificationId: string,
  userId: string
): boolean {
  const result = db.prepare(
    'UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?'
  ).run(notificationId, userId);
  return result.changes > 0;
}

/**
 * Mark all notifications for a user as read.
 */
export function markAllRead(userId: string): void {
  db.prepare(
    'UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0'
  ).run(userId);
}
