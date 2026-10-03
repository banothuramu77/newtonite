# Newtonite Operations Hub — Setup & Running Guide

## Prerequisites
- Node.js >= 18 (tested on v22)
- npm >= 9

No external database or queue infrastructure required. SQLite is embedded.

## Quick Start

### 1. Clone / extract the project
```bash
# The project is in two directories: backend/ and frontend/
```

### 2. Install and start the backend
```bash
cd backend
npm install
npm run seed       # Creates sample data (users, teams, work items)
npm run dev        # Starts API server on http://localhost:3001
```

### 3. Install and start the frontend (in a second terminal)
```bash
cd frontend
npm install
npm run dev        # Starts Vite dev server on http://localhost:5173
```

### 4. Open the app
Navigate to: **http://localhost:5173**

## Demo Credentials (from seed data)

| Email | Password | Role |
|-------|----------|------|
| alice@example.com | password123 | Engineering ADMIN |
| bob@example.com | password123 | Engineering MEMBER, Operations ADMIN |
| charlie@example.com | password123 | Operations MEMBER |

## Running Tests
```bash
cd backend
npm test
```

## Building for Production
```bash
# Backend
cd backend && npm run build
node dist/index.js

# Frontend
cd frontend && npm run build
# Serve the dist/ directory with any static file server
```

## Environment Variables

### Backend (optional)
| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 3001 | API server port |
| JWT_SECRET | (dev default) | JWT signing secret — **change in production** |
| DB_PATH | ./data/newtonite.db | SQLite database file path |

## Project Structure
```
.
├── backend/
│   ├── src/
│   │   ├── index.ts           # Express app entry point
│   │   ├── db/
│   │   │   ├── schema.ts      # SQLite schema & indexes
│   │   │   ├── database.ts    # DB singleton
│   │   │   └── seed.ts        # Demo data seeder
│   │   ├── routes/
│   │   │   ├── auth.ts        # Authentication endpoints
│   │   │   ├── teams.ts       # Team management
│   │   │   ├── workItems.ts   # Core work item CRUD + critical behaviors
│   │   │   ├── notifications.ts
│   │   │   └── search.ts
│   │   ├── middleware/
│   │   │   ├── auth.ts        # JWT auth + role checks + idempotency
│   │   │   └── validate.ts    # Zod request validation
│   │   ├── services/
│   │   │   └── notificationService.ts  # Async notification queue
│   │   └── utils/
│   │       ├── types.ts       # TypeScript interfaces
│   │       └── jwt.ts         # JWT helpers
│   └── tests/
│       ├── setup.ts           # In-memory test database configuration
│       └── workItems.test.ts  # Authorization, workflow, concurrent claim, idempotency tests
├── frontend/
│   └── src/
│       ├── api/               # API client functions
│       ├── components/        # Shared UI components
│       ├── hooks/             # TanStack Query hooks
│       ├── pages/             # Dashboard, teams, work items, detail, search, auth
│       ├── store/             # Zustand auth store
│       └── types/             # TypeScript types
├── ENGINEERING_DECISIONS.md
├── LIMITATIONS.md
└── README.md
```

## Architecture Overview

```
Browser (React + TanStack Query)
        │  HTTP/JSON
        ▼
Express API (Node.js + TypeScript)
  ├── JWT Authentication Middleware
  ├── Role-Based Authorization Middleware
  ├── Idempotency Middleware
  ├── Zod Request Validation
  └── Routes
        │
        ▼
SQLite (WAL Mode, better-sqlite3)
  └── In-Process Notification Queue
```

## Critical Behaviors Demonstrated

1. **Optimistic Locking**: Every work item update requires sending the current `version`. If the version doesn't match (someone else updated it), the server returns HTTP 409 with a clear message. The UI shows a conflict warning.

2. **Concurrent Assignment Prevention**: When two users try to claim the same work item simultaneously, a SQLite `BEGIN IMMEDIATE` transaction ensures only one succeeds. The other gets a 409.

3. **Status Workflow Enforcement**: Status transitions follow explicit rules (e.g., OPEN can only go to IN_PROGRESS or CLOSED, not directly to APPROVED). Invalid transitions return HTTP 422. ADMIN role is required for approval transitions.

4. **Idempotency Keys**: Work-item create, update, assignment, status, and comment endpoints accept `X-Idempotency-Key`. Responses are scoped to the authenticated user, HTTP method, and route, so a retry replays its original result without crossing user boundaries.

5. **Server-Side Authorization**: Even if a user knows a work item ID, they cannot read or modify it without being a member of the item's team. Assignees must also belong to the same team. Role checks happen at the database level, not just the UI.
