import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import db from '../db/database';
import { authenticate, idempotencyMiddleware } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { queueNotification } from '../services/notificationService';
import { toFtsQuery } from '../utils/search';
import {
  AuthenticatedRequest,
  WorkItem,
  WorkItemStatus,
  WorkItemPriority,
  TeamRole,
  ActivityLog,
  Comment,
  User,
  STATUS_TRANSITIONS,
  ADMIN_ONLY_TRANSITIONS,
} from '../utils/types';

const router = Router();

// All work item routes require authentication
router.use(authenticate);

// ─── Status transition rules ──────────────────────────────────────────────────

// ─── Validation schemas ───────────────────────────────────────────────────────

const createWorkItemSchema = z.object({
  title: z.string().min(1, 'Title is required').max(255),
  description: z.string().max(5000).optional(),
  status: z.literal('OPEN').default('OPEN'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  team_id: z.string().uuid('Invalid team_id'),
  assignee_id: z.string().uuid('Invalid assignee_id').optional(),
  tags: z.array(z.string()).default([]),
});

const updateWorkItemSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: z
    .enum(['OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL', 'APPROVED', 'RESOLVED', 'CLOSED'])
    .optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  tags: z.array(z.string()).optional(),
  version: z.number().int().min(0, 'version is required'),
});

const assignSchema = z.object({
  assignee_id: z.string().uuid().nullable().optional(),
  version: z.number().int().min(0, 'version is required'),
});

const commentSchema = z.object({
  content: z.string().min(1, 'Content is required').max(5000),
});

const statusChangeSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL', 'APPROVED', 'RESOLVED', 'CLOSED']),
  version: z.number().int().min(0, 'version is required'),
});

const duplicateCheckSchema = z.object({
  title: z.string().min(1),
  team_id: z.string().uuid(),
});

// ─── Helper: get member role ──────────────────────────────────────────────────

