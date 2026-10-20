const Target = require('../../../src/services/shopify/shopify-replication-target.service');

test('updates variants in bounded batches without replacing the destination variant list', async () => {
  const client = { query: jest.fn().mockResolvedValue({ data: {} }) };
  const variants = Array.from({ length: 251 }, (_, index) => ({ id: String(index), price: '3.00' }));
  await new Target(client).variants('product', variants);
  expect(client.query.mock.calls.map(call => call[1].variants.length)).toEqual([100, 100, 51]);
  expect(client.query.mock.calls.every(call => call[0].includes('productVariantsBulkUpdate'))).toBe(true);
  expect(client.query.mock.calls.every(call => !call[0].includes('productSet'))).toBe(true);
});

test('replaces images without sending collections, metafields, or a destructive variant list', async () => {
  const client = { query: jest.fn().mockResolvedValue({ data: {} }) };
  await new Target(client).files('product', [{ id: 'file', alt: 'Front' }]);
  expect(client.query.mock.calls[0][1]).toEqual({ identifier: { id: 'product' }, input: { files: [{ id: 'file', alt: 'Front' }] } });
});

test('adding variants explicitly preserves a standalone Default Title variant', async () => {
  const client = { query: jest.fn().mockResolvedValue({ data: {} }) };
  await new Target(client).variants('product', [{ inventoryItem: { sku: 'new' } }], true);
  expect(client.query.mock.calls[0][0]).toContain('strategy: PRESERVE_STANDALONE_VARIANT');
});

test('seeds the shell with a real variant when the source option matrix is sparse', async () => {
  const client = { query: jest.fn().mockResolvedValue({ data: { productCreate: { product: { id: 'new' } } } }) };
  const source = { options: [{ name: 'Color', position: 1, values: ['Red', 'Blue'] }, { name: 'Size', position: 2, values: ['S', 'M'] }],
    variants: [{ selectedOptions: [{ name: 'Color', value: 'Red' }, { name: 'Size', value: 'M' }] }] };
  await new Target(client).createShell(source, 'recovery', { title: 'Approved' }, 'DRAFT');
  expect(client.query.mock.calls[0][1].product.productOptions[1].values).toEqual([{ name: 'M' }, { name: 'S' }]);
});
