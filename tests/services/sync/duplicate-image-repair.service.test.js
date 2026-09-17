'use strict';

process.env.SOURCE_MAGENTO_BASE_URL = 'http://source.test';
process.env.SOURCE_MAGENTO_TOKEN = 'test-token';

const DuplicateImageRepairService = require('../../../src/services/sync/duplicate-image-repair.service');

function imageHttpClient(bytesByUrl) {
  return {
    get: jest.fn(async url => ({ data: Buffer.from(bytesByUrl[url] || url) }))
  };
}

describe('DuplicateImageRepairService', () => {
  it('reassigns Shopify variants before deleting exact duplicate media', async () => {
    let media = [
      { id: 'media-a', alt: 'A', image: { url: 'https://cdn.test/a.jpg' } },
      { id: 'media-b', alt: 'B', image: { url: 'https://cdn.test/b.jpg' } }
    ];
    const variants = [
      { id: 'variant-a', sku: 'A', media: { nodes: [{ id: 'media-a' }] } },
      { id: 'variant-b', sku: 'B', media: { nodes: [{ id: 'media-b' }] } }
    ];
    const shopifyService = {
      getProductByHandle: jest.fn().mockResolvedValue({ id: 'product-1' }),
      searchProductsByTitle: jest.fn(),
      query: jest.fn(async () => ({
        data: {
          product: {
            id: 'product-1',
            title: 'Product',
            handle: 'product',
            media: { nodes: media },
            variants: { nodes: variants }
          }
        }
      })),
      appendMediaToVariants: jest.fn().mockResolvedValue([]),
      deleteAllProductMedia: jest.fn(async (_productId, ids) => {
        media = media.filter(item => !ids.includes(item.id));
      })
    };
    const service = new DuplicateImageRepairService({
      httpClient: imageHttpClient({
        'https://cdn.test/a.jpg': 'same-image',
        'https://cdn.test/b.jpg': 'same-image'
      }),
      shopifyServiceFactory: async () => shopifyService
    });

    const result = await service.repairShopifyStore('eliquidcom', 'Product', {
      handle: 'product',
      dryRun: false
    });

    expect(shopifyService.appendMediaToVariants).toHaveBeenCalledWith('product-1', [{
      variantId: 'variant-b',
      mediaIds: ['media-a']
    }]);
    expect(shopifyService.deleteAllProductMedia).toHaveBeenCalledWith('product-1', ['media-b']);
    expect(result.before.duplicateCopies).toBe(1);
    expect(result.after.duplicateCopies).toBe(0);
    expect(result.success).toBe(true);
  });

  it('reports Shopify duplicates without mutating during a dry run', async () => {
    const shopifyService = {
      getProductByHandle: jest.fn().mockResolvedValue({ id: 'product-1' }),
      query: jest.fn().mockResolvedValue({
        data: {
          product: {
            id: 'product-1',
            title: 'Product',
            handle: 'product',
            media: { nodes: [
              { id: 'media-a', image: { url: 'https://cdn.test/a.jpg' } },
              { id: 'media-b', image: { url: 'https://cdn.test/b.jpg' } }
            ] },
            variants: { nodes: [] }
          }
        }
      }),
      appendMediaToVariants: jest.fn(),
      deleteAllProductMedia: jest.fn()
    };
    const service = new DuplicateImageRepairService({
      httpClient: imageHttpClient({
        'https://cdn.test/a.jpg': 'same-image',
        'https://cdn.test/b.jpg': 'same-image'
      }),
      shopifyServiceFactory: async () => shopifyService
    });

    const result = await service.repairShopifyStore('ejuicesco', 'Product', {
      handle: 'product',
      dryRun: true
    });

    expect(result.before.duplicateCopies).toBe(1);
    expect(result.after).toBeNull();
    expect(shopifyService.deleteAllProductMedia).not.toHaveBeenCalled();
  });

  it('deletes only duplicate Magento parent media and keeps the canonical role image', async () => {
    let product = {
      sku: 'SKU-1',
      media_gallery_entries: [
        { id: 10, file: '/a.jpg', position: 1, types: ['image', 'small_image', 'thumbnail'] },
        { id: 11, file: '/b.jpg', position: 2, types: [] }
      ]
    };
    const magentoService = {
      _baseUrl: 'https://magento.test',
      getProductBySku: jest.fn(async () => product),
      delete: jest.fn(async route => {
        const id = Number(route.split('/').pop());
        product = {
          ...product,
          media_gallery_entries: product.media_gallery_entries.filter(item => item.id !== id)
        };
      })
    };
    const service = new DuplicateImageRepairService({
      httpClient: imageHttpClient({
        'https://magento.test/media/catalog/product/a.jpg': 'same-image',
        'https://magento.test/media/catalog/product/b.jpg': 'same-image'
      }),
      magentoServiceFactory: () => magentoService
    });

    const result = await service.repairMagentoStore('misthub', 'SKU-1', { dryRun: false });

    expect(magentoService.delete).toHaveBeenCalledWith('/rest/V1/products/SKU-1/media/11');
    expect(result.before.duplicateCopies).toBe(1);
    expect(result.after.duplicateCopies).toBe(0);
    expect(result.success).toBe(true);
  });
});
