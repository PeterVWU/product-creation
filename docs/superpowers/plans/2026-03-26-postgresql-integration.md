# PostgreSQL Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PostgreSQL to the migration API for persistent AI prompts, audit logging, API key auth, and RBAC.

**Architecture:** Repository pattern under `src/database/` with Knex.js migrations. Auth middleware reads API keys from DB, permission middleware checks RBAC. Audit service logs business actions. Feature flag (`AUTH_ENABLED`) for gradual rollout.

**Tech Stack:** PostgreSQL 16, Knex.js, bcrypt, crypto (Node built-in), Express middleware

**Spec:** `docs/superpowers/specs/2026-03-26-postgresql-integration-design.md`

---

### Task 1: Install Dependencies and Configure Knex

**Files:**
- Modify: `package.json`
- Create: `src/database/knexfile.js`
- Create: `src/database/connection.js`
- Modify: `src/config/index.js`
- Modify: `.env.example`

- [ ] **Step 1: Install npm packages**

Run: `npm install knex pg bcrypt`

- [ ] **Step 2: Add database config to `src/config/index.js`**

Add a `database` block and `auth` block to the config object:

```js
database: {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  name: process.env.DB_NAME || 'migration_api',
  user: process.env.DB_USER || 'migration_user',
  password: process.env.DB_PASSWORD || ''
},

auth: {
  enabled: process.env.AUTH_ENABLED === 'true'
}
```

Do NOT add `database` config to the `validateConfig` required vars — the API should still start without a DB connection configured (backward compat).

- [ ] **Step 3: Create `src/database/knexfile.js`**

Note: This reads env vars directly (not through `src/config/index.js`) so it works for standalone CLI commands like `knex migrate:latest` without triggering `validateConfig()` which throws if Magento env vars are missing.

```js
require('dotenv').config();
const path = require('path');

module.exports = {
  client: 'pg',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    database: process.env.DB_NAME || 'migration_api',
    user: process.env.DB_USER || 'migration_user',
    password: process.env.DB_PASSWORD || ''
  },
  pool: {
    min: 2,
    max: 10
  },
  migrations: {
    directory: path.join(__dirname, 'migrations'),
    tableName: 'knex_migrations'
  },
  seeds: {
    directory: path.join(__dirname, 'seeds')
  }
};
```

- [ ] **Step 4: Create `src/database/connection.js`**

```js
const knex = require('knex');
const knexConfig = require('./knexfile');

const db = knex(knexConfig);

module.exports = db;
```

- [ ] **Step 5: Add env vars to `.env.example`**

Append to the end of `.env.example`:

```
# ===========================================
# DATABASE CONFIGURATION
# ===========================================
DB_HOST=localhost
DB_PORT=5432
DB_NAME=migration_api
DB_USER=migration_user
DB_PASSWORD=your_secure_password

# ===========================================
# AUTHENTICATION
# ===========================================
# Set to 'true' to require API key on all routes (except health)
AUTH_ENABLED=false
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/database/knexfile.js src/database/connection.js src/config/index.js .env.example
git commit -m "feat: add Knex.js database configuration and connection"
```

---

### Task 2: Create Database Migrations

**Files:**
- Create: `src/database/migrations/20260326_001_create_roles.js`
- Create: `src/database/migrations/20260326_002_create_api_keys.js`
- Create: `src/database/migrations/20260326_003_create_ai_prompts.js`
- Create: `src/database/migrations/20260326_004_create_audit_logs.js`

- [ ] **Step 1: Create roles migration `src/database/migrations/20260326_001_create_roles.js`**

```js
exports.up = function (knex) {
  return knex.schema.createTable('roles', (table) => {
    table.string('id', 50).primary();
    table.string('description', 255);
    table.jsonb('permissions').notNullable().defaultTo('[]');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('roles');
};
```

- [ ] **Step 2: Create api_keys migration `src/database/migrations/20260326_002_create_api_keys.js`**

```js
exports.up = function (knex) {
  return knex.schema.createTable('api_keys', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('name', 100).notNullable();
    table.string('key_prefix', 8).notNullable().index();
    table.string('key_hash', 60).notNullable();
    table.string('role_id', 50).notNullable()
      .references('id').inTable('roles').onDelete('RESTRICT');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('api_keys');
};
```

- [ ] **Step 3: Create ai_prompts migration `src/database/migrations/20260326_003_create_ai_prompts.js`**

```js
exports.up = function (knex) {
  return knex.schema.createTable('ai_prompts', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('store_name', 100).notNullable();
    table.text('prompt_text').notNullable();
    table.integer('version').notNullable().defaultTo(1);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.uuid('created_by').references('id').inTable('api_keys').onDelete('SET NULL');
    table.timestamps(true, true);

    table.unique(['store_name', 'version']);
    table.index(['store_name', 'is_active']);
  }).then(() => {
    // Partial unique index: only one active prompt per store
    return knex.raw(
      'CREATE UNIQUE INDEX ai_prompts_one_active_per_store ON ai_prompts (store_name) WHERE is_active = true'
    );
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('ai_prompts');
};
```

- [ ] **Step 4: Create audit_logs migration `src/database/migrations/20260326_004_create_audit_logs.js`**