function getMemberRole(teamId: string, userId: string): TeamRole | null {
  const m = db
    .prepare(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`)
    .get(teamId, userId) as { role: TeamRole } | undefined;
  return m?.role ?? null;
}

// ─── Helper: log activity ─────────────────────────────────────────────────────

interface ActivityEntry {
  workItemId: string;
  userId: string;
  action: string;
  fieldName?: string;
  oldValue?: string | null;
  newValue?: string | null;
  comment?: string | null;
}

function logActivity(entry: ActivityEntry): void {
  db.prepare(
    `INSERT INTO activity_log (id, work_item_id, user_id, action, field_name, old_value, new_value, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uuidv4(),
    entry.workItemId,
    entry.userId,
    entry.action,
    entry.fieldName ?? null,
    entry.oldValue ?? null,
    entry.newValue ?? null,
    entry.comment ?? null
  );
}

// ─── GET / ────────────────────────────────────────────────────────────────────

router.get('/', (req: AuthenticatedRequest, res: Response): void => {
  const userId = req.user!.userId;
  const {
    team_id,
    status,
    priority,
    assignee_id,
    search,
    sort_by = 'created_at',
    sort_order = 'desc',
    page = '1',
    limit = '20',
  } = req.query as Record<string, string>;

  try {
    const visibleTeams = team_id
      ? (getMemberRole(team_id, userId) ? [team_id] : null)
      : (db.prepare('SELECT team_id FROM team_members WHERE user_id = ?')
          .all(userId) as { team_id: string }[]).map((team) => team.team_id);

    if (visibleTeams === null) {
      res.status(403).json({ error: 'You are not a member of this team' });
      return;
    }
    if (visibleTeams.length === 0) {
      res.json({ items: [], total: 0, page: 1, limit: 20, total_pages: 0 });
      return;
    }

    const teamPlaceholders = visibleTeams.map(() => '?').join(',');
    const conditions: string[] = [`w.team_id IN (${teamPlaceholders})`];
    const params: (string | number)[] = [...visibleTeams];

    if (status) {
      conditions.push('w.status = ?');
      params.push(status);
    }
    if (priority) {
      conditions.push('w.priority = ?');
      params.push(priority);
    }
    if (assignee_id) {
      conditions.push('w.assignee_id = ?');
      params.push(assignee_id);
    }
    if (search) {
      const ftsQuery = toFtsQuery(search);
      if (!ftsQuery) {
        res.status(400).json({ error: 'Search must contain at least one letter or number' });
        return;
      }
      conditions.push('w.rowid IN (SELECT rowid FROM work_items_fts WHERE work_items_fts MATCH ?)');
      params.push(ftsQuery);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    // Validate sort params to prevent SQL injection
    const allowedSortBy = ['created_at', 'updated_at', 'priority', 'status', 'title'];
    const allowedSortOrder = ['asc', 'desc'];
    const safeSortBy = allowedSortBy.includes(sort_by) ? sort_by : 'created_at';
    const safeSortOrder = allowedSortOrder.includes(sort_order.toLowerCase())
      ? sort_order.toLowerCase()
      : 'desc';

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const countRow = db
      .prepare(
        `SELECT COUNT(*) as count FROM work_items w ${where}`
      )
      .get(...params) as { count: number };

    const total = countRow.count;

    const items = db
      .prepare(
        `SELECT w.*, t.name AS team_name, creator.name AS creator_name,
                assignee.name AS assignee_name
         FROM work_items w
         JOIN teams t ON t.id = w.team_id
         JOIN users creator ON creator.id = w.creator_id
         LEFT JOIN users assignee ON assignee.id = w.assignee_id
         ${where}
         ORDER BY w.${safeSortBy} ${safeSortOrder.toUpperCase()}
         LIMIT ? OFFSET ?`
      )
      .all(...params, limitNum, offset) as (WorkItem & {
        team_name: string;
        creator_name: string;
        assignee_name: string | null;
      })[];

    res.json({
      items,
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error('[work-items GET /]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST / ───────────────────────────────────────────────────────────────────

router.post('/', idempotencyMiddleware, validate(createWorkItemSchema), (req: AuthenticatedRequest, res: Response): void => {
  const body = req.body as z.infer<typeof createWorkItemSchema>;
  const userId = req.user!.userId;

  // Verify membership
  const role = getMemberRole(body.team_id, userId);
  if (!role) {
    res.status(403).json({ error: 'You are not a member of this team' });
    return;
  }
  if (role === 'VIEWER') {
    res.status(403).json({ error: 'Viewers cannot create work items' });
    return;
  }

  try {
    if (body.assignee_id) {
      const assigneeIsMember = db.prepare(
        'SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?'
      ).get(body.team_id, body.assignee_id);
      if (!assigneeIsMember) {
        res.status(422).json({ error: 'Assignee must be a member of the selected team' });
        return;
      }
    }
    const id = uuidv4();

    const item = db.transaction(() => {
      db.prepare(
        `INSERT INTO work_items (id, title, description, status, priority, team_id, creator_id, assignee_id, version, tags, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, '{}')`
      ).run(
        id,
        body.title,
        body.description ?? null,
        body.status,
        body.priority,
        body.team_id,
        userId,
        body.assignee_id ?? null,
        JSON.stringify(body.tags)
      );

      logActivity({
        workItemId: id,
        userId,
        action: 'CREATED',
        comment: `Work item created with status ${body.status} and priority ${body.priority}`,
      });

      if (body.assignee_id && body.assignee_id !== userId) {
        queueNotification(
          body.assignee_id,
          id,
          'ASSIGNED',
          `You have been assigned to work item: ${body.title}`
        );
      }

      return db.prepare('SELECT * FROM work_items WHERE id = ?').get(id) as WorkItem;
    }).immediate();

    res.status(201).json({ workItem: item });
  } catch (err) {
    console.error('[work-items POST /]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────

router.get('/:id', (req: AuthenticatedRequest, res: Response): void => {
  const { id } = req.params;
  const userId = req.user!.userId;
  const activityPage = Math.max(1, parseInt(String(req.query.activity_page ?? '1'), 10) || 1);
  const activityLimit = Math.min(100, Math.max(1, parseInt(String(req.query.activity_limit ?? '20'), 10) || 20));
  const commentPage = Math.max(1, parseInt(String(req.query.comment_page ?? '1'), 10) || 1);
  const commentLimit = Math.min(100, Math.max(1, parseInt(String(req.query.comment_limit ?? '20'), 10) || 20));

  try {
    const item = db
      .prepare(
        `SELECT w.*, t.name AS team_name, creator.name AS creator_name,
                assignee.name AS assignee_name
         FROM work_items w
         JOIN teams t ON t.id = w.team_id
         JOIN users creator ON creator.id = w.creator_id
         LEFT JOIN users assignee ON assignee.id = w.assignee_id
         WHERE w.id = ?`
      )
      .get(id) as WorkItem | undefined;

    if (!item) {
      res.status(404).json({ error: 'Work item not found' });
      return;
    }

    const role = getMemberRole(item.team_id, userId);
    if (!role) {
      res.status(403).json({ error: 'You are not a member of this team' });
      return;
    }

    const activityLog = db
      .prepare(
        `SELECT al.*, u.name as user_name
         FROM activity_log al
         JOIN users u ON u.id = al.user_id
         WHERE al.work_item_id = ?
         ORDER BY al.created_at DESC, al.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(id, activityLimit, (activityPage - 1) * activityLimit) as (ActivityLog & { user_name: string })[];

    const activityTotal = (db.prepare(
      'SELECT COUNT(*) AS count FROM activity_log WHERE work_item_id = ?'
    ).get(id) as { count: number }).count;

    const comments = db
      .prepare(
        `SELECT c.*, u.name as user_name, u.email as user_email
         FROM comments c
         JOIN users u ON u.id = c.user_id
         WHERE c.work_item_id = ?
         ORDER BY c.created_at DESC, c.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(id, commentLimit, (commentPage - 1) * commentLimit) as (Comment & { user_name: string; user_email: string })[];

    const commentTotal = (db.prepare(
      'SELECT COUNT(*) AS count FROM comments WHERE work_item_id = ?'
    ).get(id) as { count: number }).count;

    res.json({
      workItem: item,
      activityLog,
      activityPagination: {
        page: activityPage,
        limit: activityLimit,
        total: activityTotal,
        total_pages: Math.ceil(activityTotal / activityLimit),
      },
      comments: comments.reverse(),
      commentsPagination: {
        page: commentPage,
        limit: commentLimit,
        total: commentTotal,
        total_pages: Math.ceil(commentTotal / commentLimit),
      },
    });
  } catch (err) {
    console.error('[work-items GET /:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id ─────────────────────────────────────────────────────────────────

router.put('/:id', idempotencyMiddleware, validate(updateWorkItemSchema), (req: AuthenticatedRequest, res: Response): void => {
  const { id } = req.params;
  const body = req.body as z.infer<typeof updateWorkItemSchema>;
  const userId = req.user!.userId;

  try {
    // Run inside an IMMEDIATE transaction for optimistic locking
    const updateFn = db.transaction((): { status: number; body: Record<string, unknown> } => {
      const current = db
        .prepare(`SELECT * FROM work_items WHERE id = ? AND version = ?`)
        .get(id, body.version) as WorkItem | undefined;

      if (!current) {
        // Check if item exists at all
        const exists = db.prepare(`SELECT id FROM work_items WHERE id = ?`).get(id);
        if (!exists) {
          return { status: 404, body: { error: 'Work item not found' } };
        }
        return {
          status: 409,
          body: {
            error:
              'Work item has been modified by another user. Please refresh and try again.',
          },
        };
      }

      // Verify role
      const role = getMemberRole(current.team_id, userId);
      if (!role) {
        return { status: 403, body: { error: 'You are not a member of this team' } };
      }
      if (role === 'VIEWER') {
        return { status: 403, body: { error: 'Viewers cannot update work items' } };
      }
      if (
        body.status !== undefined &&
        body.status !== current.status &&
        !STATUS_TRANSITIONS[current.status].includes(body.status)
      ) {
        return {
          status: 422,
          body: { error: `Invalid status transition from ${current.status} to ${body.status}` },
        };
      }
      if (body.status && ADMIN_ONLY_TRANSITIONS[current.status]?.includes(body.status) && role !== 'ADMIN') {
        return { status: 403, body: { error: 'Only ADMINs can approve work items' } };
      }
      if (body.assignee_id) {
        const assigneeIsMember = db.prepare(
          'SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?'
        ).get(current.team_id, body.assignee_id);
        if (!assigneeIsMember) {
          return {
            status: 422,
            body: { error: 'Assignee must be a member of the work item team' },
          };
        }
      }

      // Build update fields and track changes
      const updates: string[] = [];
      const updateParams: (string | number | null)[] = [];
      const changes: { field: string; oldVal: string | null; newVal: string }[] = [];

      if (body.title !== undefined && body.title !== current.title) {
        updates.push('title = ?');
        updateParams.push(body.title);
        changes.push({ field: 'title', oldVal: current.title, newVal: body.title });
      }
      if (body.description !== undefined && body.description !== current.description) {
        updates.push('description = ?');
        updateParams.push(body.description ?? null);
        changes.push({
          field: 'description',
          oldVal: current.description,
          newVal: body.description ?? '',
        });
      }
      if (body.status !== undefined && body.status !== current.status) {
        updates.push('status = ?');
        updateParams.push(body.status);
        changes.push({ field: 'status', oldVal: current.status, newVal: body.status });
      }
      if (body.priority !== undefined && body.priority !== current.priority) {
        updates.push('priority = ?');
        updateParams.push(body.priority);
        changes.push({ field: 'priority', oldVal: current.priority, newVal: body.priority });
      }
      if (body.assignee_id !== undefined && body.assignee_id !== current.assignee_id) {
        updates.push('assignee_id = ?');
        updateParams.push(body.assignee_id ?? null);
        changes.push({
          field: 'assignee_id',
          oldVal: current.assignee_id,
          newVal: body.assignee_id ?? 'unassigned',
        });
      }
      if (body.tags !== undefined) {
        const newTags = JSON.stringify(body.tags);
        if (newTags !== current.tags) {
          updates.push('tags = ?');
          updateParams.push(newTags);
          changes.push({ field: 'tags', oldVal: current.tags, newVal: newTags });
        }
      }

      if (updates.length === 0) {
        // Nothing changed – return current item
        return { status: 200, body: { workItem: current } };
      }

      updates.push("updated_at = datetime('now')", 'version = version + 1');
      updateParams.push(id, body.version);

      const result = db
        .prepare(
          `UPDATE work_items SET ${updates.join(', ')} WHERE id = ? AND version = ?`
        )
        .run(...updateParams);

      if (result.changes === 0) {
        return {
          status: 409,
          body: {
            error:
              'Work item has been modified by another user. Please refresh and try again.',
          },
        };
      }

      // Log each change
      for (const change of changes) {
        logActivity({
          workItemId: id,
          userId,
          action: 'UPDATED',
          fieldName: change.field,
          oldValue: change.oldVal,
          newValue: change.newVal,
        });
      }

      // Notify assignee if changed
      if (
        body.assignee_id !== undefined &&
        body.assignee_id !== current.assignee_id &&
        body.assignee_id
      ) {
        queueNotification(
          body.assignee_id,
          id,
          'ASSIGNED',
          `You have been assigned to work item: ${current.title}`
        );
      }

      const updated = db
        .prepare(`SELECT * FROM work_items WHERE id = ?`)
        .get(id) as WorkItem;

      return { status: 200, body: { workItem: updated } };
    });

    const result = updateFn.immediate();
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[work-items PUT /:id]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/assign ─────────────────────────────────────────────────────────

router.post('/:id/assign', idempotencyMiddleware, validate(assignSchema), (req: AuthenticatedRequest, res: Response): void => {
  const { id } = req.params;
  const body = req.body as z.infer<typeof assignSchema>;
  const userId = req.user!.userId;

  try {
    const assignFn = db.transaction((): { status: number; body: Record<string, unknown> } => {
      const current = db
        .prepare(`SELECT * FROM work_items WHERE id = ? AND version = ?`)
        .get(id, body.version) as WorkItem | undefined;

      if (!current) {
        const exists = db.prepare(`SELECT id FROM work_items WHERE id = ?`).get(id);
        if (!exists) {
          return { status: 404, body: { error: 'Work item not found' } };
        }
        return {
          status: 409,
          body: {
            error:
              'Work item has been modified by another user. Please refresh and try again.',
          },
        };
      }

      const role = getMemberRole(current.team_id, userId);
      if (!role) {
        return { status: 403, body: { error: 'You are not a member of this team' } };
      }
      if (role === 'VIEWER') {
        return { status: 403, body: { error: 'Viewers cannot assign work items' } };
      }

      const newAssigneeId = body.assignee_id !== undefined ? body.assignee_id : userId;
      if (newAssigneeId) {
        const assigneeIsMember = db.prepare(
          'SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?'
        ).get(current.team_id, newAssigneeId);
        if (!assigneeIsMember) {
          return {
            status: 422,
            body: { error: 'Assignee must be a member of the work item team' },
          };
        }
      }

      // Prevent concurrent assignment conflict: if assigning to self and
      // item is already being worked on by someone else in IN_PROGRESS state
      if (
        newAssigneeId === userId &&
        current.assignee_id &&
        current.assignee_id !== userId &&
        current.status === 'IN_PROGRESS'
      ) {
        const assignee = db
          .prepare(`SELECT name FROM users WHERE id = ?`)
          .get(current.assignee_id) as { name: string } | undefined;
        return {
          status: 409,
          body: {
            error: `Item is already being worked on by ${assignee?.name ?? 'another user'}`,
          },
        };
      }

      // Determine new status
      let newStatus: WorkItemStatus = current.status;
      if (newAssigneeId && current.status === 'OPEN') {
        newStatus = 'IN_PROGRESS';
      } else if (!newAssigneeId && current.status === 'IN_PROGRESS') {
        newStatus = 'OPEN';
      }

      const result = db
        .prepare(
          `UPDATE work_items
           SET assignee_id = ?, status = ?, version = version + 1, updated_at = datetime('now')
           WHERE id = ? AND version = ?`
        )
        .run(newAssigneeId ?? null, newStatus, id, body.version);

      if (result.changes === 0) {
        return {
          status: 409,
          body: {
            error:
              'Work item has been modified by another user. Please refresh and try again.',
          },
        };
      }

      logActivity({
        workItemId: id,
        userId,
        action: 'ASSIGNED',
        fieldName: 'assignee_id',
        oldValue: current.assignee_id,
        newValue: newAssigneeId ?? 'unassigned',
      });

      // Notify new assignee
      if (newAssigneeId && newAssigneeId !== userId) {
        queueNotification(
          newAssigneeId,
          id,
          'ASSIGNED',
          `You have been assigned to work item: ${current.title}`
        );
      }
      // Notify old assignee they were unassigned
      if (current.assignee_id && current.assignee_id !== newAssigneeId) {
        queueNotification(
          current.assignee_id,
          id,
          'UNASSIGNED',
          `You have been unassigned from work item: ${current.title}`
        );
      }

      const updated = db
        .prepare(`SELECT * FROM work_items WHERE id = ?`)
        .get(id) as WorkItem;

      return { status: 200, body: { workItem: updated } };
    });

    const result = assignFn.immediate();
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[work-items POST /:id/assign]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/comments ───────────────────────────────────────────────────────

router.post('/:id/comments', idempotencyMiddleware, validate(commentSchema), (req: AuthenticatedRequest, res: Response): void => {
  const { id } = req.params;
  const { content } = req.body as z.infer<typeof commentSchema>;
  const userId = req.user!.userId;

  try {
    const item = db.prepare(`SELECT * FROM work_items WHERE id = ?`).get(id) as WorkItem | undefined;
    if (!item) {
      res.status(404).json({ error: 'Work item not found' });
      return;
    }

    const role = getMemberRole(item.team_id, userId);
    if (!role) {
      res.status(403).json({ error: 'You are not a member of this team' });
      return;
    }
    if (role === 'VIEWER') {
      res.status(403).json({ error: 'Viewers cannot add comments' });
      return;
    }

    const commentId = uuidv4();
    const insertComment = db.transaction(() => {
      db.prepare(
        `INSERT INTO comments (id, work_item_id, user_id, content) VALUES (?, ?, ?, ?)`
      ).run(commentId, id, userId, content);

      logActivity({
        workItemId: id,
        userId,
        action: 'COMMENTED',
        comment: content,
      });

      const notifySet = new Set<string>();
      if (item.assignee_id && item.assignee_id !== userId) notifySet.add(item.assignee_id);
      if (item.creator_id !== userId) notifySet.add(item.creator_id);
      const commenter = db.prepare('SELECT name FROM users WHERE id = ?')
        .get(userId) as { name: string } | undefined;
      for (const recipientId of notifySet) {
        queueNotification(
          recipientId,
          id,
          'COMMENT',
          `${commenter?.name ?? 'Someone'} commented on work item: ${item.title}`
        );
      }
    });
    insertComment.immediate();

    const comment = db
      .prepare(
        `SELECT c.*, u.name as user_name FROM comments c
         JOIN users u ON u.id = c.user_id WHERE c.id = ?`
      )
      .get(commentId);

    res.status(201).json({ comment });
  } catch (err) {
    console.error('[work-items POST /:id/comments]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── DELETE /:id/comments/:commentId ─────────────────────────────────────────

router.delete('/:id/comments/:commentId', idempotencyMiddleware, (req: AuthenticatedRequest, res: Response): void => {
  const { id, commentId } = req.params;
  const userId = req.user!.userId;

  try {
    const item = db.prepare(`SELECT * FROM work_items WHERE id = ?`).get(id) as WorkItem | undefined;
    if (!item) {
      res.status(404).json({ error: 'Work item not found' });
      return;
    }

    const role = getMemberRole(item.team_id, userId);
    if (!role) {
      res.status(403).json({ error: 'You are not a member of this team' });
      return;
    }

    const comment = db
      .prepare(`SELECT * FROM comments WHERE id = ? AND work_item_id = ?`)
      .get(commentId, id) as Comment | undefined;

    if (!comment) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }

    // Only own comment or ADMIN can delete
    if (comment.user_id !== userId && role !== 'ADMIN') {
      res.status(403).json({ error: 'You can only delete your own comments' });
      return;
    }

    db.prepare(`DELETE FROM comments WHERE id = ?`).run(commentId);

    logActivity({
      workItemId: id,
      userId,
      action: 'COMMENT_DELETED',
      comment: `Comment ${commentId} deleted`,
    });

    res.json({ message: 'Comment deleted successfully' });
  } catch (err) {
    console.error('[work-items DELETE /:id/comments/:commentId]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /:id/status ──────────────────────────────────────────────────────────

router.put('/:id/status', idempotencyMiddleware, validate(statusChangeSchema), (req: AuthenticatedRequest, res: Response): void => {
  const { id } = req.params;
  const { status: newStatus, version } = req.body as z.infer<typeof statusChangeSchema>;
  const userId = req.user!.userId;

  try {
    const statusFn = db.transaction((): { status: number; body: Record<string, unknown> } => {
      const current = db
        .prepare(`SELECT * FROM work_items WHERE id = ? AND version = ?`)
        .get(id, version) as WorkItem | undefined;

      if (!current) {
        const exists = db.prepare(`SELECT id FROM work_items WHERE id = ?`).get(id);
        if (!exists) {
          return { status: 404, body: { error: 'Work item not found' } };
        }
        return {
          status: 409,
          body: {
            error:
              'Work item has been modified by another user. Please refresh and try again.',
          },
        };
      }

      const role = getMemberRole(current.team_id, userId);
      if (!role) {
        return { status: 403, body: { error: 'You are not a member of this team' } };
      }
      if (role === 'VIEWER') {
        return { status: 403, body: { error: 'Viewers cannot change work item status' } };
      }

      // Validate transition
      const allowed = STATUS_TRANSITIONS[current.status];
      if (!allowed.includes(newStatus)) {
        return {
          status: 422,
          body: {
            error: `Invalid status transition from ${current.status} to ${newStatus}. Allowed: ${allowed.join(', ')}`,
          },
        };
      }

      // Only ADMIN can approve PENDING_APPROVAL items
      if (ADMIN_ONLY_TRANSITIONS[current.status]?.includes(newStatus) && role !== 'ADMIN') {
        return {
          status: 403,
          body: { error: 'Only ADMINs can approve work items' },
        };
      }

      const result = db
        .prepare(
          `UPDATE work_items
           SET status = ?, version = version + 1, updated_at = datetime('now')
           WHERE id = ? AND version = ?`
        )
        .run(newStatus, id, version);

      if (result.changes === 0) {
        return {
          status: 409,
          body: {
            error:
              'Work item has been modified by another user. Please refresh and try again.',
          },
        };
      }

      logActivity({
        workItemId: id,
        userId,
        action: 'STATUS_CHANGED',
        fieldName: 'status',
        oldValue: current.status,
        newValue: newStatus,
      });

      // Notify creator and assignee
      const notifySet = new Set<string>();
      if (current.creator_id !== userId) notifySet.add(current.creator_id);
      if (current.assignee_id && current.assignee_id !== userId)
        notifySet.add(current.assignee_id);

      for (const recipientId of notifySet) {
        queueNotification(
          recipientId,
          id,
          'STATUS_CHANGED',
          `Work item "${current.title}" status changed from ${current.status} to ${newStatus}`
        );
      }

      const updated = db
        .prepare(`SELECT * FROM work_items WHERE id = ?`)
        .get(id) as WorkItem;

      return { status: 200, body: { workItem: updated } };
    });

    const result = statusFn.immediate();
    res.status(result.status).json(result.body);
  } catch (err) {
    console.error('[work-items PUT /:id/status]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:id/duplicate-check ────────────────────────────────────────────────

router.post(
  '/:id/duplicate-check',
  idempotencyMiddleware,
  validate(duplicateCheckSchema),
  (req: AuthenticatedRequest, res: Response): void => {
    const { title, team_id } = req.body as z.infer<typeof duplicateCheckSchema>;
    const userId = req.user!.userId;

    try {
      const role = getMemberRole(team_id, userId);
      if (!role) {
        res.status(403).json({ error: 'You are not a member of this team' });
        return;
      }

      // Check for an existing item with same title in same team (case-insensitive)
      const existing = db
        .prepare(
          `SELECT id, title FROM work_items
           WHERE team_id = ? AND LOWER(title) = LOWER(?) AND status != 'CLOSED'
           LIMIT 1`
        )
        .get(team_id, title) as { id: string; title: string } | undefined;

      if (existing) {
        res.json({ isDuplicate: true, existingId: existing.id });
      } else {
        res.json({ isDuplicate: false });
      }
    } catch (err) {
      console.error('[work-items POST /:id/duplicate-check]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
