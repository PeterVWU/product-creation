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