```js
exports.up = function (knex) {
  return knex.schema.createTable('audit_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('api_key_id').nullable()
      .references('id').inTable('api_keys').onDelete('SET NULL');
    table.string('action', 100).notNullable();
    table.string('resource_type', 50);
    table.string('resource_id', 255);
    table.jsonb('metadata').defaultTo('{}');
    table.string('status', 20).notNullable();
    table.integer('duration_ms');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('action');
    table.index('created_at');
    table.index('api_key_id');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('audit_logs');
};
```

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/
git commit -m "feat: add database migrations for roles, api_keys, ai_prompts, audit_logs"
```

---

### Task 3: Create Seed File and Wire Up Startup

**Files:**
- Create: `src/database/seeds/001_default_roles.js`
- Modify: `src/server.js`

- [ ] **Step 1: Create idempotent seed `src/database/seeds/001_default_roles.js`**

```js
exports.seed = async function (knex) {
  const roles = [
    {
      id: 'admin',
      description: 'Full access — manage keys, roles, prompts, run any operation',
      permissions: JSON.stringify(['*'])
    },
    {
      id: 'operator',
      description: 'Day-to-day operations — migrations, sync, prompt management',
      permissions: JSON.stringify([
        'migrate:product', 'migrate:batch', 'migrate:shopify',
        'sync:prices', 'sync:product-fields',
        'ai:prompts:read', 'ai:prompts:write',
        'audit:read'
      ])
    },
    {
      id: 'viewer',
      description: 'Read-only — health, product lookup, view prompts and audit',
      permissions: JSON.stringify([
        'health:read', 'product:read',
        'ai:prompts:read', 'audit:read'
      ])
    }
  ];

  for (const role of roles) {
    await knex.raw(
      `INSERT INTO roles (id, description, permissions)
       VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         description = EXCLUDED.description,
         permissions = EXCLUDED.permissions`,
      [role.id, role.description, role.permissions]
    );
  }
};
```

- [ ] **Step 2: Modify `src/server.js` to run migrations on startup and destroy pool on shutdown**

Add at the top after existing requires:

```js
const db = require('./database/connection');
```

Replace the `app.listen` block with:

```js
const startServer = async () => {
  try {
    logger.info('Running database migrations...');
    await db.migrate.latest();
    logger.info('Database migrations complete');

    logger.info('Running database seeds...');
    await db.seed.run();
    logger.info('Database seeds complete');
  } catch (error) {
    logger.error('Database initialization failed', { error: error.message });
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    logger.info(`Server started successfully`, {
      port: PORT,
      environment: config.server.env,
      sourceUrl: config.source.baseUrl,
      magentoStores: Object.keys(config.magentoStores)
    });

    logger.info(`API Documentation: http://localhost:${PORT}/api`);
    logger.info(`Health Check: http://localhost:${PORT}/api/v1/health`);
    logger.info(`Magento Health: http://localhost:${PORT}/api/v1/health/magento`);
  });

  const gracefulShutdown = (signal) => {
    logger.info(`${signal} received, shutting down gracefully`);

    server.close(async () => {
      logger.info('Server closed');
      await db.destroy();
      logger.info('Database connections closed');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return server;
};

startServer();
```

Remove the old `const server = app.listen(...)`, `gracefulShutdown`, and signal handlers that are being replaced.

Keep the `unhandledRejection` and `uncaughtException` handlers as-is (they stay at module level).

- [ ] **Step 3: Commit**

```bash
git add src/database/seeds/001_default_roles.js src/server.js
git commit -m "feat: add default role seeds and database startup in server.js"
```

---

### Task 4: Test Configuration for Database Tests

Repository tests need a real PostgreSQL database. Set this up before writing any DB tests.

**Files:**
- Create: `tests/setup.js`
- Modify: `jest.config.js`
- Modify: `package.json`

- [ ] **Step 1: Create `tests/setup.js`**

```js
// Load env vars for test database connection
require('dotenv').config();

// Use a separate test database to avoid polluting development data
process.env.DB_NAME = process.env.DB_NAME_TEST || process.env.DB_NAME || 'migration_api_test';
```

- [ ] **Step 2: Update `jest.config.js`**

```js
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/.worktrees/'],
  clearMocks: true,
  setupFiles: ['./tests/setup.js']
};
```

- [ ] **Step 3: Add migration npm scripts to `package.json`**

Add to the `scripts` section:

```json
"migrate": "knex migrate:latest --knexfile src/database/knexfile.js",
"migrate:rollback": "knex migrate:rollback --knexfile src/database/knexfile.js",
"seed": "knex seed:run --knexfile src/database/knexfile.js"
```

- [ ] **Step 4: Commit**

```bash
git add tests/setup.js jest.config.js package.json
git commit -m "feat: add test setup and migration npm scripts"
```

---

### Task 5: Create Repositories

**Files:**
- Create: `src/database/repositories/role.repository.js`
- Create: `src/database/repositories/api-key.repository.js`
- Create: `src/database/repositories/ai-prompt.repository.js`
- Create: `src/database/repositories/audit-log.repository.js`

- [ ] **Step 1: Write test `tests/database/repositories/role.repository.test.js`**

```js
const db = require('../../../src/database/connection');
const roleRepo = require('../../../src/database/repositories/role.repository');

beforeAll(async () => {
  await db.migrate.latest();
  await db.seed.run();
});

afterAll(async () => {
  await db.destroy();
});

describe('role.repository', () => {
  test('findById returns admin role with permissions', async () => {
    const role = await roleRepo.findById('admin');
    expect(role).toBeTruthy();
    expect(role.id).toBe('admin');
    expect(role.permissions).toContain('*');
  });

  test('findById returns null for non-existent role', async () => {
    const role = await roleRepo.findById('nonexistent');
    expect(role).toBeNull();
  });

  test('findAll returns all three seeded roles', async () => {
    const roles = await roleRepo.findAll();
    expect(roles).toHaveLength(3);
    const ids = roles.map(r => r.id);
    expect(ids).toContain('admin');
    expect(ids).toContain('operator');
    expect(ids).toContain('viewer');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/database/repositories/role.repository.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/database/repositories/role.repository.js`**

```js
const db = require('../connection');

const TABLE = 'roles';

module.exports = {
  async findById(id) {
    const role = await db(TABLE).where({ id }).first();
    if (!role) return null;
    role.permissions = typeof role.permissions === 'string'
      ? JSON.parse(role.permissions)
      : role.permissions;
    return role;
  },

  async findAll() {
    const roles = await db(TABLE).select('*');
    return roles.map(role => ({
      ...role,
      permissions: typeof role.permissions === 'string'
        ? JSON.parse(role.permissions)
        : role.permissions
    }));
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/database/repositories/role.repository.test.js`
Expected: PASS

- [ ] **Step 5: Write test `tests/database/repositories/api-key.repository.test.js`**

```js
const db = require('../../../src/database/connection');
const apiKeyRepo = require('../../../src/database/repositories/api-key.repository');

beforeAll(async () => {
  await db.migrate.latest();
  await db.seed.run();
});

afterAll(async () => {
  await db('api_keys').del();
  await db.destroy();
});

describe('api-key.repository', () => {
  let createdId;

  test('create stores a key and returns it without hash', async () => {
    const result = await apiKeyRepo.create({
      name: 'test-key',
      keyPrefix: 'abcd1234',
      keyHash: '$2b$10$abcdefghijklmnopqrstuvwxyz012345678901234567890',
      roleId: 'admin'
    });
    expect(result.id).toBeDefined();
    expect(result.name).toBe('test-key');
    expect(result.key_prefix).toBe('abcd1234');
    expect(result.role_id).toBe('admin');
    expect(result.is_active).toBe(true);
    createdId = result.id;
  });

  test('findByPrefix returns matching key', async () => {
    const key = await apiKeyRepo.findByPrefix('abcd1234');
    expect(key).toBeTruthy();
    expect(key.id).toBe(createdId);
    expect(key.key_hash).toBeDefined();
  });

  test('findByPrefix returns null for non-existent prefix', async () => {
    const key = await apiKeyRepo.findByPrefix('zzzzzzzz');
    expect(key).toBeNull();
  });

  test('findAll returns keys without hashes', async () => {
    const keys = await apiKeyRepo.findAll();
    expect(keys.length).toBeGreaterThanOrEqual(1);
    keys.forEach(key => {
      expect(key.key_hash).toBeUndefined();
    });
  });

  test('update can deactivate a key', async () => {
    const updated = await apiKeyRepo.update(createdId, { is_active: false });
    expect(updated.is_active).toBe(false);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test -- tests/database/repositories/api-key.repository.test.js`
Expected: FAIL

- [ ] **Step 7: Create `src/database/repositories/api-key.repository.js`**

```js
const db = require('../connection');

const TABLE = 'api_keys';

module.exports = {
  async create({ name, keyPrefix, keyHash, roleId }) {
    const [row] = await db(TABLE)
      .insert({
        name,
        key_prefix: keyPrefix,
        key_hash: keyHash,
        role_id: roleId
      })
      .returning(['id', 'name', 'key_prefix', 'role_id', 'is_active', 'created_at']);
    return row;
  },

  async findByPrefix(prefix) {
    const key = await db(TABLE)
      .where({ key_prefix: prefix, is_active: true })
      .first();
    return key || null;
  },

  async findById(id) {
    const key = await db(TABLE)
      .select('id', 'name', 'key_prefix', 'role_id', 'is_active', 'created_at', 'updated_at')
      .where({ id })
      .first();
    return key || null;
  },

  async findAll() {
    return db(TABLE)
      .select('id', 'name', 'key_prefix', 'role_id', 'is_active', 'created_at', 'updated_at')
      .orderBy('created_at', 'desc');
  },

  async update(id, fields) {
    const allowedFields = ['name', 'role_id', 'is_active'];
    const updateData = {};
    for (const field of allowedFields) {
      if (fields[field] !== undefined) {
        updateData[field] = fields[field];
      }
    }
    const [row] = await db(TABLE)
      .where({ id })
      .update(updateData)
      .returning(['id', 'name', 'key_prefix', 'role_id', 'is_active', 'created_at', 'updated_at']);
    return row;
  }
};
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- tests/database/repositories/api-key.repository.test.js`
Expected: PASS

- [ ] **Step 9: Write test `tests/database/repositories/ai-prompt.repository.test.js`**

```js
const db = require('../../../src/database/connection');
const aiPromptRepo = require('../../../src/database/repositories/ai-prompt.repository');

beforeAll(async () => {
  await db.migrate.latest();
  await db.seed.run();
});

afterAll(async () => {
  await db('ai_prompts').del();
  await db.destroy();
});

describe('ai-prompt.repository', () => {
  test('create inserts a prompt with version 1', async () => {
    const prompt = await aiPromptRepo.create({
      storeName: 'ejuices',
      promptText: 'Write in a casual tone',
      createdBy: null
    });
    expect(prompt.store_name).toBe('ejuices');
    expect(prompt.version).toBe(1);
    expect(prompt.is_active).toBe(true);
  });

  test('create second prompt deactivates first, increments version', async () => {
    const prompt2 = await aiPromptRepo.create({
      storeName: 'ejuices',
      promptText: 'Write in a formal tone',
      createdBy: null
    });
    expect(prompt2.version).toBe(2);
    expect(prompt2.is_active).toBe(true);

    // Old prompt should be deactivated
    const all = await db('ai_prompts').where({ store_name: 'ejuices' });
    const active = all.filter(p => p.is_active);
    expect(active).toHaveLength(1);
    expect(active[0].version).toBe(2);
  });

  test('findActiveByStore returns the active prompt', async () => {
    const prompt = await aiPromptRepo.findActiveByStore('ejuices');
    expect(prompt).toBeTruthy();
    expect(prompt.is_active).toBe(true);
    expect(prompt.prompt_text).toBe('Write in a formal tone');
  });

  test('findActiveByStore returns null for unknown store', async () => {
    const prompt = await aiPromptRepo.findActiveByStore('nonexistent');
    expect(prompt).toBeNull();
  });

  test('findAllActive returns one prompt per store', async () => {
    await aiPromptRepo.create({
      storeName: 'misthub',
      promptText: 'Write for misthub',
      createdBy: null
    });
    const all = await aiPromptRepo.findAllActive();
    expect(all.length).toBeGreaterThanOrEqual(2);
    const stores = all.map(p => p.store_name);
    expect(stores).toContain('ejuices');
    expect(stores).toContain('misthub');
  });

  test('getHistory returns all versions for a store', async () => {
    const history = await aiPromptRepo.getHistory('ejuices');
    expect(history).toHaveLength(2);
    expect(history[0].version).toBe(2); // newest first
    expect(history[1].version).toBe(1);
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `npm test -- tests/database/repositories/ai-prompt.repository.test.js`
Expected: FAIL

- [ ] **Step 11: Create `src/database/repositories/ai-prompt.repository.js`**

```js
const db = require('../connection');

const TABLE = 'ai_prompts';

module.exports = {
  async create({ storeName, promptText, createdBy }) {
    return db.transaction(async (trx) => {
      // Get current max version for this store
      const current = await trx(TABLE)
        .where({ store_name: storeName })
        .max('version as max_version')
        .first();

      const nextVersion = (current?.max_version || 0) + 1;

      // Deactivate existing active prompt
      await trx(TABLE)
        .where({ store_name: storeName, is_active: true })
        .update({ is_active: false, updated_at: trx.fn.now() });

      // Insert new prompt
      const [row] = await trx(TABLE)
        .insert({
          store_name: storeName,
          prompt_text: promptText,
          version: nextVersion,
          is_active: true,
          created_by: createdBy
        })
        .returning('*');

      return row;
    });
  },

  async findActiveByStore(storeName) {
    const prompt = await db(TABLE)
      .where({ store_name: storeName, is_active: true })
      .first();
    return prompt || null;
  },

  async findAllActive() {
    return db(TABLE)
      .where({ is_active: true })
      .orderBy('store_name');
  },

  async getHistory(storeName) {
    return db(TABLE)
      .where({ store_name: storeName })
      .orderBy('version', 'desc');
  }
};
```

- [ ] **Step 12: Run test to verify it passes**

Run: `npm test -- tests/database/repositories/ai-prompt.repository.test.js`
Expected: PASS

- [ ] **Step 13: Write test `tests/database/repositories/audit-log.repository.test.js`**

```js
const db = require('../../../src/database/connection');
const auditLogRepo = require('../../../src/database/repositories/audit-log.repository');

beforeAll(async () => {
  await db.migrate.latest();
  await db.seed.run();
});

afterAll(async () => {
  await db('audit_logs').del();
  await db.destroy();
});

describe('audit-log.repository', () => {
  test('create inserts an audit log entry', async () => {
    const log = await auditLogRepo.create({
      apiKeyId: null,
      action: 'product:migrated',
      resourceType: 'product',
      resourceId: 'TEST-SKU-001',
      metadata: { targetStores: ['ejuices'] },
      status: 'success',
      durationMs: 1234
    });
    expect(log.id).toBeDefined();
    expect(log.action).toBe('product:migrated');
    expect(log.resource_id).toBe('TEST-SKU-001');
  });

  test('query filters by action', async () => {
    await auditLogRepo.create({
      action: 'prices:synced',
      resourceType: 'price',
      resourceId: 'TEST-SKU-002',
      metadata: {},
      status: 'success',
      durationMs: 500
    });

    const results = await auditLogRepo.query({ action: 'product:migrated' });
    expect(results.data.length).toBeGreaterThanOrEqual(1);
    results.data.forEach(log => {
      expect(log.action).toBe('product:migrated');
    });
  });

  test('query filters by date range', async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const results = await auditLogRepo.query({
      startDate: yesterday.toISOString(),
      endDate: tomorrow.toISOString()
    });
    expect(results.data.length).toBeGreaterThanOrEqual(2);
  });

  test('query supports pagination', async () => {
    const page1 = await auditLogRepo.query({ limit: 1, offset: 0 });
    expect(page1.data).toHaveLength(1);
    expect(page1.total).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 14: Run test to verify it fails**

Run: `npm test -- tests/database/repositories/audit-log.repository.test.js`
Expected: FAIL

- [ ] **Step 15: Create `src/database/repositories/audit-log.repository.js`**

```js
const db = require('../connection');

const TABLE = 'audit_logs';

module.exports = {
  async create({ apiKeyId, action, resourceType, resourceId, metadata, status, durationMs }) {
    const [row] = await db(TABLE)
      .insert({
        api_key_id: apiKeyId || null,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        metadata: JSON.stringify(metadata || {}),
        status,
        duration_ms: durationMs
      })
      .returning('*');
    return row;
  },

  async query({ action, apiKeyId, startDate, endDate, limit = 50, offset = 0 } = {}) {
    let query = db(TABLE);
    let countQuery = db(TABLE);

    if (action) {
      query = query.where('action', action);
      countQuery = countQuery.where('action', action);
    }
    if (apiKeyId) {
      query = query.where('api_key_id', apiKeyId);
      countQuery = countQuery.where('api_key_id', apiKeyId);
    }
    if (startDate) {
      query = query.where('created_at', '>=', startDate);
      countQuery = countQuery.where('created_at', '>=', startDate);
    }
    if (endDate) {
      query = query.where('created_at', '<=', endDate);
      countQuery = countQuery.where('created_at', '<=', endDate);
    }

    const [{ count }] = await countQuery.count('id as count');

    const data = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      data,
      total: parseInt(count, 10),
      limit,
      offset
    };
  }
};
```

- [ ] **Step 16: Run test to verify it passes**

Run: `npm test -- tests/database/repositories/audit-log.repository.test.js`
Expected: PASS

- [ ] **Step 17: Commit**

```bash
git add src/database/repositories/ tests/database/
git commit -m "feat: add repositories for roles, api_keys, ai_prompts, audit_logs"
```

---

### Task 6: Auth and Permission Middleware

**Files:**
- Create: `src/middleware/auth.middleware.js`
- Create: `src/middleware/permission.middleware.js`
- Create: `src/utils/api-key.utils.js`
- Test: `tests/utils/api-key.utils.test.js`
- Test: `tests/middleware/permission.middleware.test.js`
- Modify: `src/utils/error-handler.js` (add `AuthenticationError`, `AuthorizationError`)

- [ ] **Step 1: Add error classes to `src/utils/error-handler.js`**

Add before the `module.exports`:

```js
class AuthenticationError extends Error {
  constructor(message = 'Authentication required') {
    super(message);
    this.name = 'AuthenticationError';
    this.statusCode = 401;
    Error.captureStackTrace(this, this.constructor);
  }
}

class AuthorizationError extends Error {
  constructor(message = 'Insufficient permissions') {
    super(message);
    this.name = 'AuthorizationError';
    this.statusCode = 403;
    Error.captureStackTrace(this, this.constructor);
  }
}
```

Add `AuthenticationError` and `AuthorizationError` to the module.exports.

- [ ] **Step 2: Handle new error types in `src/middleware/error.middleware.js`**

Add before the generic 500 handler at the end:

```js
if (err instanceof AuthenticationError) {
  return res.status(401).json({
    success: false,
    error: 'Authentication Error',
    message: err.message
  });
}

if (err instanceof AuthorizationError) {
  return res.status(403).json({
    success: false,
    error: 'Authorization Error',
    message: err.message
  });
}
```

Import `AuthenticationError` and `AuthorizationError` from `../utils/error-handler` at the top.

- [ ] **Step 3: Create `src/utils/api-key.utils.js`**

```js
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;
const PREFIX_LENGTH = 8;
const SECRET_LENGTH = 32;

function generateApiKey() {
  const prefix = crypto.randomBytes(4).toString('hex'); // 8 hex chars
  const secret = crypto.randomBytes(SECRET_LENGTH).toString('hex');
  const rawKey = `mk_${prefix}_${secret}`;
  return { rawKey, prefix, secret };
}

async function hashSecret(secret) {
  return bcrypt.hash(secret, SALT_ROUNDS);
}

async function verifySecret(secret, hash) {
  return bcrypt.compare(secret, hash);
}

function parseApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return null;
  const parts = rawKey.split('_');
  // Expected format: mk_<prefix>_<secret>
  if (parts.length !== 3 || parts[0] !== 'mk') return null;
  return { prefix: parts[1], secret: parts[2] };
}

module.exports = { generateApiKey, hashSecret, verifySecret, parseApiKey };
```

- [ ] **Step 4: Write test `tests/utils/api-key.utils.test.js`**

```js
const { parseApiKey, generateApiKey, hashSecret, verifySecret } = require('../../src/utils/api-key.utils');

describe('api-key.utils', () => {
  test('generateApiKey returns rawKey, prefix, and secret', () => {
    const { rawKey, prefix, secret } = generateApiKey();
    expect(rawKey).toMatch(/^mk_[a-f0-9]{8}_[a-f0-9]{64}$/);
    expect(prefix).toHaveLength(8);
    expect(secret).toHaveLength(64);
  });

  test('parseApiKey extracts prefix and secret', () => {
    const result = parseApiKey('mk_abcd1234_secretvalue');
    expect(result).toEqual({ prefix: 'abcd1234', secret: 'secretvalue' });
  });

  test('parseApiKey returns null for invalid formats', () => {
    expect(parseApiKey(null)).toBeNull();
    expect(parseApiKey('')).toBeNull();
    expect(parseApiKey('invalid')).toBeNull();
    expect(parseApiKey('xx_abc_def')).toBeNull();
  });

  test('hashSecret and verifySecret round-trip', async () => {
    const secret = 'test-secret-value';
    const hash = await hashSecret(secret);
    expect(await verifySecret(secret, hash)).toBe(true);
    expect(await verifySecret('wrong-secret', hash)).toBe(false);
  });
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/utils/api-key.utils.test.js`
Expected: PASS

- [ ] **Step 6: Create `src/middleware/auth.middleware.js`**

```js
const config = require('../config');
const apiKeyRepo = require('../database/repositories/api-key.repository');
const roleRepo = require('../database/repositories/role.repository');
const { parseApiKey, verifySecret } = require('../utils/api-key.utils');
const { AuthenticationError } = require('../utils/error-handler');

function auth() {
  return async (req, res, next) => {
    // When auth is disabled, pass through
    if (!config.auth.enabled) {
      req.apiKey = null;
      return next();
    }

    const rawKey = req.headers['x-api-key'];
    if (!rawKey) {
      return next(new AuthenticationError('Missing X-API-Key header'));
    }

    const parsed = parseApiKey(rawKey);
    if (!parsed) {
      return next(new AuthenticationError('Invalid API key format'));
    }

    const keyRow = await apiKeyRepo.findByPrefix(parsed.prefix);
    if (!keyRow) {
      return next(new AuthenticationError('Invalid API key'));
    }

    const valid = await verifySecret(parsed.secret, keyRow.key_hash);
    if (!valid) {
      return next(new AuthenticationError('Invalid API key'));
    }

    const role = await roleRepo.findById(keyRow.role_id);

    req.apiKey = {
      id: keyRow.id,
      name: keyRow.name,
      role: keyRow.role_id,
      permissions: role ? role.permissions : []
    };

    next();
  };
}

module.exports = auth;
```

- [ ] **Step 7: Create `src/middleware/permission.middleware.js`**

```js
const { AuthorizationError } = require('../utils/error-handler');

function permit(...requiredPermissions) {
  return (req, res, next) => {
    // When auth is not active (req.apiKey is null), allow through
    if (!req.apiKey) {
      return next();
    }

    const userPermissions = req.apiKey.permissions || [];

    // Wildcard grants all permissions
    if (userPermissions.includes('*')) {
      return next();
    }

    const hasPermission = requiredPermissions.every(
      perm => userPermissions.includes(perm)
    );

    if (!hasPermission) {
      return next(new AuthorizationError(
        `Required permissions: ${requiredPermissions.join(', ')}`
      ));
    }

    next();
  };
}

module.exports = permit;
```

- [ ] **Step 8: Write test `tests/middleware/permission.middleware.test.js`**

```js
const permit = require('../../src/middleware/permission.middleware');

function mockReqRes(apiKey) {
  return {
    req: { apiKey },
    res: {},
    next: jest.fn()
  };
}

describe('permission.middleware', () => {
  test('allows through when apiKey is null (auth disabled)', () => {
    const { req, res, next } = mockReqRes(null);
    permit('migrate:product')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('allows admin wildcard', () => {
    const { req, res, next } = mockReqRes({ permissions: ['*'] });
    permit('migrate:product')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('allows matching permission', () => {
    const { req, res, next } = mockReqRes({ permissions: ['migrate:product'] });
    permit('migrate:product')(req, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  test('rejects missing permission', () => {
    const { req, res, next } = mockReqRes({ permissions: ['health:read'] });
    permit('migrate:product')(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({
      name: 'AuthorizationError'
    }));
  });
});
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test -- tests/middleware/permission.middleware.test.js`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/middleware/auth.middleware.js src/middleware/permission.middleware.js src/utils/api-key.utils.js src/utils/error-handler.js src/middleware/error.middleware.js tests/utils/ tests/middleware/
git commit -m "feat: add auth and permission middleware with API key utilities"
```

---

### Task 7: Audit Service

**Files:**
- Create: `src/services/audit/audit.service.js`
- Test: `tests/services/audit/audit.service.test.js`

- [ ] **Step 1: Write test `tests/services/audit/audit.service.test.js`**

```js
const db = require('../../../src/database/connection');
const auditService = require('../../../src/services/audit/audit.service');

beforeAll(async () => {
  await db.migrate.latest();
  await db.seed.run();
});

afterAll(async () => {
  await db('audit_logs').del();
  await db.destroy();
});

describe('audit.service', () => {
  test('logAction inserts an audit log', async () => {
    const log = await auditService.logAction({
      action: 'product:migrated',
      resourceType: 'product',
      resourceId: 'SKU-123',
      metadata: { targetStores: ['ejuices'] },
      status: 'success',
      durationMs: 2000
    });
    expect(log.action).toBe('product:migrated');
  });

  test('logAction does not throw on failure (fire-and-forget safe)', async () => {
    // Should log error but not throw — audit failures must not break business operations
    const log = await auditService.logAction({
      action: 'product:migrated',
      resourceType: 'product',
      resourceId: 'SKU-456',
      status: 'success'
    });
    expect(log).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/services/audit/audit.service.test.js`
Expected: FAIL

- [ ] **Step 3: Create `src/services/audit/audit.service.js`**

```js
const auditLogRepo = require('../../database/repositories/audit-log.repository');
const logger = require('../../config/logger');

module.exports = {
  async logAction({ apiKeyId, action, resourceType, resourceId, metadata, status, durationMs }) {
    try {
      return await auditLogRepo.create({
        apiKeyId,
        action,
        resourceType,
        resourceId,
        metadata,
        status,
        durationMs
      });
    } catch (error) {
      // Audit failures must never break business operations
      logger.error('Failed to write audit log', {
        error: error.message,
        action,
        resourceType,
        resourceId
      });
      return null;
    }
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/services/audit/audit.service.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/audit/audit.service.js tests/services/audit/
git commit -m "feat: add audit service for business-level action logging"
```

---

### Task 8: API Key Management Routes

**Files:**
- Create: `src/controllers/key.controller.js`
- Create: `src/routes/v1/key.routes.js`
- Modify: `src/routes/v1/index.js`

- [ ] **Step 1: Create `src/controllers/key.controller.js`**

```js
const apiKeyRepo = require('../database/repositories/api-key.repository');
const roleRepo = require('../database/repositories/role.repository');
const { generateApiKey, hashSecret } = require('../utils/api-key.utils');
const { ValidationError } = require('../utils/error-handler');

const createKey = async (req, res, next) => {
  try {
    const { name, role } = req.body;

    if (!name || !role) {
      throw new ValidationError('name and role are required');
    }

    const roleExists = await roleRepo.findById(role);
    if (!roleExists) {
      throw new ValidationError(`Role '${role}' does not exist`);
    }

    const { rawKey, prefix, secret } = generateApiKey();
    const keyHash = await hashSecret(secret);

    const record = await apiKeyRepo.create({
      name,
      keyPrefix: prefix,
      keyHash,
      roleId: role
    });

    res.status(201).json({
      success: true,
      data: {
        id: record.id,
        name: record.name,
        role: record.role_id,
        key: rawKey  // Only time the raw key is returned
      }
    });
  } catch (error) {
    next(error);
  }
};

const listKeys = async (req, res, next) => {
  try {
    const keys = await apiKeyRepo.findAll();
    res.json({ success: true, data: keys });
  } catch (error) {
    next(error);
  }
};

const updateKey = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = {};

    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.role !== undefined) {
      const roleExists = await roleRepo.findById(req.body.role);
      if (!roleExists) {
        throw new ValidationError(`Role '${req.body.role}' does not exist`);
      }
      updates.role_id = req.body.role;
    }
    if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;

    const updated = await apiKeyRepo.update(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

const deactivateKey = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await apiKeyRepo.update(id, { is_active: false });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

module.exports = { createKey, listKeys, updateKey, deactivateKey };
```

- [ ] **Step 2: Create `src/routes/v1/key.routes.js`**

```js
const express = require('express');
const asyncHandler = require('../../utils/async-handler');
const auth = require('../../middleware/auth.middleware');
const permit = require('../../middleware/permission.middleware');
const { createKey, listKeys, updateKey, deactivateKey } = require('../../controllers/key.controller');

const router = express.Router();

// All key routes require admin — use wildcard check via permit
router.use(auth(), permit('*'));

router.post('/', asyncHandler(createKey));
router.get('/', asyncHandler(listKeys));
router.patch('/:id', asyncHandler(updateKey));
router.delete('/:id', asyncHandler(deactivateKey));

module.exports = router;
```

Note: `permit('*')` means only roles with the wildcard permission (admin) can access. This works because `permit` checks if the user's permissions include `'*'` first, and non-admin roles don't have it. Actually, re-reading the permit middleware — `permit('*')` would check `requiredPermissions.every(perm => userPermissions.includes(perm))`, so it checks if user has `'*'` in their permissions. Operators don't, admins do. This works correctly for admin-only.

- [ ] **Step 3: Register in `src/routes/v1/index.js`**

Add:
```js
const keyRoutes = require('./key.routes');
```

Add to router:
```js
router.use('/keys', keyRoutes);
```

- [ ] **Step 4: Commit**

```bash
git add src/controllers/key.controller.js src/routes/v1/key.routes.js src/routes/v1/index.js
git commit -m "feat: add API key management routes (admin only)"
```

---

### Task 9: AI Prompt Management Routes

**Files:**
- Create: `src/controllers/prompt.controller.js`
- Create: `src/routes/v1/prompt.routes.js`
- Modify: `src/routes/v1/index.js`

- [ ] **Step 1: Create `src/controllers/prompt.controller.js`**

```js
const aiPromptRepo = require('../database/repositories/ai-prompt.repository');

const listActivePrompts = async (req, res, next) => {
  try {
    const prompts = await aiPromptRepo.findAllActive();
    res.json({ success: true, data: prompts });
  } catch (error) {
    next(error);
  }
};

const getActivePrompt = async (req, res, next) => {
  try {
    const { store } = req.params;
    const prompt = await aiPromptRepo.findActiveByStore(store);
    if (!prompt) {
      return res.status(404).json({ success: false, error: `No active prompt for store '${store}'` });
    }
    res.json({ success: true, data: prompt });
  } catch (error) {
    next(error);
  }
};

const getPromptHistory = async (req, res, next) => {
  try {
    const { store } = req.params;
    const history = await aiPromptRepo.getHistory(store);
    res.json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
};

const createPrompt = async (req, res, next) => {
  try {
    const { store } = req.params;
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ success: false, error: 'prompt is required in request body' });
    }

    const record = await aiPromptRepo.create({
      storeName: store,
      promptText: prompt,
      createdBy: req.apiKey?.id || null
    });

    res.status(201).json({ success: true, data: record });
  } catch (error) {
    next(error);
  }
};

module.exports = { listActivePrompts, getActivePrompt, getPromptHistory, createPrompt };
```

- [ ] **Step 2: Create `src/routes/v1/prompt.routes.js`**

```js
const express = require('express');
const asyncHandler = require('../../utils/async-handler');
const auth = require('../../middleware/auth.middleware');
const permit = require('../../middleware/permission.middleware');
const {
  listActivePrompts,
  getActivePrompt,
  getPromptHistory,
  createPrompt
} = require('../../controllers/prompt.controller');

const router = express.Router();

router.use(auth());

router.get('/', permit('ai:prompts:read'), asyncHandler(listActivePrompts));
router.get('/:store', permit('ai:prompts:read'), asyncHandler(getActivePrompt));
router.get('/:store/history', permit('ai:prompts:read'), asyncHandler(getPromptHistory));
router.post('/:store', permit('ai:prompts:write'), asyncHandler(createPrompt));

module.exports = router;
```

- [ ] **Step 3: Register in `src/routes/v1/index.js`**

Add:
```js
const promptRoutes = require('./prompt.routes');
```

Add to router:
```js
router.use('/prompts', promptRoutes);
```

- [ ] **Step 4: Commit**

```bash
git add src/controllers/prompt.controller.js src/routes/v1/prompt.routes.js src/routes/v1/index.js
git commit -m "feat: add AI prompt management routes"
```

---

### Task 10: Audit Log Route

**Files:**
- Create: `src/controllers/audit.controller.js`
- Create: `src/routes/v1/audit.routes.js`
- Modify: `src/routes/v1/index.js`

- [ ] **Step 1: Create `src/controllers/audit.controller.js`**

```js
const auditLogRepo = require('../database/repositories/audit-log.repository');

const queryAuditLogs = async (req, res, next) => {
  try {
    const { action, api_key_id, start_date, end_date, limit, offset } = req.query;

    const results = await auditLogRepo.query({
      action,
      apiKeyId: api_key_id,
      startDate: start_date,
      endDate: end_date,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0
    });

    res.json({ success: true, ...results });
  } catch (error) {
    next(error);
  }
};

module.exports = { queryAuditLogs };
```

- [ ] **Step 2: Create `src/routes/v1/audit.routes.js`**

```js
const express = require('express');
const asyncHandler = require('../../utils/async-handler');
const auth = require('../../middleware/auth.middleware');
const permit = require('../../middleware/permission.middleware');
const { queryAuditLogs } = require('../../controllers/audit.controller');

const router = express.Router();

router.use(auth());
router.get('/', permit('audit:read'), asyncHandler(queryAuditLogs));

module.exports = router;
```

- [ ] **Step 3: Register in `src/routes/v1/index.js`**

Add:
```js
const auditRoutes = require('./audit.routes');
```

Add to router:
```js
router.use('/audit', auditRoutes);
```

- [ ] **Step 4: Commit**

```bash
git add src/controllers/audit.controller.js src/routes/v1/audit.routes.js src/routes/v1/index.js
git commit -m "feat: add audit log query route"
```

---

### Task 11: Wire Auth Middleware to Existing Routes

**Files:**
- Modify: `src/routes/v1/migration.routes.js`
- Modify: `src/routes/v1/sync.routes.js`
- Modify: `src/routes/v1/product.routes.js`
- Modify: `src/routes/v1/health.routes.js`

- [ ] **Step 1: Add auth + permit to migration routes**

In `src/routes/v1/migration.routes.js`, add imports at the top:

```js
const auth = require('../../middleware/auth.middleware');
const permit = require('../../middleware/permission.middleware');
```

Add `auth(), permit('migrate:product'),` before the validation array on each route:
- `POST /product` → `auth(), permit('migrate:product'), [...]`
- `POST /products/batch` → `auth(), permit('migrate:batch'), [...]`
- `POST /product/shopify` → `auth(), permit('migrate:shopify'), [...]`

- [ ] **Step 2: Add auth + permit to sync routes**

Read `src/routes/v1/sync.routes.js` first, then add auth/permit:
- Price sync route → `auth(), permit('sync:prices'), [...]`
- Product fields route → `auth(), permit('sync:product-fields'), [...]`

- [ ] **Step 3: Add auth + permit to product routes**

Read `src/routes/v1/product.routes.js` first, then add:
- Product lookup → `auth(), permit('product:read'), [...]`

- [ ] **Step 4: Health routes — no auth**

Health routes remain unprotected. No changes needed. Verify by reading `src/routes/v1/health.routes.js`.

- [ ] **Step 5: Commit**

```bash
git add src/routes/v1/migration.routes.js src/routes/v1/sync.routes.js src/routes/v1/product.routes.js
git commit -m "feat: wire auth and permission middleware to existing routes"
```

---

### Task 12: Integrate Audit Logging into Controllers

**Files:**
- Modify: `src/controllers/migration.controller.js`
- Modify: `src/controllers/sync.controller.js`

- [ ] **Step 1: Add audit logging to migration controller**

In `src/controllers/migration.controller.js`, add import:

```js
const auditService = require('../services/audit/audit.service');
```

In `migrateProduct`, after `const result = await orchestrator.migrateProduct(sku, options);`, add:

```js
await auditService.logAction({
  apiKeyId: req.apiKey?.id,
  action: 'product:migrated',
  resourceType: 'product',
  resourceId: sku,
  metadata: { targetStores: options.targetMagentoStores, success: result.success },
  status: result.success ? 'success' : 'partial',
  durationMs: Date.now() - /* need start time */
});
```

Capture `const startTime = Date.now();` at the top of the try block. Use `Date.now() - startTime` for `durationMs`.

Apply similar pattern to `migrateProductsBatch` (log one entry for the whole batch) and `migrateProductToShopify`.

- [ ] **Step 2: Add audit logging to sync controller**

Read `src/controllers/sync.controller.js` first. Add similar audit calls for price sync and product field update actions.

- [ ] **Step 3: Commit**

```bash
git add src/controllers/migration.controller.js src/controllers/sync.controller.js
git commit -m "feat: add audit logging to migration and sync controllers"
```

---

### Task 13: Integrate DB Prompts into Content Generation

**Files:**
- Modify: `src/services/migration/orchestrator.service.js`
- Modify: `src/services/ai/content-generation.service.js`

- [ ] **Step 1: Modify orchestrator to merge DB prompts with request prompts**

In `src/services/migration/orchestrator.service.js`, add import:

```js
const aiPromptRepo = require('../../database/repositories/ai-prompt.repository');
```

In the `migrateProduct` method, where `storePrompts` is resolved from `options.storePrompts`, add DB fallback logic:

```js
// Merge DB prompts with request prompts (request takes priority)
const requestPrompts = options.storePrompts || {};
const dbPrompts = {};

for (const storeName of targetMagentoStores) {
  if (!requestPrompts[storeName]) {
    const dbPrompt = await aiPromptRepo.findActiveByStore(storeName);
    if (dbPrompt) {
      dbPrompts[storeName] = { prompt: dbPrompt.prompt_text };
    }
  }
}

const mergedPrompts = { ...dbPrompts, ...requestPrompts };
```

Pass `mergedPrompts` instead of `options.storePrompts` to `contentGenerationService.generateForStores()`.

**Important:** The orchestrator has TWO code paths that use `storePrompts` — one for configurable products and one for standalone simple products. Apply the DB prompt merge logic in BOTH paths, or refactor the prompt resolution to happen once before the product type branch.

- [ ] **Step 2: Commit**

```bash
git add src/services/migration/orchestrator.service.js
git commit -m "feat: integrate database prompts with request prompt fallback"
```

---

### Task 14: Docker Configuration

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example` (already done in Task 1)

- [ ] **Step 1: Add postgres service to `docker-compose.yml`**

Add the `postgres` service before `magento-migration-api`:

```yaml
  postgres:
    image: postgres:16-alpine
    container_name: migration-postgres
    restart: unless-stopped
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
    networks:
      - magento-network
```

Add `depends_on` to `magento-migration-api`:

```yaml
    depends_on:
      postgres:
        condition: service_healthy
```

Add DB env vars to the API service environment:

```yaml
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_NAME=migration_api
      - DB_USER=migration_user
      - DB_PASSWORD=${DB_PASSWORD}
      - AUTH_ENABLED=${AUTH_ENABLED:-false}
```

Add the `pgdata` volume at the bottom:

```yaml
volumes:
  pgdata:
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add PostgreSQL service to docker-compose"
```

---

### Task 15: Bootstrap CLI Script

Create a script to generate the first admin API key for initial deployment.

**Files:**
- Create: `scripts/create-admin-key.js`

- [ ] **Step 1: Create `scripts/create-admin-key.js`**

```js
#!/usr/bin/env node
require('dotenv').config();

const db = require('../src/database/connection');
const apiKeyRepo = require('../src/database/repositories/api-key.repository');
const { generateApiKey, hashSecret } = require('../src/utils/api-key.utils');

async function main() {
  const name = process.argv[2] || 'admin-bootstrap';

  try {
    await db.migrate.latest();
    await db.seed.run();

    const { rawKey, prefix, secret } = generateApiKey();
    const keyHash = await hashSecret(secret);

    const record = await apiKeyRepo.create({
      name,
      keyPrefix: prefix,
      keyHash,
      roleId: 'admin'
    });

    console.log('\n=== Admin API Key Created ===');
    console.log(`Name:  ${record.name}`);
    console.log(`ID:    ${record.id}`);
    console.log(`Key:   ${rawKey}`);
    console.log('\nSave this key now — it cannot be retrieved again.\n');
  } catch (error) {
    console.error('Failed to create admin key:', error.message);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();
```

- [ ] **Step 2: Add npm script to `package.json`**

```json
"create-admin-key": "node scripts/create-admin-key.js"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/create-admin-key.js package.json
git commit -m "feat: add bootstrap CLI script for first admin API key"
```

---

### Task 16: Run Full Test Suite and Verify

- [ ] **Step 1: Start PostgreSQL locally (or via docker)**

Run: `docker run --rm -d --name test-postgres -e POSTGRES_DB=migration_api_test -e POSTGRES_USER=migration_user -e POSTGRES_PASSWORD=test -p 5432:5432 postgres:16-alpine`

- [ ] **Step 2: Set test env vars**

```bash
export DB_HOST=localhost DB_PORT=5432 DB_NAME=migration_api_test DB_USER=migration_user DB_PASSWORD=test
```

- [ ] **Step 3: Run all tests**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 4: Stop test database**

Run: `docker stop test-postgres`

- [ ] **Step 5: Verify docker-compose works end-to-end**

Run: `docker-compose up --build -d`
Check logs: `docker-compose logs -f magento-migration-api` — should see "Database migrations complete" and "Database seeds complete"
Run: `docker-compose down`
