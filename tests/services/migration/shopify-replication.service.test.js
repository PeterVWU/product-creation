jest.mock('../../../src/services/notification/notification.service');
jest.mock('../../../src/database/repositories/shopify-product-mapping.repository', () => ({}));
jest.mock('../../../src/services/shopify/shopify-store-registry.service', () => ({}));
const Service = require('../../../src/services/migration/shopify-replication.service');
const { rewriteDescription } = Service;
const copy = value => JSON.parse(JSON.stringify(value));
const sourceProduct = () => ({
  id: 'gid://shopify/Product/1', title: 'Approved', descriptionHtml: '<a href="https://vapordna.com/products/a?q=1#x">A</a>',
  vendor: 'Vendor', productType: 'Liquid', tags: ['approved'], seo: { title: 'SEO', description: 'Description' },
  options: [{ name: 'Size', position: 1, values: ['Small', 'Large'] }], images: [],
  variants: ['Small', 'Large'].map((value, index) => ({ id: `s${index}`, sku: `SKU-${index}`, price: '12.50', compareAtPrice: null,
    barcode: '123', taxable: true, inventoryPolicy: 'DENY', selectedOptions: [{ name: 'Size', value }], media: { nodes: [] } }))
});

function fixture() {
  let target = null;
  const product = sourceProduct();
  const row = { creation_handle: 'migration-handle', variants: {}, images: {}, initialized: false, created_by_migration: false };
  const save = jest.fn(async values => Object.assign(row, copy(values)));
  const reader = {
    shop: jest.fn(async () => ({ id: 'target-shop', name: 'Cloud & Co', myshopifyDomain: 'target.myshopify.com', primaryDomain: { url: 'https://public.example' } })),
    product: jest.fn(async () => copy(target)), byHandle: jest.fn(async () => null), bySkus: jest.fn(async () => [])
  };
  const writer = {
    createShell: jest.fn(async () => { target = { ...copy(product), id: 'target-product', variants: [{ ...copy(product.variants[0]), id: 'default', sku: '' }] }; return target.id; }),
    content: jest.fn(async (id, fields) => Object.assign(target, fields)), files: jest.fn(), upload: jest.fn(), detachMedia: jest.fn(),
    variants: jest.fn(async (id, variants, create) => {
      if (create) target.variants.push(...variants.map((input, index) => ({ id: `new${target.variants.length - 1 + index}`, sku: input.inventoryItem.sku,
        selectedOptions: input.optionValues.map(value => ({ name: value.optionName, value: value.name })) })));
    })
  };
  const source = { shop: jest.fn(async () => ({ id: 'source-shop', myshopifyDomain: 'source.myshopify.com' })), product: jest.fn(async () => copy(product)) };
  const sourceClient = {}; const targetClient = { publishProduct: jest.fn(async () => ({})) };
  const notifications = Object.fromEntries(['notifyMigrationStart', 'notifyMigrationEnd', 'notifyProductUpdateStart', 'notifyProductUpdateEnd',
    'notifyPriceSyncStart', 'notifyPriceSyncEnd'].map(name => [name, jest.fn()]));
  const registry = { getTargetService: jest.fn(async alias => { if (alias === 'bad') throw new Error('Unreachable store'); return alias === 'vapordna' ? sourceClient : targetClient; }) };
  const service = new Service({ registry, mappings: { withMapping: jest.fn(async (key, handle, fn) => fn(row, save)) }, notifications,
    sourceFor: client => client === sourceClient ? source : reader, targetFor: () => writer });
  return { service, row, save, product, reader, writer, targetClient, notifications, setTarget: value => { target = value; } };
}
const options = { targetShopifyStores: ['test'], includeImages: false };

