# Engineering Decisions

## Overview

This document explains the five most important architectural and engineering decisions made while building the Newtonite operational work management system. Each decision involves real trade-offs, and I've tried to be honest about both the benefits and the limitations of each choice.

---

## Decision 1: Optimistic Locking with a Version Counter

### Problem
Multiple users can view and edit the same work item at the same time. Without a concurrency control mechanism, the "last writer wins" — one user's changes silently overwrite another's. This is especially dangerous for status changes or ownership reassignments.

### Decision
Every `work_item` row has an integer `version` column, starting at 0. Every mutation that changes a work item requires the client to supply the current `version`. The server wraps the update in a SQLite `BEGIN IMMEDIATE` transaction:

```sql
BEGIN IMMEDIATE;
SELECT id, version FROM work_items WHERE id = ? AND version = ?;
-- if 0 rows: return HTTP 409 Conflict
UPDATE work_items SET ..., version = version + 1, updated_at = datetime('now')
WHERE id = ? AND version = ?;
-- if 0 rows affected: rollback, return HTTP 409 Conflict
COMMIT;
```

The frontend receives the updated version in every response and uses it in subsequent mutations. If a 409 is received, the UI shows a clear message: *"This item was modified by another user. Please refresh."*

Assignment and status mutations use `BEGIN IMMEDIATE` semantics as well, so the read-check-write sequence is serialized before ownership or workflow rules are evaluated. The generic edit endpoint applies the same workflow transition checks as the dedicated status endpoint.

### Trade-offs
- **Pro**: Simple, well-understood pattern; no distributed lock infrastructure required; works correctly with SQLite's serialised write model.
- **Pro**: Clients always know exactly what happened (409 vs. silent overwrite).
- **Con**: Requires the frontend to propagate the `version` field through all edit forms — a bit more UI complexity.
- **Con**: With very high write contention on the same item, many retries could occur. For this scale (thousands of users, tens of thousands of items), contention per item is low enough that this is not a practical concern.
- **Alternative considered**: Pessimistic locking (row-level lock held while user edits). Rejected because it requires tracking active editors and releasing locks on disconnect, which adds significant complexity and degrades UX when a user leaves a tab open.

---

## Decision 2: SQLite with WAL Mode Instead of PostgreSQL

### Problem
The challenge requires a real database with ACID guarantees, support for concurrent readers, and reasonable write performance. PostgreSQL is the obvious choice — but it requires external infrastructure that may not be present on the evaluator's machine.

