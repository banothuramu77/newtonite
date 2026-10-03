import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';
import app from '../src';
import db from '../src/db/database';
import { generateToken } from '../src/utils/jwt';

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
});
