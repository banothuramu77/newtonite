import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import db from '../db/database';
import { authenticate, requireRole } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { queueNotification } from '../services/notificationService';
import { AuthenticatedRequest, Team, TeamMember, User, TeamRole } from '../utils/types';

const router = Router();

// All team routes require authentication
router.use(authenticate);

// ─── Validation schemas ───────────────────────────────────────────────────────

const createTeamSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
});

const addMemberSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
});

const updateRoleSchema = z.object({
  role: z.enum(['ADMIN', 'MEMBER', 'VIEWER']),
});

// ─── POST / ───────────────────────────────────────────────────────────────────

router.post('/', validate(createTeamSchema), (req: AuthenticatedRequest, res: Response): void => {
  const { name, description } = req.body as z.infer<typeof createTeamSchema>;
  const userId = req.user!.userId;

  try {
    const teamId = uuidv4();
    const memberId = uuidv4();

    const insertTeam = db.transaction(() => {
      db.prepare(
        `INSERT INTO teams (id, name, description) VALUES (?, ?, ?)`
      ).run(teamId, name, description ?? null);

      db.prepare(
        `INSERT INTO team_members (id, team_id, user_id, role) VALUES (?, ?, ?, 'ADMIN')`
      ).run(memberId, teamId, userId);
    });

    insertTeam();

    const team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId) as Team;
    res.status(201).json({ team });
  } catch (err) {
    console.error('[teams POST /]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET / ────────────────────────────────────────────────────────────────────

router.get('/', (req: AuthenticatedRequest, res: Response): void => {
  const userId = req.user!.userId;

  try {
    const teams = db
      .prepare(
        `SELECT t.*, tm.role AS my_role
         FROM teams t
         JOIN team_members tm ON tm.team_id = t.id
         WHERE tm.user_id = ?
         ORDER BY t.created_at DESC`
      )
      .all(userId) as (Team & { my_role: TeamRole })[];

    res.json({ teams });
  } catch (err) {
    console.error('[teams GET /]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /:teamId ─────────────────────────────────────────────────────────────

router.get('/:teamId', (req: AuthenticatedRequest, res: Response): void => {
  const { teamId } = req.params;
  const userId = req.user!.userId;

  try {
    // Verify membership
    const membership = db
      .prepare(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`)
      .get(teamId, userId) as { role: TeamRole } | undefined;

    if (!membership) {
      res.status(403).json({ error: 'You are not a member of this team' });
      return;
    }

    const team = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId) as Team | undefined;
    if (!team) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    // Get members with user info
    const members = db
      .prepare(
        `SELECT tm.id, tm.team_id, tm.user_id, tm.role, tm.joined_at,
                u.email, u.name
         FROM team_members tm
         JOIN users u ON u.id = tm.user_id
         WHERE tm.team_id = ?
         ORDER BY tm.joined_at ASC`
      )
      .all(teamId) as (TeamMember & { email: string; name: string })[];

    res.json({ team, members });
  } catch (err) {
    console.error('[teams GET /:teamId]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /:teamId/members ────────────────────────────────────────────────────

router.post(
  '/:teamId/members',
  requireRole('ADMIN'),
  validate(addMemberSchema),
  (req: AuthenticatedRequest, res: Response): void => {
    const { teamId } = req.params;
    const { userId, role } = req.body as z.infer<typeof addMemberSchema>;

    try {
      // Verify target user exists
      const targetUser = db
        .prepare(`SELECT id, name, email FROM users WHERE id = ?`)
        .get(userId) as Pick<User, 'id' | 'name' | 'email'> | undefined;

      if (!targetUser) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const memberId = uuidv4();
      try {
        db.prepare(
          `INSERT INTO team_members (id, team_id, user_id, role) VALUES (?, ?, ?, ?)`
        ).run(memberId, teamId, userId, role);
      } catch (err: unknown) {
        const sqliteErr = err as { code?: string };
        if (sqliteErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          res.status(409).json({ error: 'User is already a member of this team' });
          return;
        }
        throw err;
      }

      const member = db
        .prepare(
          `SELECT tm.*, u.email, u.name
           FROM team_members tm
           JOIN users u ON u.id = tm.user_id
           WHERE tm.id = ?`
        )
        .get(memberId);

      // Notify the added user
      const team = db.prepare(`SELECT name FROM teams WHERE id = ?`).get(teamId) as { name: string } | undefined;
      queueNotification(
        userId,
        null,
        'TEAM_ADDED',
        `You have been added to team "${team?.name ?? teamId}" as ${role}`
      );

      res.status(201).json({ member });
    } catch (err) {
      console.error('[teams POST /:teamId/members]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── DELETE /:teamId/members/:userId ─────────────────────────────────────────

router.delete(
  '/:teamId/members/:userId',
  requireRole('ADMIN'),
  (req: AuthenticatedRequest, res: Response): void => {
    const { teamId, userId } = req.params;

    try {
      // Prevent removing the last ADMIN
      const adminCount = (
        db
          .prepare(
            `SELECT COUNT(*) as count FROM team_members WHERE team_id = ? AND role = 'ADMIN'`
          )
          .get(teamId) as { count: number }
      ).count;

      const targetMember = db
        .prepare(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`)
        .get(teamId, userId) as { role: TeamRole } | undefined;

      if (!targetMember) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }

      if (targetMember.role === 'ADMIN' && adminCount <= 1) {
        res.status(400).json({ error: 'Cannot remove the last ADMIN from the team' });
        return;
      }

      db.prepare(
        `DELETE FROM team_members WHERE team_id = ? AND user_id = ?`
      ).run(teamId, userId);

      res.json({ message: 'Member removed successfully' });
    } catch (err) {
      console.error('[teams DELETE /:teamId/members/:userId]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── PUT /:teamId/members/:userId ─────────────────────────────────────────────

router.put(
  '/:teamId/members/:userId',
  requireRole('ADMIN'),
  validate(updateRoleSchema),
  (req: AuthenticatedRequest, res: Response): void => {
    const { teamId, userId } = req.params;
    const { role } = req.body as z.infer<typeof updateRoleSchema>;

    try {
      const member = db
        .prepare(`SELECT id FROM team_members WHERE team_id = ? AND user_id = ?`)
        .get(teamId, userId);

      if (!member) {
        res.status(404).json({ error: 'Member not found' });
        return;
      }

      // Prevent removing last admin if demoting
      if (role !== 'ADMIN') {
        const adminCount = (
          db
            .prepare(
              `SELECT COUNT(*) as count FROM team_members WHERE team_id = ? AND role = 'ADMIN'`
            )
            .get(teamId) as { count: number }
        ).count;

        const currentRole = (
          db
            .prepare(`SELECT role FROM team_members WHERE team_id = ? AND user_id = ?`)
            .get(teamId, userId) as { role: TeamRole }
        ).role;

        if (currentRole === 'ADMIN' && adminCount <= 1) {
          res.status(400).json({ error: 'Cannot demote the last ADMIN' });
          return;
        }
      }

      db.prepare(
        `UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?`
      ).run(role, teamId, userId);

      const updated = db
        .prepare(
          `SELECT tm.*, u.email, u.name
           FROM team_members tm
           JOIN users u ON u.id = tm.user_id
           WHERE tm.team_id = ? AND tm.user_id = ?`
        )
        .get(teamId, userId);

      res.json({ member: updated });
    } catch (err) {
      console.error('[teams PUT /:teamId/members/:userId]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
