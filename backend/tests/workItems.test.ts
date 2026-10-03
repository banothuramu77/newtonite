import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import app from '../src';
import db from '../src/db/database';
import { assertJwtSecretConfigured, generateToken } from '../src/utils/jwt';
import {
  processNextNotificationJob,
  queueNotification,
} from '../src/services/notificationService';

const adminId = '00000000-0000-4000-8000-000000000001';
const memberId = '00000000-0000-4000-8000-000000000002';
const outsiderId = '00000000-0000-4000-8000-000000000003';
const teamId = '00000000-0000-4000-8000-000000000010';
const outsiderTeamId = '00000000-0000-4000-8000-000000000011';

function bearer(userId: string, email: string): string {
  return `Bearer ${generateToken({ userId, email })}`;
}

function addWorkItem(id = uuidv4()): string {
  db.prepare(
    `INSERT INTO work_items
      (id, title, status, priority, team_id, creator_id, version, tags, metadata)
     VALUES (?, 'Investigate incident', 'OPEN', 'HIGH', ?, ?, 0, '[]', '{}')`
  ).run(id, teamId, adminId);
  return id;
}

beforeEach(() => {
  db.exec(`
    DELETE FROM idempotency_keys;
    DELETE FROM notification_jobs;
    DELETE FROM notifications;
    DELETE FROM comments;
    DELETE FROM activity_log;
    DELETE FROM work_items;
    DELETE FROM team_members;
    DELETE FROM teams;
    DELETE FROM users;
  `);
  const addUser = db.prepare(
    'INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)'
  );
  addUser.run(adminId, 'admin@example.com', 'Admin User', 'test');
  addUser.run(memberId, 'member@example.com', 'Member User', 'test');
  addUser.run(outsiderId, 'outsider@example.com', 'Outside User', 'test');
  db.prepare('INSERT INTO teams (id, name) VALUES (?, ?)').run(teamId, 'Operations');
  db.prepare('INSERT INTO teams (id, name) VALUES (?, ?)').run(outsiderTeamId, 'Other');
  const addMember = db.prepare(
    'INSERT INTO team_members (id, team_id, user_id, role) VALUES (?, ?, ?, ?)'
  );
  addMember.run(uuidv4(), teamId, adminId, 'ADMIN');
  addMember.run(uuidv4(), teamId, memberId, 'MEMBER');
  addMember.run(uuidv4(), outsiderTeamId, outsiderId, 'ADMIN');
});

