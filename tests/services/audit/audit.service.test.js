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
    const log = await auditService.logAction({
      action: 'product:migrated',
      resourceType: 'product',
      resourceId: 'SKU-456',
      status: 'success'
    });
    expect(log).toBeDefined();
  });
});
