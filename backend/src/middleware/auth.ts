import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { AuthenticatedRequest, TeamRole, hasMinimumRole } from '../utils/types';
import db from '../db/database';

/**
 * Authenticate middleware: verifies JWT and attaches user to request.
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyToken(token);
    const userExists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(payload.userId);
    if (!userExists) {
      res.status(401).json({ error: 'Account no longer exists. Please sign in again.' });
      return;
    }
    (req as AuthenticatedRequest).user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * requireRole middleware factory: ensures the authenticated user has at least
 * the specified role in the team. Team ID is sourced from req.params.teamId,
 * req.body.team_id, or resolved from the work item's team.
 */
export function requireRole(requiredRole: TeamRole) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const teamId =
      req.params.teamId ||
      req.body.team_id;

    if (!teamId) {
      // Will be enforced by individual route handlers
      next();
      return;
    }

    try {
      const member = db.prepare(
        'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?'
      ).get(teamId, authReq.user.userId) as { role: TeamRole } | undefined;

      if (!member) {
        res.status(403).json({ error: 'You are not a member of this team' });
        return;
      }

      if (!hasMinimumRole(member.role, requiredRole)) {
        res.status(403).json({
          error: `This action requires ${requiredRole} role or higher`,
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Idempotency middleware: caches responses by X-Idempotency-Key header.
 * If the same key is seen again, returns the cached response without
 * re-executing the handler. This prevents duplicate operations when
 * clients retry on network failures.
 */
export function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const requestKey = req.headers['x-idempotency-key'];
  if (requestKey === undefined) {
    next();
    return;
  }
  if (Array.isArray(requestKey) || requestKey.length > 200) {
    res.status(400).json({ error: 'Invalid idempotency key' });
    return;
  }

  try {
    const key = `${(req as AuthenticatedRequest).user!.userId}:${req.method}:${req.baseUrl}${req.path}:${requestKey}`;
    // Check for existing cached response
    const cached = db.prepare(
      'SELECT response_status, response_body FROM idempotency_keys WHERE key = ?'
    ).get(key) as { response_status: number; response_body: string } | undefined;

    if (cached) {
      res.status(cached.response_status).json(JSON.parse(cached.response_body));
      return;
    }

    // Attach key to request for use after response
    (req as AuthenticatedRequest).idempotencyKey = key;

    // Intercept response to cache it
    const originalJson = res.json.bind(res);
    res.json = (body: unknown): Response => {
      if (res.statusCode >= 200 && res.statusCode < 500) {
        try {
        db.prepare(
          `INSERT OR IGNORE INTO idempotency_keys (key, response_status, response_body)
           VALUES (?, ?, ?)`
        ).run(key, res.statusCode, JSON.stringify(body));
        } catch (err) {
          console.error('[idempotency cache]', err);
        }
      }
      return originalJson(body);
    };

    next();
  } catch (err) {
    next(err);
  }
}