describe('Shopify replication', () => {
  test('creates approved content, tracked variants, and draft status without inventory quantities; retries do not create duplicates', async () => {
    const f = fixture();
    const result = await f.service.run('1', options);
    expect(result.success).toBe(true);
    expect(f.writer.createShell).toHaveBeenCalledWith(expect.anything(), 'migration-handle', expect.objectContaining({
      title: 'Approved', descriptionHtml: '<a href="https://public.example/products/a?q=1#x">A</a>'
    }), 'DRAFT');
    expect(f.row.variants).toEqual({ s0: 'default', s1: 'new0' });
    const inputs = f.writer.variants.mock.calls.flatMap(call => call[1]);
    expect(inputs.every(input => input.inventoryItem.tracked === true)).toBe(true);
    expect(JSON.stringify(inputs)).not.toMatch(/inventoryQuantities|quantityAdjustments|metafields/);
    expect(await f.service.run('1', options)).toMatchObject({ success: true });
    expect(f.writer.createShell).toHaveBeenCalledTimes(1);
    expect(f.writer.variants.mock.calls.filter(call => call[2])).toHaveLength(1);
  });

  test('honors explicit creation status and retains the source handle after initialization', async () => {
    const f = fixture(); f.product.handle = 'approved-handle';
    expect((await f.service.run('1', { ...options, productStatus: 'ACTIVE' })).success).toBe(true);
    expect(f.writer.createShell.mock.calls[0][3]).toBe('ACTIVE');
    expect(f.writer.content).toHaveBeenCalledWith(expect.anything(), { handle: 'approved-handle' });
  });

  test('includeImages false leaves existing media unchanged during content updates', async () => {
    const f = fixture(); await f.service.run('1', options);
    expect((await f.service.run('1', options, 'content')).success).toBe(true);
    expect(f.writer.files).not.toHaveBeenCalled();
    expect(f.writer.upload).not.toHaveBeenCalled();
    expect(f.writer.detachMedia).not.toHaveBeenCalled();
  });

  test('content updates map changed SKUs by variant ID, preserve extra variants, stock and status', async () => {
    const f = fixture(); await f.service.run('1', options);
    f.product.variants[0].sku = 'NEW-SKU';
    f.writer.variants.mockClear();
    expect((await f.service.run('1', options, 'content')).success).toBe(true);
    expect(f.writer.content.mock.calls[0][1]).not.toHaveProperty('status');
    expect(f.writer.content.mock.calls[0][1]).not.toHaveProperty('collections');
    expect(f.writer.content.mock.calls[0][1]).not.toHaveProperty('metafields');
    expect(f.writer.variants.mock.calls.flatMap(call => call[1])).toContainEqual({ id: 'default', inventoryItem: { sku: 'NEW-SKU' } });
    expect(f.writer.createShell).toHaveBeenCalledTimes(1);
  });

  test('price sync changes only prices, clears compare-at, and refuses missing variants', async () => {
    const f = fixture(); await f.service.run('1', options); f.writer.variants.mockClear();
    expect((await f.service.run('1', options, 'prices')).success).toBe(true);
    expect(f.writer.variants.mock.calls[0][1]).toEqual([
      { id: 'default', price: '12.50', compareAtPrice: null }, { id: 'new0', price: '12.50', compareAtPrice: null }
    ]);
    f.product.variants.push({ ...f.product.variants[0], id: 's2', sku: 'SKU-2', selectedOptions: [{ name: 'Size', value: 'XL' }] });
    expect(await f.service.run('1', options, 'prices')).toMatchObject({ success: false, results: { test: { error: expect.stringContaining('run migration') } } });
  });

  test('rejects same shop even under a different alias', async () => {
    const f = fixture(); f.reader.shop.mockResolvedValue({ id: 'source-shop' });
    expect(await f.service.run('1', options)).toMatchObject({ success: false, results: { test: { error: expect.stringContaining('different') } } });
    expect(f.writer.createShell).not.toHaveBeenCalled();
  });

  test('isolates destination failures and emits notifications with independent results', async () => {
    const f = fixture(); const result = await f.service.run('1', { ...options, targetShopifyStores: ['bad', 'test'] });
    expect(result).toMatchObject({ success: false, results: { bad: { success: false }, test: { success: true } }, summary: { storesSucceeded: 1 } });
    expect(f.notifications.notifyMigrationEnd).toHaveBeenCalledWith(result);
  });

  test.each([
    [{ id: 'a', sku: 'SKU-0', product: { id: 'p1' } }, { id: 'b', sku: 'SKU-1', product: { id: 'p2' } }],
    [{ id: 'a', sku: 'SKU-0', product: { id: 'p1' } }, { id: 'b', sku: 'SKU-0', product: { id: 'p1' } }]
  ])('rejects ambiguous SKU adoption', async (...matches) => {
    const f = fixture(); f.reader.bySkus.mockResolvedValue(matches);
    expect(await f.service.run('1', options)).toMatchObject({ success: false, results: { test: { error: expect.stringContaining('Ambiguous') } } });
    expect(f.writer.createShell).not.toHaveBeenCalled();
  });

  test('adopts a partially populated destination, adds missing variants, and retains destination-only variants', async () => {
    const f = fixture();
    const target = { ...copy(f.product), id: 'existing', variants: [
      { ...copy(f.product.variants[0]), id: 'existing0' },
      { ...copy(f.product.variants[0]), id: 'extra', sku: 'DEST-ONLY', selectedOptions: [{ name: 'Size', value: 'Destination only' }] }
    ] };
    f.setTarget(target);
    f.reader.bySkus.mockResolvedValue([{ sku: 'SKU-0', id: 'existing0', product: { id: 'existing' } }]);
    expect((await f.service.run('1', options)).success).toBe(true);
    expect(target.variants.map(v => v.id)).toContain('extra');
    expect(target.variants).toHaveLength(3);
    expect(f.writer.createShell).not.toHaveBeenCalled();
    expect(f.writer.variants.mock.calls.filter(call => call[2])[0][1]).toHaveLength(1);
  });

  test('adding a missing variant copies its image and retains existing destination images', async () => {
    const f = fixture(); await f.service.run('1', options);
    f.product.images = [{ id: 'source-image', alt: 'New variant', image: { url: 'https://cdn.example/new.jpg' } }];
    f.product.variants.push({ ...copy(f.product.variants[0]), id: 's2', sku: 'SKU-2',
      selectedOptions: [{ name: 'Size', value: 'XL' }], media: { nodes: [{ id: 'source-image' }] } });
    const target = { ...copy(f.product), images: [{ id: 'existing-image', alt: 'Keep me' }],
      variants: f.product.variants.slice(0, 2).map((variant, index) => ({ ...copy(variant), id: index ? 'new0' : 'default' })) };
    f.setTarget(target); f.writer.upload.mockResolvedValue({ id: 'new-image' }); f.writer.variants.mockClear();
    expect((await f.service.run('1', { ...options, includeImages: true })).success).toBe(true);
    expect(f.writer.files).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining([
      { id: 'existing-image', alt: 'Keep me' }, expect.objectContaining({ id: 'new-image' })
    ]));
    expect(f.writer.variants.mock.calls.filter(call => call[2])[0][1][0].mediaId).toBe('new-image');
  });

  test('retries publication failure without creating another product or changing its status', async () => {
    const f = fixture(); f.targetClient.publishProduct.mockRejectedValueOnce(new Error('Publication unavailable'));
    expect((await f.service.run('1', options)).success).toBe(false);
    expect(f.row.initialized).toBe(true);
    expect((await f.service.run('1', options)).success).toBe(true);
    expect(f.writer.createShell).toHaveBeenCalledTimes(1);
    expect(f.targetClient.publishProduct).toHaveBeenCalledTimes(2);
  });

  test('recovers a created shell when the original response was lost', async () => {
    const f = fixture(); await f.writer.createShell(); f.reader.byHandle.mockResolvedValue('target-product');
    f.writer.createShell.mockClear();
    expect((await f.service.run('1', options)).success).toBe(true);
    expect(f.writer.createShell).not.toHaveBeenCalled();
  });

  test('persists image checkpoints and retries failed upload without losing successful uploads', async () => {
    const f = fixture();
    f.product.images = ['a', 'b'].map(id => ({ id, alt: id, image: { url: `https://cdn.example/${id}.jpg` } }));
    f.writer.upload.mockResolvedValueOnce({ id: 'file-a' }).mockRejectedValueOnce(new Error('Upload failed'));
    expect((await f.service.run('1', { ...options, includeImages: true })).success).toBe(false);
    expect(f.row.images.a.id).toBe('file-a');
    expect(f.writer.files).not.toHaveBeenCalled();
    f.writer.upload.mockResolvedValue({ id: 'file-b' });
    expect((await f.service.run('1', { ...options, includeImages: true })).success).toBe(true);
    expect(f.writer.upload).toHaveBeenCalledTimes(3);
    expect(f.writer.createShell).toHaveBeenCalledTimes(1);
  });

  test('explicit migration re-creates a missing mapped variant while retaining the remaining variant', async () => {
    const f = fixture(); f.row.target_product_id = 'target'; f.row.variants = { s0: 'deleted', s1: 'keep' };
    const target = { ...copy(f.product), id: 'target', variants: [{ ...copy(f.product.variants[1]), id: 'keep' }] };
    f.setTarget(target);
    const result = await f.service.run('1', options);
    expect(result).toMatchObject({ success: true, results: { test: { variantsCreated: 1 } } });
    expect(target.variants.map(v => v.id)).toContain('keep');
    expect(f.row.variants.s0).not.toBe('deleted');
    expect(f.row.variants.s1).toBe('keep');
  });

  test('content image refresh detaches obsolete mapped variant associations', async () => {
    const f = fixture();
    await f.service.run('1', options);
    const target = { ...copy(f.product), variants: f.product.variants.map((variant, index) => ({
      ...copy(variant), id: index ? 'new0' : 'default', media: { nodes: [{ id: 'old-image' }] }
    })) };
    f.setTarget(target);
    expect((await f.service.run('1', { ...options, includeImages: true }, 'content')).success).toBe(true);
    expect(f.writer.detachMedia).toHaveBeenCalledWith(expect.anything(), [
      { variantId: 'default', mediaIds: ['old-image'] }, { variantId: 'new0', mediaIds: ['old-image'] }
    ]);
  });

  test('requires explicit destinations and valid IDs; rejects source duplicate/empty SKUs', async () => {
    const f = fixture();
    await expect(f.service.run('bad', options)).rejects.toThrow('sourceProductId');
    await expect(f.service.run('1', {})).rejects.toThrow('targetShopifyStores');
    f.product.variants[0].sku = '';
    await expect(f.service.run('1', options)).rejects.toThrow('unique SKUs');
  });
});