afterAll(() => {
  db.close();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('work item correctness guarantees', () => {
  it('scopes item reads to team membership', async () => {
    const id = addWorkItem();
    const response = await request(app)
      .get(`/api/work-items/${id}`)
      .set('Authorization', bearer(outsiderId, 'outsider@example.com'));

    expect(response.status).toBe(403);
  });

  it('rejects a valid JWT when its user account no longer exists', async () => {
    const deletedUserId = '00000000-0000-4000-8000-000000000099';
    const response = await request(app)
      .get('/api/teams')
      .set('Authorization', bearer(deletedUserId, 'deleted@example.com'));

    expect(response.status).toBe(401);
    expect(response.body.error).toMatch(/Account no longer exists/);
  });

  it('requires a strong JWT secret in production', () => {
    const originalMode = process.env.NODE_ENV;
    const originalSecret = process.env.JWT_SECRET;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.JWT_SECRET;
      expect(() => assertJwtSecretConfigured()).toThrow(/JWT_SECRET must be configured/);

      process.env.JWT_SECRET = 'short-secret';
      expect(() => assertJwtSecretConfigured()).toThrow(/at least 32 characters/);

      process.env.JWT_SECRET = 'a-production-signing-secret-with-at-least-32-characters';
      expect(() => assertJwtSecretConfigured()).not.toThrow();
    } finally {
      process.env.NODE_ENV = originalMode;
      if (originalSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = originalSecret;
    }
  });

  it('rejects stale edits rather than overwriting a newer version', async () => {
    const id = addWorkItem();
    const first = await request(app)
      .put(`/api/work-items/${id}`)
      .set('Authorization', bearer(memberId, 'member@example.com'))
      .send({ title: 'Updated once', version: 0 });
    const stale = await request(app)
      .put(`/api/work-items/${id}`)
      .set('Authorization', bearer(adminId, 'admin@example.com'))
      .send({ title: 'Stale overwrite', version: 0 });

    expect(first.status).toBe(200);
    expect(first.body.workItem.version).toBe(1);
    expect(stale.status).toBe(409);
    expect(db.prepare('SELECT title FROM work_items WHERE id = ?').get(id)).toEqual({
      title: 'Updated once',
    });
  });

  it('enforces the status workflow through both update endpoints', async () => {
    const id = addWorkItem();
    const genericUpdate = await request(app)
      .put(`/api/work-items/${id}`)
      .set('Authorization', bearer(adminId, 'admin@example.com'))
      .send({ status: 'APPROVED', version: 0 });
    const statusUpdate = await request(app)
      .put(`/api/work-items/${id}/status`)
      .set('Authorization', bearer(adminId, 'admin@example.com'))
      .send({ status: 'APPROVED', version: 0 });

    expect(genericUpdate.status).toBe(422);
    expect(statusUpdate.status).toBe(422);
    expect(db.prepare('SELECT status FROM work_items WHERE id = ?').get(id)).toEqual({
      status: 'OPEN',
    });
  });

  it('requires a team admin to approve an item pending approval', async () => {
    const id = addWorkItem();
    db.prepare("UPDATE work_items SET status = 'PENDING_APPROVAL' WHERE id = ?").run(id);
    const memberAttempt = await request(app)
      .put(`/api/work-items/${id}/status`)
      .set('Authorization', bearer(memberId, 'member@example.com'))
      .send({ status: 'APPROVED', version: 0 });
    const adminAttempt = await request(app)
      .put(`/api/work-items/${id}/status`)
      .set('Authorization', bearer(adminId, 'admin@example.com'))
      .send({ status: 'APPROVED', version: 0 });

    expect(memberAttempt.status).toBe(403);
    expect(adminAttempt.status).toBe(200);
    expect(adminAttempt.body.workItem.status).toBe('APPROVED');
  });

  it('does not allow assigning an item to a user outside its team', async () => {
    const id = addWorkItem();
    const response = await request(app)
      .post(`/api/work-items/${id}/assign`)
      .set('Authorization', bearer(memberId, 'member@example.com'))
      .send({ assignee_id: outsiderId, version: 0 });

    expect(response.status).toBe(422);
    expect(db.prepare('SELECT assignee_id, version FROM work_items WHERE id = ?').get(id)).toEqual({
      assignee_id: null,
      version: 0,
    });
  });

  it('allows only one claimant to win when two users claim the same version', async () => {
    const id = addWorkItem();
    const [memberClaim, adminClaim] = await Promise.all([
      request(app)
        .post(`/api/work-items/${id}/assign`)
        .set('Authorization', bearer(memberId, 'member@example.com'))
        .send({ assignee_id: memberId, version: 0 }),
      request(app)
        .post(`/api/work-items/${id}/assign`)
        .set('Authorization', bearer(adminId, 'admin@example.com'))
        .send({ assignee_id: adminId, version: 0 }),
    ]);

    expect([memberClaim.status, adminClaim.status].sort()).toEqual([200, 409]);
    const item = db.prepare('SELECT assignee_id, status, version FROM work_items WHERE id = ?').get(id) as {
      assignee_id: string;
      status: string;
      version: number;
    };
    expect([memberId, adminId]).toContain(item.assignee_id);
    expect(item.status).toBe('IN_PROGRESS');
    expect(item.version).toBe(1);
  });

  it('replays idempotent create requests without creating duplicate items', async () => {
    const headers = {
      Authorization: bearer(memberId, 'member@example.com'),
      'X-Idempotency-Key': 'create-this-once',
    };
    const body = { title: 'Investigate duplicate payment', team_id: teamId };
    const first = await request(app).post('/api/work-items').set(headers).send(body);
    const retry = await request(app).post('/api/work-items').set(headers).send(body);
    const count = db.prepare('SELECT COUNT(*) AS count FROM work_items').get() as { count: number };

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.workItem.id).toBe(first.body.workItem.id);
    expect(count.count).toBe(1);
  });

  it('keeps idempotency responses isolated between users', async () => {
    const first = await request(app)
      .post('/api/work-items')
      .set('Authorization', bearer(memberId, 'member@example.com'))
      .set('X-Idempotency-Key', 'same-client-key')
      .send({ title: 'Member request', team_id: teamId });
    const second = await request(app)
      .post('/api/work-items')
      .set('Authorization', bearer(adminId, 'admin@example.com'))
      .set('X-Idempotency-Key', 'same-client-key')
      .send({ title: 'Admin request', team_id: teamId });
    const count = db.prepare('SELECT COUNT(*) AS count FROM work_items').get() as { count: number };

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.workItem.id).not.toBe(first.body.workItem.id);
    expect(count.count).toBe(2);
  });

  it('performs indexed full-text search and updates the index with item edits', async () => {
    const id = addWorkItem();
    db.prepare(
      `UPDATE work_items SET title = ?, description = ? WHERE id = ?`
    ).run('Catastrophic gateway outage', 'Production payment processing unavailable', id);

    const match = await request(app)
      .get('/api/search?q=catastrophic+payment')
      .set('Authorization', bearer(memberId, 'member@example.com'));
    const oldTerm = await request(app)
      .get('/api/search?q=investigate')
      .set('Authorization', bearer(memberId, 'member@example.com'));

    expect(match.status).toBe(200);
    expect(match.body.total).toBe(1);
    expect(match.body.items[0].id).toBe(id);
    expect(oldTerm.body.total).toBe(0);

    db.prepare('DELETE FROM work_items WHERE id = ?').run(id);
    const deletedTerm = await request(app)
      .get('/api/search?q=catastrophic')
      .set('Authorization', bearer(memberId, 'member@example.com'));
    expect(deletedTerm.body.total).toBe(0);
  });

  it('paginates activity history and comments instead of returning all rows', async () => {
    const id = addWorkItem();
    const insertActivity = db.prepare(
      `INSERT INTO activity_log (id, work_item_id, user_id, action)
       VALUES (?, ?, ?, 'UPDATED')`
    );
    const insertComment = db.prepare(
      `INSERT INTO comments (id, work_item_id, user_id, content) VALUES (?, ?, ?, ?)`
    );
    for (let index = 0; index < 25; index += 1) {
      insertActivity.run(uuidv4(), id, adminId);
      insertComment.run(uuidv4(), id, adminId, `comment-${index}`);
    }

    const response = await request(app)
      .get(`/api/work-items/${id}?activity_page=2&activity_limit=10&comment_page=2&comment_limit=10`)
      .set('Authorization', bearer(memberId, 'member@example.com'));

    expect(response.status).toBe(200);
    expect(response.body.activityLog).toHaveLength(10);
    expect(response.body.activityPagination).toEqual({
      page: 2,
      limit: 10,
      total: 25,
      total_pages: 3,
    });
    expect(response.body.comments).toHaveLength(10);
    expect(response.body.commentsPagination).toEqual({
      page: 2,
      limit: 10,
      total: 25,
      total_pages: 3,
    });
  });

  it('persists notification jobs and delivers each job only once', () => {
    const itemId = addWorkItem();
    queueNotification(memberId, itemId, 'ASSIGNED', 'An item was assigned to you');
    const queued = db.prepare(
      `SELECT id, state FROM notification_jobs WHERE user_id = ?`
    ).get(memberId) as { id: string; state: string };

    expect(queued.state).toBe('PENDING');
    expect(processNextNotificationJob()).toBe(true);
    expect(processNextNotificationJob()).toBe(false);
    expect(db.prepare('SELECT id FROM notifications WHERE id = ?').get(queued.id)).toEqual({
      id: queued.id,
    });
    expect(db.prepare('SELECT state FROM notification_jobs WHERE id = ?').get(queued.id)).toEqual({
      state: 'COMPLETED',
    });
  });

  it('rolls back work-item creation when its notification cannot be queued', async () => {
    db.exec(`
      CREATE TRIGGER reject_notification_job BEFORE INSERT ON notification_jobs
      BEGIN SELECT RAISE(FAIL, 'queue unavailable'); END;
    `);
    jest.spyOn(console, 'error').mockImplementation(() => {});

    const response = await request(app)
      .post('/api/work-items')
      .set('Authorization', bearer(adminId, 'admin@example.com'))
      .send({
        title: 'Atomic outbox test',
        team_id: teamId,
        assignee_id: memberId,
      });

    db.exec('DROP TRIGGER reject_notification_job');
    expect(response.status).toBe(500);
    expect(db.prepare("SELECT COUNT(*) AS count FROM work_items WHERE title = 'Atomic outbox test'").get())
      .toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM activity_log').get())
      .toEqual({ count: 0 });
  });

  it('marks an expired final-attempt notification lease as failed', () => {
    const itemId = addWorkItem();
    queueNotification(memberId, itemId, 'ASSIGNED', 'Final attempt expired');
    const job = db.prepare(
      'SELECT id FROM notification_jobs WHERE user_id = ?'
    ).get(memberId) as { id: string };
    db.prepare(
      `UPDATE notification_jobs
       SET state = 'PROCESSING', attempts = 5, locked_until = datetime('now', '-1 minute')
       WHERE id = ?`
    ).run(job.id);

    expect(processNextNotificationJob()).toBe(false);
    expect(db.prepare('SELECT state, attempts FROM notification_jobs WHERE id = ?').get(job.id)).toEqual({
      state: 'FAILED',
      attempts: 5,
    });
  });

  it('retries durable notification jobs after a processing failure', () => {
    const itemId = addWorkItem();
    queueNotification(memberId, itemId, 'ASSIGNED', 'Retry this notification');
    const job = db.prepare(
      'SELECT id FROM notification_jobs WHERE user_id = ?'
    ).get(memberId) as { id: string };
    db.exec(`
      CREATE TRIGGER reject_notification_insert BEFORE INSERT ON notifications
      BEGIN SELECT RAISE(FAIL, 'temporary notification failure'); END;
    `);
    jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(processNextNotificationJob()).toBe(true);
    expect(db.prepare('SELECT state, attempts FROM notification_jobs WHERE id = ?').get(job.id)).toEqual({
      state: 'PENDING',
      attempts: 1,
    });

    db.exec('DROP TRIGGER reject_notification_insert');
    db.prepare(
      `UPDATE notification_jobs SET available_at = datetime('now') WHERE id = ?`
    ).run(job.id);
    expect(processNextNotificationJob()).toBe(true);
    expect(db.prepare('SELECT state, attempts FROM notification_jobs WHERE id = ?').get(job.id)).toEqual({
      state: 'COMPLETED',
      attempts: 2,
    });
  });
});
