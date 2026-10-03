import { Router, Response } from 'express';
import { authenticate } from '../middleware/auth';
import db from '../db/database';
import { AuthenticatedRequest, WorkItem } from '../utils/types';
import { toFtsQuery } from '../utils/search';

const router = Router();

// All search routes require authentication
router.use(authenticate);

// ─── GET / ────────────────────────────────────────────────────────────────────

/**
 * GET /api/search
 * Search work items across all teams the authenticated user belongs to.
 *
 * Query params:
 *   q          - Search term (matches title or description)
 *   team_ids   - Comma-separated list of team IDs to filter by
 *   statuses   - Comma-separated list of statuses to filter by
 *   priorities - Comma-separated list of priorities to filter by
 *   page       - Page number (default 1)
 *   limit      - Items per page (default 20, max 100)
 */
router.get('/', (req: AuthenticatedRequest, res: Response): void => {
  const userId = req.user!.userId;
  const {
    q,
    team_ids,
    statuses,
    priorities,
    page = '1',
    limit = '20',
  } = req.query as Record<string, string>;

  try {
    if (q && q.length > 200) {
      res.status(400).json({ error: 'Search query must be 200 characters or fewer' });
      return;
    }
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    // Get all team IDs the user belongs to
    const userTeams = db
      .prepare(
        `SELECT team_id FROM team_members WHERE user_id = ?`
      )
      .all(userId) as { team_id: string }[];

    const userTeamIds = userTeams.map((t) => t.team_id);

    if (userTeamIds.length === 0) {
      res.json({ items: [], total: 0, page: pageNum, limit: limitNum, total_pages: 0 });
      return;
    }

    // Build dynamic conditions
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    // Restrict to user's teams
    let allowedTeamIds = userTeamIds;
    if (team_ids) {
      const requested = team_ids.split(',').map((s) => s.trim()).filter(Boolean);
      // Only allow teams the user is actually in
      allowedTeamIds = requested.filter((tid) => userTeamIds.includes(tid));
    }

    if (allowedTeamIds.length === 0) {
      res.json({ items: [], total: 0, page: pageNum, limit: limitNum, total_pages: 0 });
      return;
    }

    // Placeholders for IN clause
    const teamPlaceholders = allowedTeamIds.map(() => '?').join(',');
    conditions.push(`w.team_id IN (${teamPlaceholders})`);
    params.push(...allowedTeamIds);

    if (q) {
      const ftsQuery = toFtsQuery(q);
      if (!ftsQuery) {
        res.status(400).json({ error: 'Search must contain at least one letter or number' });
        return;
      }
      conditions.push('w.rowid IN (SELECT rowid FROM work_items_fts WHERE work_items_fts MATCH ?)');
      params.push(ftsQuery);
    }

    if (statuses) {
      const statusList = statuses.split(',').map((s) => s.trim()).filter(Boolean);
      if (statusList.length > 0) {
        const placeholders = statusList.map(() => '?').join(',');
        conditions.push(`w.status IN (${placeholders})`);
        params.push(...statusList);
      }
    }

    if (priorities) {
      const priorityList = priorities.split(',').map((s) => s.trim()).filter(Boolean);
      if (priorityList.length > 0) {
        const placeholders = priorityList.map(() => '?').join(',');
        conditions.push(`w.priority IN (${placeholders})`);
        params.push(...priorityList);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = db
      .prepare(
        `SELECT COUNT(*) as count
         FROM work_items w
         ${where}`
      )
      .get(...params) as { count: number };

    const total = countRow.count;

    const items = db
      .prepare(
        `SELECT w.*, t.name as team_name
         FROM work_items w
         JOIN teams t ON t.id = w.team_id
         ${where}
         ORDER BY w.updated_at DESC, w.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limitNum, offset) as (WorkItem & { team_name: string })[];

    res.json({
      items,
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error('[search GET /]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