describe('description URL replacement', () => {
  test('replaces exact hosts with public domain, retaining URL suffixes and unrelated content', () => {
    const html = `<a href="https://vapordna.com/products/x?a=1&amp;b=2#x">VaporDNA</a>
<img src='//www.vapordna.com:443/a.jpg'><a href="http://VAPORDNA.COM/">Link</a>
https://vapordna.com.evil.example/a https://other.example/vapordna.com support@vapordna.com`;
    expect(rewriteDescription(html, 'https://store.example')).toBe(`<a href="https://store.example/products/x?a=1&amp;b=2#x">VaporDNA</a>
<img src='//store.example/a.jpg'><a href="https://store.example/">Link</a>
https://vapordna.com.evil.example/a https://other.example/vapordna.com support@vapordna.com`);
  });
});

describe('destination branding', () => {
  const { rewriteStoreReferences } = Service;
  test('replaces brand names in HTML text and accessible labels without changing markup or URL paths', () => {
    const html = '<p>Shop VaporDNA, Vapor DNA, vApOrDnA.</p><a href="https://vapordna.com/VaporDNA?q=VaporDNA" title="Visit VaporDNA">VaporDNA</a><img alt="Vapor&nbsp;DNA"><a href="https://other.example/VaporDNA">Other</a>';
    expect(rewriteStoreReferences(html, 'https://cloud.example', 'Cloud & Co', true)).toBe(
      '<p>Shop Cloud &amp; Co, Cloud &amp; Co, Cloud &amp; Co.</p><a href="https://cloud.example/VaporDNA?q=VaporDNA" title="Visit Cloud &amp; Co">Cloud &amp; Co</a><img alt="Cloud &amp; Co"><a href="https://other.example/VaporDNA">Other</a>'
    );
  });
  test('replaces meta-description branding as plain text, retaining URL suffixes and email addresses', () => {
    expect(rewriteStoreReferences('Buy at VaporDNA. Visit https://vapordna.com/products/a?q=VaporDNA#x or support@vapordna.com.',
      'https://cloud.example', 'Cloud & Co')).toBe('Buy at Cloud & Co. Visit https://cloud.example/products/a?q=VaporDNA#x or support@vapordna.com.');
  });
  test('applies branding during creation and content updates, retaining the SEO title', async () => {
    const f = fixture();
    f.product.descriptionHtml = '<p>Shop at VaporDNA.</p>';
    f.product.seo = { title: 'Original SEO title', description: 'Buy at Vapor DNA.' };
    expect((await f.service.run('1', options)).success).toBe(true);
    expect(f.writer.createShell.mock.calls[0][2]).toMatchObject({
      descriptionHtml: '<p>Shop at Cloud &amp; Co.</p>', seo: { title: 'Original SEO title', description: 'Buy at Cloud & Co.' }
    });
    f.writer.content.mockClear();
    expect((await f.service.run('1', options, 'content')).success).toBe(true);
    expect(f.writer.content.mock.calls[0][1]).toMatchObject({
      descriptionHtml: '<p>Shop at Cloud &amp; Co.</p>', seo: { description: 'Buy at Cloud & Co.' }
    });
  });
});

test('rewrites bare storefront references without changing emails or lookalike domains', () => {
  expect(Service.rewriteStoreReferences('VaporDNA.com. www.vapordna.com — VaporDNA! support@vapordna.com vapordna.com.evil.example',
    'https://cloud.example', 'Cloud & Co')).toBe('cloud.example. cloud.example — Cloud & Co! support@vapordna.com vapordna.com.evil.example');
});
