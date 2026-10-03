# Known Limitations

This document describes known limitations in the current implementation, what would be needed to address them, and why they were not addressed in this assessment.

---

## Infrastructure Limitations

### SQLite Instead of PostgreSQL
- **Limitation**: All writes are serialised through SQLite's single-writer model. At very high write concurrency (thousands of simultaneous writes), this becomes a bottleneck.
- **Impact**: Acceptable for the stated scale (hundreds to a few thousand simultaneous users) where most operations are reads.
- **Fix**: Replace `better-sqlite3` with `pg` and point at a PostgreSQL instance. Schema migration requires minimal changes.

### Single-Process Architecture
- **Limitation**: Cannot run multiple API server instances behind a load balancer. The in-process notification queue is per-process, and SQLite file access from multiple processes can cause lock contention.
- **Fix**: Replace in-process queue with Redis + BullMQ; replace SQLite with PostgreSQL.

---

## Feature Limitations

### No Real-Time Updates (No WebSockets)
- **Limitation**: The work item detail page polls every 30 seconds for updates. Users won't see changes made by others until the next poll.
- **Impact**: In a fast-moving incident response, someone might act on stale information for up to 30 seconds.
- **Fix**: Add Socket.io or native WebSockets. Emit events on each mutation, subscribed clients receive updates instantly.

### No Email Notifications
- **Limitation**: Notifications exist in the database but are not sent via email.
- **Fix**: Add a `sendEmail` call inside `processJob` in the notification service. Requires SMTP configuration.

### Basic Search (LIKE-based)
- **Limitation**: Search uses `LIKE '%term%'` queries, which do not benefit from indexes and perform full table scans on large datasets.
- **Impact**: Acceptable for tens of thousands of items; slow for millions.
- **Fix**: Enable SQLite FTS5 (Full-Text Search) for the title and description columns. At larger scale, use Elasticsearch or PostgreSQL full-text search.

### No File Attachments
- **Limitation**: Work items cannot have files attached.
- **Fix**: Add a `attachments` table, store files in object storage (S3/GCS), store presigned URLs in the database.

### No @mentions in Comments
- **Limitation**: Comments are plain text; users cannot be mentioned.
- **Fix**: Parse comment content for `@name` patterns on save, trigger notifications for mentioned users.

---

## Security Limitations

### JWT Secret in Code
- **Limitation**: The JWT secret defaults to a hardcoded string if `JWT_SECRET` env var is not set.
- **Impact**: Development-only risk. Any production deployment must set this environment variable.
- **Fix**: Require the env var to be set; fail startup if missing.

### No Refresh Tokens
- **Limitation**: JWTs expire after 7 days. There is no refresh token mechanism.
- **Fix**: Issue short-lived access tokens (15 minutes) and long-lived refresh tokens (30 days). Implement `/auth/refresh` endpoint.

### No Rate Limiting on Auth Endpoints
- **Limitation**: The global rate limiter applies (100 req/15min/IP), but there is no stricter limit specifically on login attempts.
- **Fix**: Add per-email rate limiting on `/auth/login` (e.g., 10 attempts per 15 minutes per email).

---

## UX Limitations

### No Inline Team Member Search
- **Limitation**: Adding a team member requires knowing their exact user ID. A production system would have a user search/autocomplete.
- **Fix**: Add `GET /users/search?q=name` endpoint; add autocomplete to the frontend.

### No Dark Mode
- **Limitation**: Only light mode is implemented.

### No Drag-and-Drop Kanban Board
- **Limitation**: The primary view is a list, not a Kanban board. A Kanban view would be more ergonomic for status management.
- **Fix**: Add a board view using a drag-and-drop library (dnd-kit). Status change on drop triggers the same `/work-items/:id/status` endpoint.

### No Pagination on Activity Log
- **Limitation**: Work item detail page loads the last 50 activity log entries. Very old history is not accessible from the UI.
- **Fix**: Add pagination to the activity log API and UI.

---

## Observability Limitations

### No Structured Logging
- **Limitation**: Logging uses `console.log`. In production, structured JSON logs (via Winston or Pino) are needed for log aggregation.

### No Metrics
- **Limitation**: No Prometheus metrics, health check endpoint details, or distributed tracing.
- **Fix**: Add `/metrics` endpoint with basic counters; integrate OpenTelemetry.

### No Database Migrations
- **Limitation**: Schema is created fresh on startup. Changing the schema requires dropping and recreating the database.
- **Fix**: Add a migration system (e.g., db-migrate, knex migrations, or Flyway for PostgreSQL).
