import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import db from '../db/database';
import { generateToken } from '../utils/jwt';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { AuthenticatedRequest, User } from '../utils/types';

const router = Router();

// ─── Validation schemas ───────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(1, 'Name is required').max(100),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const updateMeSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

// ─── POST /register ───────────────────────────────────────────────────────────

router.post('/register', validate(registerSchema), async (req, res): Promise<void> => {
  const { email, name, password } = req.body as z.infer<typeof registerSchema>;

  try {
    // Check for duplicate email
    const existing = db
      .prepare(`SELECT id FROM users WHERE email = ?`)
      .get(email.toLowerCase());

    if (existing) {
      res.status(409).json({ error: 'Email is already registered' });
      return;
    }

    const password_hash = await bcrypt.hash(password, 12);
    const id = uuidv4();

    db.prepare(
      `INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)`
    ).run(id, email.toLowerCase(), name, password_hash);

    const user = db
      .prepare(`SELECT id, email, name, created_at, updated_at FROM users WHERE id = ?`)
      .get(id) as Omit<User, 'password_hash'>;

    const token = generateToken({ userId: id, email: user.email });

    res.status(201).json({ token, user });
  } catch (err) {
    console.error('[auth/register]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /login ──────────────────────────────────────────────────────────────

router.post('/login', validate(loginSchema), async (req, res): Promise<void> => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;

  try {
    const user = db
      .prepare(`SELECT * FROM users WHERE email = ?`)
      .get(email.toLowerCase()) as User | undefined;

    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const token = generateToken({ userId: user.id, email: user.email });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        created_at: user.created_at,
        updated_at: user.updated_at,
      },
    });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /me ──────────────────────────────────────────────────────────────────

router.get('/me', authenticate, (req: AuthenticatedRequest, res: Response): void => {
  try {
    const user = db
      .prepare(
        `SELECT id, email, name, created_at, updated_at FROM users WHERE id = ?`
      )
      .get(req.user!.userId) as Omit<User, 'password_hash'> | undefined;

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user });
  } catch (err) {
    console.error('[auth/me]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── PUT /me ──────────────────────────────────────────────────────────────────

router.put(
  '/me',
  authenticate,
  validate(updateMeSchema),
  (req: AuthenticatedRequest, res: Response): void => {
    const { name } = req.body as z.infer<typeof updateMeSchema>;

    try {
      if (name !== undefined) {
        db.prepare(
          `UPDATE users SET name = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(name, req.user!.userId);
      }

      const user = db
        .prepare(
          `SELECT id, email, name, created_at, updated_at FROM users WHERE id = ?`
        )
        .get(req.user!.userId) as Omit<User, 'password_hash'> | undefined;

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      res.json({ user });
    } catch (err) {
      console.error('[auth/me PUT]', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export default router;
