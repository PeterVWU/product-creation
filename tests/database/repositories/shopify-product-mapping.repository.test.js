const db = require('../../../src/database/connection');
const repository = require('../../../src/database/repositories/shopify-product-mapping.repository');
const key = { source_shop: 'source.test', source_product_id: 'product', target_shop: 'target.test' };
beforeAll(async () => { await db.migrate.latest(); });
afterEach(async () => { await db('shopify_product_mappings').where({ source_shop: 'source.test' }).del(); });
afterAll(async () => { await db.destroy(); });

test('serializes concurrent requests and persists checkpoints returned after a remote failure', async () => {
  let enters = 0;
  const first = repository.withMapping(key, 'stable-handle', async (row, save) => {
    enters++;
    await save({ target_product_id: 'destination-product', variants: { source: 'target' } });
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(enters).toBe(1);
    return { success: false, error: 'remote image upload failure' };
  });
  const second = repository.withMapping(key, 'stable-handle', async row => {
    enters++;
    expect(row.target_product_id).toBe('destination-product');
    expect(row.variants).toEqual({ source: 'target' });
    return { success: true };
  });
  expect(await Promise.all([first, second])).toEqual([{ success: false, error: 'remote image upload failure' }, { success: true }]);
  expect(await db('shopify_product_mappings').where(key)).toHaveLength(1);
});

test('prevents two source products claiming the same destination product', async () => {
  await repository.withMapping(key, 'one', async (row, save) => save({ target_product_id: 'destination' }));
  await expect(repository.withMapping({ ...key, source_product_id: 'other' }, 'two', async (row, save) =>
    save({ target_product_id: 'destination' }))).rejects.toThrow(/unique/);
});
