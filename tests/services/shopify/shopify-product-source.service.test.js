const Source = require('../../../src/services/shopify/shopify-product-source.service');

test('extracts every page of variants and images independently', async () => {
  const client = { query: jest.fn(async (query, variables) => {
    if (query.includes('ReplicationProduct')) return { data: { product: { id: 'p', title: 'Approved' } } };
    const field = query.includes('variants(first') ? 'variants' : 'media';
    const suffix = variables.after ? 'second' : 'first';
    return { data: { product: { [field]: { nodes: [{ id: `${field}-${suffix}`, mediaContentType: 'IMAGE', image: { url: suffix } }],
      pageInfo: { hasNextPage: !variables.after, endCursor: 'next' } } } } };
  }) };
  const product = await new Source(client).product('p');
  expect(product.variants.map(v => v.id)).toEqual(['variants-first', 'variants-second']);
  expect(product.images.map(v => v.id)).toEqual(['media-first', 'media-second']);
  expect(client.query).toHaveBeenCalledTimes(5);
});

test('SKU search paginates and filters inexact Shopify search matches', async () => {
  const client = { query: jest.fn().mockResolvedValueOnce({ data: { productVariants: { nodes: [{ sku: 'SKU' }, { sku: 'SKU-PREFIX' }],
    pageInfo: { hasNextPage: true, endCursor: 'next' } } } }).mockResolvedValueOnce({ data: { productVariants: { nodes: [{ sku: 'SKU' }],
    pageInfo: { hasNextPage: false } } } }) };
  expect(await new Source(client).bySkus(['SKU'])).toHaveLength(2);
});

test('SKU lookup propagates failures instead of treating them as no existing product', async () => {
  const client = { query: jest.fn().mockRejectedValue(new Error('Forbidden')) };
  await expect(new Source(client).bySkus(['SKU'])).rejects.toThrow('Forbidden');
});
