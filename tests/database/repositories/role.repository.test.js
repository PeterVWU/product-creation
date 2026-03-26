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
