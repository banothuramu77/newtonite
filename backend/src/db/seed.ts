/**
 * Seed script: populates the database with demo data.
 * Run with: npm run seed
 *
 * Clears all existing data first, then creates:
 *   - 3 users (alice, bob, charlie)
 *   - 2 teams (Engineering, Operations)
 *   - Team memberships
 *   - 10 sample work items
 *   - Activity logs for each work item
 */

import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import db from './database';

async function seed(): Promise<void> {
  console.log('🌱 Starting seed...');

  // ─── Clear existing data ─────────────────────────────────────────────────
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

  console.log('✅ Cleared existing data');

  // ─── Create users ────────────────────────────────────────────────────────
  const aliceId = uuidv4();
  const bobId = uuidv4();
  const charlieId = uuidv4();

  const passwordHash = await bcrypt.hash('password123', 12);

  const insertUser = db.prepare(
    `INSERT INTO users (id, email, name, password_hash) VALUES (?, ?, ?, ?)`
  );

  insertUser.run(aliceId, 'alice@example.com', 'Alice Johnson', passwordHash);
  insertUser.run(bobId, 'bob@example.com', 'Bob Smith', passwordHash);
  insertUser.run(charlieId, 'charlie@example.com', 'Charlie Brown', passwordHash);

  console.log('✅ Created 3 users');

  // ─── Create teams ────────────────────────────────────────────────────────
  const engTeamId = uuidv4();
  const opsTeamId = uuidv4();

  const insertTeam = db.prepare(
    `INSERT INTO teams (id, name, description) VALUES (?, ?, ?)`
  );

  insertTeam.run(engTeamId, 'Engineering', 'Software engineering team responsible for product development');
  insertTeam.run(opsTeamId, 'Operations', 'Operations team managing infrastructure and deployments');

  console.log('✅ Created 2 teams');

  // ─── Create team memberships ─────────────────────────────────────────────
  const insertMember = db.prepare(
    `INSERT INTO team_members (id, team_id, user_id, role) VALUES (?, ?, ?, ?)`
  );

  // Engineering: Alice=ADMIN, Bob=MEMBER
  insertMember.run(uuidv4(), engTeamId, aliceId, 'ADMIN');
  insertMember.run(uuidv4(), engTeamId, bobId, 'MEMBER');

  // Operations: Bob=ADMIN, Charlie=MEMBER
  insertMember.run(uuidv4(), opsTeamId, bobId, 'ADMIN');
  insertMember.run(uuidv4(), opsTeamId, charlieId, 'MEMBER');

  console.log('✅ Created team memberships');

  // ─── Helper: create work item + activity log ──────────────────────────────
  const insertWorkItem = db.prepare(
    `INSERT INTO work_items
       (id, title, description, status, priority, team_id, creator_id, assignee_id, version, tags, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, '{}')`
  );

  const insertActivity = db.prepare(
    `INSERT INTO activity_log (id, work_item_id, user_id, action, comment)
     VALUES (?, ?, ?, 'CREATED', ?)`
  );

  interface WorkItemSeed {
    title: string;
    description: string;
    status: string;
    priority: string;
    teamId: string;
    creatorId: string;
    assigneeId: string | null;
    tags: string[];
  }

  function createItem(item: WorkItemSeed): string {
    const id = uuidv4();
    insertWorkItem.run(
      id,
      item.title,
      item.description,
      item.status,
      item.priority,
      item.teamId,
      item.creatorId,
      item.assigneeId,
      JSON.stringify(item.tags)
    );
    insertActivity.run(
      uuidv4(),
      id,
      item.creatorId,
      `${item.title} created`
    );
    return id;
  }

  // Engineering work items
  createItem({
    title: 'Implement user authentication',
    description: 'Build JWT-based authentication system with refresh tokens',
    status: 'CLOSED',
    priority: 'CRITICAL',
    teamId: engTeamId,
    creatorId: aliceId,
    assigneeId: bobId,
    tags: ['auth', 'security', 'backend'],
  });

  createItem({
    title: 'Design database schema',
    description: 'Create normalized schema for the work management system',
    status: 'APPROVED',
    priority: 'HIGH',
    teamId: engTeamId,
    creatorId: aliceId,
    assigneeId: aliceId,
    tags: ['database', 'architecture'],
  });

  createItem({
    title: 'Set up CI/CD pipeline',
    description: 'Configure GitHub Actions for automated testing and deployment',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    teamId: engTeamId,
    creatorId: bobId,
    assigneeId: bobId,
    tags: ['devops', 'ci-cd'],
  });

  createItem({
    title: 'Write API documentation',
    description: 'Document all REST endpoints using OpenAPI / Swagger',
    status: 'OPEN',
    priority: 'MEDIUM',
    teamId: engTeamId,
    creatorId: aliceId,
    assigneeId: null,
    tags: ['documentation', 'api'],
  });

  createItem({
    title: 'Fix pagination bug in search results',
    description: 'Search results return incorrect total count when filtering by priority',
    status: 'PENDING_APPROVAL',
    priority: 'HIGH',
    teamId: engTeamId,
    creatorId: bobId,
    assigneeId: bobId,
    tags: ['bug', 'search', 'pagination'],
  });

  createItem({
    title: 'Upgrade Node.js to v20 LTS',
    description: 'Update runtime and all dependencies to support Node.js 20',
    status: 'RESOLVED',
    priority: 'LOW',
    teamId: engTeamId,
    creatorId: aliceId,
    assigneeId: bobId,
    tags: ['maintenance', 'upgrade'],
  });

  // Operations work items
  createItem({
    title: 'Migrate database to production',
    description: 'Execute database migration scripts on production environment with rollback plan',
    status: 'IN_PROGRESS',
    priority: 'CRITICAL',
    teamId: opsTeamId,
    creatorId: bobId,
    assigneeId: charlieId,
    tags: ['migration', 'production', 'database'],
  });

  createItem({
    title: 'Set up monitoring and alerting',
    description: 'Configure Prometheus + Grafana dashboards and PagerDuty alerts',
    status: 'OPEN',
    priority: 'HIGH',
    teamId: opsTeamId,
    creatorId: bobId,
    assigneeId: null,
    tags: ['monitoring', 'observability'],
  });

  createItem({
    title: 'Perform quarterly security audit',
    description: 'Review access controls, dependency vulnerabilities, and secrets rotation',
    status: 'OPEN',
    priority: 'MEDIUM',
    teamId: opsTeamId,
    creatorId: charlieId,
    assigneeId: charlieId,
    tags: ['security', 'audit'],
  });

  createItem({
    title: 'Optimize Docker image sizes',
    description: 'Reduce Docker image sizes using multi-stage builds and .dockerignore',
    status: 'CLOSED',
    priority: 'LOW',
    teamId: opsTeamId,
    creatorId: charlieId,
    assigneeId: bobId,
    tags: ['docker', 'optimization'],
  });

  console.log('✅ Created 10 sample work items with activity logs');
  console.log('');
  console.log('🎉 Seed completed!');
  console.log('');
  console.log('Test credentials:');
  console.log('  alice@example.com  / password123  (Engineering ADMIN)');
  console.log('  bob@example.com    / password123  (Engineering MEMBER, Operations ADMIN)');
  console.log('  charlie@example.com/ password123  (Operations MEMBER)');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
