# Known Limitations

This document distinguishes limitations that remain from capabilities already implemented.

## Infrastructure and Operations

### SQLite and Single-Process Deployment
- **Limitation**: SQLite serializes writes, and the notification worker runs in the API process. The application is not designed to run multiple API instances against a shared SQLite file.
- **Impact**: This keeps local setup simple and works for the assessment, but limits write throughput and horizontal scaling.
- **Next step**: Move to PostgreSQL and run a shared worker/outbox relay or a managed queue before deploying multiple API instances.

### No Database Migration Framework
- **Limitation**: Schema initialization is idempotent and handles the current FTS index backfill, but there is no general migration/versioning framework.
- **Next step**: Add ordered migrations before making further production schema changes.

### Limited Observability
- **Limitation**: The application has a database-backed `/health` check and server logs, but no structured logging, metrics, alerting, or distributed tracing.
- **Next step**: Add structured JSON logs and operational metrics for API latency, error rates, database health, and notification-job age/failures.

## Product Features

### No Real-Time Push or Email Delivery
- **Limitation**: Durable in-app notifications are stored in SQLite and retried, but there is no WebSocket push or email delivery.
- **Impact**: Users see updates through page refresh/polling rather than immediately.
- **Next step**: Add a shared event transport for push and an independently retriable email delivery channel.

### No File Attachments or Comment Mentions
- **Limitation**: Work items have no attachment support, and comments do not resolve @mentions.
- **Next step**: Use object storage for files and add explicit mention parsing/authorization before notifying mentioned users.

### Simplified Identity Lifecycle
- **Limitation**: Production requires a 32-character `JWT_SECRET`, but access tokens last seven days. Refresh tokens, SSO, secret rotation, and account recovery are not implemented.
- **Next step**: Integrate the company's identity provider and use short-lived access tokens with a revocable session/refresh flow.

### Basic Member Selection
- **Limitation**: Team administration requires selecting a known user identifier; there is no user directory search/autocomplete.
- **Next step**: Add a permission-scoped user lookup and UI autocomplete.

### List-First UX
- **Limitation**: The interface provides dashboards, filters, and search, but no Kanban drag-and-drop view or dark mode.
- **Next step**: Add alternate views only if user feedback shows they improve operational workflows.

## Data Growth

### Activity Retention
- **Limitation**: Activity history is paginated and indexed per work item, but retained indefinitely. There is no archival or retention policy.
- **Next step**: Define audit retention requirements and archive older records without losing required compliance history.

### Search Scope and Ranking
- **Limitation**: SQLite FTS5 indexes title and description using token/prefix matching. It is not fuzzy search, does not search comments, and does not provide advanced relevance ranking.
- **Next step**: Expand indexed fields or move to PostgreSQL full-text search/search infrastructure if product needs require it.
