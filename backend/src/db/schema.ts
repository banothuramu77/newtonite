import Database from 'better-sqlite3';

export function initializeDatabase(db: Database.Database): void {
  // Enable WAL mode for concurrent reads
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 30000000000');

  const hadWorkItemFts = Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'work_items_fts'").get()
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'MEMBER' CHECK(role IN ('ADMIN', 'MEMBER', 'VIEWER')),
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(team_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS work_items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN'
        CHECK(status IN ('OPEN', 'IN_PROGRESS', 'PENDING_APPROVAL', 'APPROVED', 'RESOLVED', 'CLOSED')),
      priority TEXT NOT NULL DEFAULT 'MEDIUM'
        CHECK(priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE RESTRICT,
      creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      version INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      action TEXT NOT NULL,
      field_name TEXT,
      old_value TEXT,
      new_value TEXT,
      comment TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      content TEXT NOT NULL,
      edited_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      work_item_id TEXT REFERENCES work_items(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notification_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      work_item_id TEXT REFERENCES work_items(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'PENDING'
        CHECK(state IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TEXT NOT NULL DEFAULT (datetime('now')),
      locked_until TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      response_status INTEGER NOT NULL,
      response_body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Indexes for common query patterns
    CREATE INDEX IF NOT EXISTS idx_work_items_team_id ON work_items(team_id);
    CREATE INDEX IF NOT EXISTS idx_work_items_assignee_id ON work_items(assignee_id);
    CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
    CREATE INDEX IF NOT EXISTS idx_work_items_priority ON work_items(priority);
    CREATE INDEX IF NOT EXISTS idx_work_items_created_at ON work_items(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_work_items_updated_at ON work_items(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_work_items_team_status ON work_items(team_id, status);
    CREATE INDEX IF NOT EXISTS idx_activity_log_work_item_id ON activity_log(work_item_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id, read, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON team_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
    CREATE INDEX IF NOT EXISTS idx_comments_work_item_id ON comments(work_item_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_notification_jobs_ready
      ON notification_jobs(state, available_at, locked_until, created_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS work_items_fts USING fts5(
      title,
      description,
      content='work_items',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS work_items_fts_insert AFTER INSERT ON work_items BEGIN
      INSERT INTO work_items_fts(rowid, title, description)
      VALUES (new.rowid, new.title, coalesce(new.description, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS work_items_fts_delete AFTER DELETE ON work_items BEGIN
      INSERT INTO work_items_fts(work_items_fts, rowid, title, description)
      VALUES ('delete', old.rowid, old.title, coalesce(old.description, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS work_items_fts_update AFTER UPDATE OF title, description ON work_items BEGIN
      INSERT INTO work_items_fts(work_items_fts, rowid, title, description)
      VALUES ('delete', old.rowid, old.title, coalesce(old.description, ''));
      INSERT INTO work_items_fts(rowid, title, description)
      VALUES (new.rowid, new.title, coalesce(new.description, ''));
    END;

    -- Cleanup old idempotency keys (older than 24 hours)
    DELETE FROM idempotency_keys
    WHERE created_at < datetime('now', '-24 hours');
  `);

  if (!hadWorkItemFts) {
    db.exec("INSERT INTO work_items_fts(work_items_fts) VALUES ('rebuild')");
  }
}