### Decision
Use `better-sqlite3` with WAL (Write-Ahead Logging) journal mode enabled. WAL allows multiple concurrent readers and a single writer without blocking each other, which is sufficient for the expected scale.

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
```

The schema uses proper foreign keys, composite unique constraints, and covering indexes for all common query patterns.

### Trade-offs
- **Pro**: Zero external dependencies — the application runs with `npm install && npm start`.
- **Pro**: SQLite's synchronous `better-sqlite3` API makes transactions straightforward and avoids async callback complexity.
- **Pro**: WAL mode gives good concurrent read performance.
- **Con**: SQLite does not support truly concurrent writes. All writes are serialised. At very high write throughput (thousands of writes/second), this becomes a bottleneck.
- **Con**: SQLite is not suited for a multi-process deployment. Horizontal scaling (multiple API server instances) would require switching to PostgreSQL.
- **Migration path**: The schema is written to be directly portable to PostgreSQL. Switching requires: replacing `better-sqlite3` with `pg`, changing `TEXT DEFAULT (datetime('now'))` to `TIMESTAMPTZ DEFAULT NOW()`, and updating the transaction API. Estimated effort: 2–4 hours.

---

## Decision 3: Role-Based Authorization Enforced Server-Side

### Problem
The application has multiple teams, and users have different roles within each team (ADMIN, MEMBER, VIEWER). Access control must be enforced by the server — it cannot rely on the frontend hiding controls.

### Decision
Every protected route checks the authenticated user's `team_members` record before executing any business logic. The role hierarchy is: `ADMIN > MEMBER > VIEWER`.

- **VIEWER**: can read work items and comments in their team
- **MEMBER**: can create/update work items, add comments, change assignees
- **ADMIN**: can additionally manage team membership, approve status transitions, and delete any comment

Assignment targets are checked against the item's team, and viewer accounts cannot mutate or comment on work items.

The `requireRole` middleware factory is applied per-route:

```typescript
router.post('/:teamId/members', authenticate, requireRole('ADMIN'), handler);
```

Authorization is also enforced at the resource level, not just the route level. For example, a user cannot update a work item in a team they don't belong to, even if they know the item's ID — the handler checks team membership before proceeding.

### Trade-offs
- **Pro**: Authorization is centralised in middleware; easy to audit.
- **Pro**: No trust placed in the frontend; a direct API call without the UI still gets a 403.
- **Con**: Every request incurs an extra DB query (team membership lookup). At scale, this should be cached (e.g., in Redis with a short TTL).
- **Alternative considered**: Attribute-based access control (ABAC) for fine-grained per-item permissions. Rejected as over-engineering for the stated problem. The team-scoped RBAC model is a natural fit for the described company structure.

---

## Decision 4: In-Process Async Queue for Notifications

### Problem
Notifications (e.g., "You were assigned to task X") should not block the primary mutation response. If notification delivery fails, it should not cause the work item update to fail. Notifications may also need to be retried.

### Decision
An in-process job queue is implemented using a JavaScript array and `setInterval`. When a mutation succeeds (e.g., work item assigned), it calls `queueNotification(...)` which pushes a job onto the array. A separate processing loop runs every 100ms, dequeues jobs, and writes to the `notifications` table. Failed jobs are retried up to 3 times with exponential backoff.

```typescript
// Simplified
setInterval(() => {
  const job = queue.shift();
  if (job) processJob(job).catch(scheduleRetry(job));
}, 100);
```

### Trade-offs
- **Pro**: Zero external dependencies (no Redis/RabbitMQ required).
- **Pro**: Notifications are decoupled from the primary request path.
- **Pro**: Retry logic handles transient failures.
- **Con**: The queue is in-memory. If the server restarts, pending notifications are lost. For a production system, a durable queue (Redis + BullMQ, or a DB-backed queue) would be required.
- **Con**: Not suitable for multi-process deployments (each process has its own queue).
- **Con**: Does not support real-time push (WebSockets). Users see new notifications when they poll (every page load or on a timer).
- **Migration path**: Replace the in-process array with BullMQ + Redis. The `queueNotification` API surface remains the same — only the internals change.

---

## Decision 5: Status Workflow Enforcement with Explicit Transition Rules

### Problem
Work items move through a lifecycle (OPEN → IN_PROGRESS → PENDING_APPROVAL → APPROVED → RESOLVED → CLOSED). Not all transitions should be allowed. For example, jumping directly from OPEN to APPROVED would bypass the review step. Also, only ADMINs should be able to perform approval transitions.

### Decision
The server enforces an explicit transition table. Each status has an allowable set of next statuses, and some transitions additionally require the ADMIN role:

```
OPEN          → IN_PROGRESS, CLOSED
IN_PROGRESS   → PENDING_APPROVAL, OPEN, RESOLVED
PENDING_APPROVAL → APPROVED (ADMIN only), IN_PROGRESS
APPROVED      → RESOLVED, IN_PROGRESS
RESOLVED      → CLOSED, IN_PROGRESS (reopen)
CLOSED        → OPEN (reopen)
```

Attempting an invalid transition returns HTTP 422 Unprocessable Entity with a clear message. The frontend mirrors this logic to prevent the invalid options from appearing in the dropdown, but the server is the source of truth.

### Trade-offs
- **Pro**: Clear, auditable business rules that prevent workflow violations even via direct API calls.
- **Pro**: The transition table is easy to extend or modify without touching multiple files.
- **Pro**: Invalid transitions are caught early and return descriptive errors, not silent failures.
- **Con**: The workflow is hardcoded. A more flexible system would store workflow configuration in the database (a state-machine DSL). For the current requirements, this is unnecessary complexity.
- **Alternative considered**: A flexible finite-state-machine library. Rejected in favour of a simple explicit map — easier to read, debug, and explain during the review.

---

## Additional Notes

### What I chose NOT to build (and why)

- **WebSockets / real-time push**: The polling approach (frontend refetches every 30 seconds on detail pages) is sufficient for the stated requirements. WebSockets add significant backend complexity.
- **Full-text search**: LIKE-based search is sufficient for tens of thousands of items. At larger scale, SQLite FTS5 or Elasticsearch would be used.
- **Email notifications**: Not required by the spec. The notification model is designed so that email delivery can be added to the `processJob` function without changing any other code.
- **File attachments**: Out of scope for a one-day assessment.
- **Audit log archival**: The `activity_log` table grows indefinitely. A production system would archive old entries to cold storage. Indexes on `work_item_id` keep queries fast even at large sizes.

### Known Limitations

See `LIMITATIONS.md` for a complete list.
