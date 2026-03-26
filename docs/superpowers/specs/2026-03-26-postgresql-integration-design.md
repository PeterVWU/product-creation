# PostgreSQL Integration Design

## Overview

Introduce PostgreSQL to the Magento Product Migration API to support persistent storage of AI prompts, audit logging, API key authentication, and role-based access control. Uses Knex.js for migrations and query building, with a repository pattern for data access.

## Decisions

- **Database:** PostgreSQL 16 (Alpine) via Docker
- **Migration tool:** Knex.js (query builder + migration runner)
- **Auth model:** API key per client (hashed, stored in DB)
- **Permissions:** Role-based (RBAC) with three default roles
- **Audit scope:** Business action level (not raw HTTP request logging)
- **AI prompts:** Per-store with version history
- **Integration pattern:** Repository layer under `/src/database/repositories/`

## Database Schema

### `api_keys`

| Column     | Type         | Notes                                  |
|------------|--------------|----------------------------------------|
| id         | UUID PK      |                                        |
| name       | VARCHAR(100) | Human label, e.g., "frontend-app"      |
| key_hash   | VARCHAR(255) | bcrypt hash of the raw API key         |
| role       | VARCHAR(50)  | FK to roles.id                         |
| is_active  | BOOLEAN      | Default true                           |
| created_at | TIMESTAMP    |                                        |
| updated_at | TIMESTAMP    |                                        |

Raw key shown once on creation, never stored or retrievable.

### `roles`

| Column      | Type         | Notes                                      |
|-------------|--------------|--------------------------------------------|
| id          | VARCHAR(50) PK | 'admin', 'operator', 'viewer'            |
| description | VARCHAR(255) |                                            |
| permissions | JSONB        | Array of permission strings                |
| created_at  | TIMESTAMP    |                                            |

### `ai_prompts`

| Column      | Type         | Notes                                      |
|-------------|--------------|--------------------------------------------|
| id          | UUID PK      |                                            |
| store_name  | VARCHAR(100) |                                            |
| prompt_text | TEXT         |                                            |
| version     | INTEGER      | Default 1, incremented per store           |
| is_active   | BOOLEAN      | Only one active per store                  |
| created_by  | UUID         | FK to api_keys.id                          |
| created_at  | TIMESTAMP    |                                            |

Creating a new prompt for a store deactivates the previous one (kept for history).

### `audit_logs`

| Column        | Type         | Notes                                    |
|---------------|--------------|------------------------------------------|
| id            | UUID PK      |                                          |
| api_key_id    | UUID         | FK to api_keys.id                        |
| action        | VARCHAR(100) | e.g., 'product:migrated', 'prices:synced'|
| resource_type | VARCHAR(50)  | e.g., 'product', 'price', 'prompt'       |
| resource_id   | VARCHAR(255) | SKU, store name, etc.                    |
| metadata      | JSONB        | Flexible payload (target stores, counts) |
| status        | VARCHAR(20)  | 'success', 'failure', 'partial'          |
| duration_ms   | INTEGER      |                                          |
| created_at    | TIMESTAMP    |                                          |

Indexed on `action`, `created_at`, and `api_key_id`.

## Default Roles & Permissions

| Role       | Permissions                                                                                                                                                     |
|------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **admin**    | `*` (wildcard — all permissions)                                                                                                                              |
| **operator** | `migrate:product`, `migrate:batch`, `migrate:shopify`, `sync:prices`, `sync:product-fields`, `ai:prompts:read`, `ai:prompts:write`, `audit:read`             |
| **viewer**   | `health:read`, `product:read`, `ai:prompts:read`, `audit:read`                                                                                               |

Permission naming convention: `resource:action`. Admin check uses wildcard `*` before specific permission lookup.

## Project Structure

New files added to existing structure:

```
/src
  /database
    knexfile.js                          -- Knex config (reads from env vars)
    connection.js                        -- Exports configured Knex instance
    /migrations
      20260326_001_create_api_keys.js
      20260326_002_create_roles.js
      20260326_003_create_ai_prompts.js
      20260326_004_create_audit_logs.js
    /seeds
      001_default_roles.js               -- Seeds admin, operator, viewer
    /repositories
      api-key.repository.js
      role.repository.js
      ai-prompt.repository.js
      audit-log.repository.js
  /middleware
    auth.middleware.js                    -- Validates API key, attaches user/role to req
    permission.middleware.js              -- Checks role has required permission
  /services
    /audit
      audit.service.js                   -- Business-level audit logging
```

## Integration Flow

### Startup

`server.js` runs `knex.migrate.latest()` before `app.listen()`. First run executes all migrations and seeds. Subsequent runs only apply pending migrations.

### Request Flow

1. `auth.middleware.js` reads `X-API-Key` header
2. Hashes the key, looks up in `api_keys` table
3. Joins with `roles` to get permissions
4. Attaches `req.apiKey` object (`{ id, name, role, permissions }`) to the request
5. `permission.middleware.js` checks required permission against `req.apiKey.permissions`

### Route Protection

```js
router.post('/migrate/product',
  auth(),
  permit('migrate:product'),
  migrationController.migrateProduct
);
```

### AI Prompt Resolution

Priority order during migration:
1. Request-provided `storePrompts` (existing behavior, highest priority)
2. Active database prompt for the store
3. No AI content generation

### Audit Logging

`audit.service.js` exposes `logAction({ apiKeyId, action, resourceType, resourceId, metadata, status, durationMs })`. Called from controllers/services after business actions complete. Runs alongside existing Winston file logging (not a replacement).

## Docker Configuration

### docker-compose.yml additions

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: migration_api
      POSTGRES_USER: migration_user
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U migration_user -d migration_api"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  magento-migration-api:
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: migration_api
      DB_USER: migration_user
      DB_PASSWORD: ${DB_PASSWORD}

volumes:
  pgdata:
```

### New Environment Variables

```
DB_HOST=postgres
DB_PORT=5432
DB_NAME=migration_api
DB_USER=migration_user
DB_PASSWORD=<secure-password>
AUTH_ENABLED=false
```

## Backward Compatibility & Rollout

### Auth — Feature Flag

- `AUTH_ENABLED=false` (default): auth middleware passes all requests through. No API key required.
- `AUTH_ENABLED=true`: API key required on all routes except `GET /health`.
- Allows deploying database infrastructure, testing key creation, then flipping the switch.

### AI Prompts — Graceful Fallback

- Request-provided `storePrompts` still works (existing behavior preserved).
- Database prompts used when no request-level prompts provided.
- Frontend migrates at its own pace — no breaking API change.

### Audit Logging — Additive

- Added alongside existing Winston file logging.
- Winston remains for debug-level detail; database audit logs are the queryable business record.

### First Deployment Sequence

1. Deploy with `AUTH_ENABLED=false` — database created, migrations run, roles seeded
2. Create first admin API key via one-time CLI script or bootstrap endpoint
3. Distribute API keys to consumers
4. Set `AUTH_ENABLED=true` and redeploy
