import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth';
import {
  getUserNotifications,
  markNotificationRead,
  markAllRead,
} from '../services/notificationService';
import { AuthenticatedRequest } from '../utils/types';

const router = Router();

// All notification routes require authentication
router.use(authenticate);

// ─── GET / ────────────────────────────────────────────────────────────────────

/**
 * GET /api/notifications
 * Returns paginated notifications for the authenticated user.
 * Query params: page (default 1), limit (default 20)
 */
router.get('/', (req: AuthenticatedRequest, res: Response): void => {
  const userId = req.user!.userId;
  const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
  const offset = (page - 1) * limit;

  try {
    const { notifications, total } = getUserNotifications(userId, limit, offset);

    res.json({
      notifications,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error('[notifications GET /]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /read-all ────────────────────────────────────────────────────────────

/**
 * PUT /api/notifications/read-all
 * Marks all notifications for the authenticated user as read.
 * NOTE: This route must be defined BEFORE /:id/read to avoid route conflict.
 */
router.put('/read-all', (req: AuthenticatedRequest, res: Response): void => {
  const userId = req.user!.userId;

  try {
    markAllRead(userId);
    res.json({ message: 'All notifications marked as read' });
  } catch (err) {
    console.error('[notifications PUT /read-all]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id/read ────────────────────────────────────────────────────────────

/**
 * PUT /api/notifications/:id/read
 * Marks a specific notification as read (only if it belongs to the user).
 */
router.put('/:id/read', (req: AuthenticatedRequest, res: Response): void => {
  const userId = req.user!.userId;
  const { id } = req.params;

  try {
    const updated = markNotificationRead(id, userId);

    if (!updated) {
      res.status(404).json({ error: 'Notification not found' });
      return;
    }

    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    console.error('[notifications PUT /:id/read]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
