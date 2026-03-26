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
