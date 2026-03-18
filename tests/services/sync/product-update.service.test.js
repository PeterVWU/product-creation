'use strict';

jest.mock('../../../src/services/magento/source.service');
jest.mock('../../../src/services/magento/target.service');
jest.mock('../../../src/services/shopify/shopify-target.service');
jest.mock('../../../src/services/notification/google-chat.service');
jest.mock('../../../src/services/attribute.service');
jest.mock('../../../src/services/category-mapping.service');
jest.mock('../../../src/config', () => ({
  source: { baseUrl: 'http://source.test', token: 'tok' },
  api: {},
  shopify: { stores: { myshopify: { url: 'x.myshopify.com', token: 'st' } }, apiVersion: '2025-01' },
  magentoStores: { ejuices: { url: 'http://ejuices.test', token: 'mt' } },
  errorHandling: { continueOnError: true }
}));

const ProductUpdateService = require('../../../src/services/sync/product-update.service');

describe('ProductUpdateService', () => {
  let service;

  beforeEach(() => {
    service = new ProductUpdateService();
  });

  // ── classifyProductType ─────────────────────────────────────────────────────

  describe('classifyProductType', () => {
    it('returns "configurable" for configurable products', () => {
      expect(service.classifyProductType({ type_id: 'configurable', visibility: 4 }))
        .toBe('configurable');
    });

    it('returns "standalone-simple" for simple product with visibility > 1', () => {
      expect(service.classifyProductType({ type_id: 'simple', visibility: 4, sku: 'X' }))
        .toBe('standalone-simple');
    });

    it('throws for simple product with visibility === 1', () => {
      expect(() => service.classifyProductType({ type_id: 'simple', visibility: 1, sku: 'X' }))
        .toThrow('child simple');
    });

    it('throws for unsupported product type', () => {
      expect(() => service.classifyProductType({ type_id: 'bundle', sku: 'X' }))
        .toThrow('Unsupported product type');
    });

    it('throws when type_id is missing', () => {
      expect(() => service.classifyProductType({ sku: 'X' }))
        .toThrow();
    });
  });

  // ── extractCustomAttribute ─────────────────────────────────────────────────

  describe('extractCustomAttribute', () => {
    const product = {
      custom_attributes: [
        { attribute_code: 'description', value: 'Great product' },
        { attribute_code: 'meta_title', value: 'Meta T' }
      ]
    };

    it('returns value for existing attribute', () => {
      expect(service.extractCustomAttribute(product, 'description')).toBe('Great product');
    });

    it('returns null for missing attribute', () => {
      expect(service.extractCustomAttribute(product, 'meta_keyword')).toBeNull();
    });

    it('returns null when custom_attributes is absent', () => {
      expect(service.extractCustomAttribute({}, 'description')).toBeNull();
    });
  });

  // ── parseMetaKeywordsToTags ────────────────────────────────────────────────

  describe('parseMetaKeywordsToTags', () => {
    it('splits comma-separated keywords into trimmed array', () => {
      expect(service.parseMetaKeywordsToTags('a, b,  c ')).toEqual(['a', 'b', 'c']);
    });

    it('returns empty array for null input', () => {
      expect(service.parseMetaKeywordsToTags(null)).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(service.parseMetaKeywordsToTags('')).toEqual([]);
    });

    it('returns single-element array for no commas', () => {
      expect(service.parseMetaKeywordsToTags('keyword')).toEqual(['keyword']);
    });
  });

  // ── resolveMagentoTargetStores ────────────────────────────────────────────

  describe('resolveMagentoTargetStores', () => {
    it('returns provided stores when specified', () => {
      expect(service.resolveMagentoTargetStores(['ejuices'])).toEqual(['ejuices']);
    });

    it('defaults to all config.magentoStores when omitted', () => {
      expect(service.resolveMagentoTargetStores(undefined)).toEqual(['ejuices']);
    });

    it('defaults to all config.magentoStores for empty array', () => {
      expect(service.resolveMagentoTargetStores([])).toEqual(['ejuices']);
    });
  });

  // ── resolveShopifyTargetStores ────────────────────────────────────────────

  describe('resolveShopifyTargetStores', () => {
    it('returns provided stores when specified', () => {
      expect(service.resolveShopifyTargetStores(['myshopify'])).toEqual(['myshopify']);
    });

    it('defaults to all configured Shopify stores when omitted', () => {
      expect(service.resolveShopifyTargetStores(undefined)).toEqual(['myshopify']);
    });
  });

  // ── extractChildLinks ─────────────────────────────────────────────────────

  describe('extractChildLinks', () => {
    it('returns links from configurable_product_link_data', () => {
      const product = {
        extension_attributes: {
          configurable_product_link_data: [
            JSON.stringify({ simple_product_sku: 'CHILD-001', simple_product_id: 1 })
          ]
        }
      };
      expect(service.extractChildLinks(product)).toEqual([{ sku: 'CHILD-001', id: 1 }]);
    });

    it('returns empty array when no link data present', () => {
      expect(service.extractChildLinks({ extension_attributes: {} })).toEqual([]);
    });
  });

  // ── buildSourceImageUrls ──────────────────────────────────────────────────

  describe('buildSourceImageUrls', () => {
    it('prepends source base URL to relative image paths', () => {
      const entries = [
        { file: '/a/b.jpg', label: 'Front' },
        { file: '/c/d.jpg', label: 'Back' }
      ];
      const urls = service.buildSourceImageUrls(entries);
      expect(urls).toEqual([
        { url: 'http://source.test/media/catalog/product/a/b.jpg', alt: 'Front' },
        { url: 'http://source.test/media/catalog/product/c/d.jpg', alt: 'Back' }
      ]);
    });

    it('returns empty array for empty entries', () => {
      expect(service.buildSourceImageUrls([])).toEqual([]);
    });
  });

  // ── updateMagentoStore ────────────────────────────────────────────────────

  describe('updateMagentoStore', () => {
    const TargetService = require('../../../src/services/magento/target.service');

    const sourceProduct = {
      sku: 'PARENT-001',
      name: 'My Product',
      media_gallery_entries: [{ id: 10, file: '/a/img.jpg', label: 'Front' }],
      custom_attributes: [
        { attribute_code: 'description', value: '<p>desc</p>' },
        { attribute_code: 'brand', value: '42' },
        { attribute_code: 'meta_title', value: 'MT' },
        { attribute_code: 'meta_keyword', value: 'kw1, kw2' },
        { attribute_code: 'meta_description', value: 'MD' }
      ],
      extension_attributes: {
        category_links: [{ category_id: '5' }]
      }
    };

    const extractedData = {
      sourceProduct,
      brandLabel: 'BrandCo',
      categories: [{ id: '5', name: 'Vapes' }]
    };

    let mockTargetInstance;

    beforeEach(() => {
      mockTargetInstance = {
        getProductBySku: jest.fn().mockResolvedValue({ sku: 'PARENT-001', media_gallery_entries: [] }),
        ensureAttributeOptionExists: jest.fn().mockResolvedValue({ value: '99' }),
        getCategoryIdByName: jest.fn().mockResolvedValue(7),
        client: { put: jest.fn().mockResolvedValue({}) },
        deleteAllProductMedia: jest.fn().mockResolvedValue(undefined),
        uploadProductImage: jest.fn().mockResolvedValue({}),
        getStoreWebsiteMapping: jest.fn().mockResolvedValue({ default: 1 }),
        createScopedInstance: jest.fn().mockReturnValue({
          updateProduct: jest.fn().mockResolvedValue({})
        })
      };
      TargetService.getInstanceForStore = jest.fn().mockReturnValue(mockTargetInstance);

      // Stub categoryMappingService
      service.categoryMappingService.getTargetMagentoCategories = jest.fn().mockReturnValue(['Vapes']);

      // Stub sourceService.downloadImage
      service.sourceService.downloadImage = jest.fn().mockResolvedValue({
        buffer: Buffer.from('img'),
        contentType: 'image/jpeg'
      });
    });

    it('returns success: false when product not found on target', async () => {
      mockTargetInstance.getProductBySku.mockResolvedValue(null);

      const result = await service.updateMagentoStore('ejuices', extractedData);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it('PUTs global fields via /rest/all/ endpoint', async () => {
      await service.updateMagentoStore('ejuices', extractedData);

      expect(mockTargetInstance.client.put).toHaveBeenCalledWith(
        expect.stringContaining('/rest/all/V1/products/PARENT-001'),
        expect.objectContaining({
          product: expect.objectContaining({
            sku: 'PARENT-001',
            custom_attributes: expect.arrayContaining([
              expect.objectContaining({ attribute_code: 'brand' })
            ])
          })
        })
      );
    });

    it('updates store-view scoped fields on each store view', async () => {
      await service.updateMagentoStore('ejuices', extractedData);

      expect(mockTargetInstance.getStoreWebsiteMapping).toHaveBeenCalled();
      expect(mockTargetInstance.createScopedInstance).toHaveBeenCalledWith('default');
      const scopedService = mockTargetInstance.createScopedInstance.mock.results[0].value;
      expect(scopedService.updateProduct).toHaveBeenCalledWith(
        'PARENT-001',
        expect.objectContaining({
          name: 'My Product'
        })
      );
    });

    it('returns success: true on happy path', async () => {
      const result = await service.updateMagentoStore('ejuices', extractedData);
      expect(result.success).toBe(true);
    });

    it('includes warning when brand translation fails', async () => {
      mockTargetInstance.ensureAttributeOptionExists.mockRejectedValue(new Error('option error'));

      const result = await service.updateMagentoStore('ejuices', extractedData);

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'brand' })])
      );
    });
  });

  // ── updateShopifyStore ────────────────────────────────────────────────────

  describe('updateShopifyStore', () => {
    const ShopifyTargetService = require('../../../src/services/shopify/shopify-target.service');

    const sourceProduct = {
      sku: 'PARENT-001',
      name: 'My Product',
      media_gallery_entries: [{ file: '/a/img.jpg', label: 'Front' }],
      custom_attributes: [
        { attribute_code: 'description', value: '<p>desc</p>' },
        { attribute_code: 'meta_title', value: 'MT' },
        { attribute_code: 'meta_keyword', value: 'kw1, kw2' },
        { attribute_code: 'meta_description', value: 'MD' }
      ]
    };

    const extractedData = {
      sourceProduct,
      productType: 'configurable',
      brandLabel: 'BrandCo',
      categories: [{ id: '5', name: 'Vapes' }],
      firstChildSku: 'CHILD-001'
    };

    let mockShopify;

    beforeEach(() => {
      mockShopify = {
        getVariantsBySkus: jest.fn().mockResolvedValue([
          { sku: 'CHILD-001', product: { id: 'gid://shopify/Product/123' } }
        ]),
        updateProductFields: jest.fn().mockResolvedValue({}),
        deleteAllProductMedia: jest.fn().mockResolvedValue(undefined),
        createProductMedia: jest.fn().mockResolvedValue([]),
        query: jest.fn().mockResolvedValue({
          data: {
            product: {
              media: {
                edges: [{ node: { id: 'gid://shopify/MediaImage/1' } }]
              }
            }
          }
        })
      };
      ShopifyTargetService.mockImplementation(() => mockShopify);

      service.categoryMappingService.getShopifyProductType = jest.fn().mockReturnValue('Accessories');
    });

    it('returns success: false when product not found', async () => {
      mockShopify.getVariantsBySkus.mockResolvedValue([]);
      const result = await service.updateShopifyStore('myshopify', extractedData);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it('looks up by firstChildSku for configurable products', async () => {
      await service.updateShopifyStore('myshopify', extractedData);
      expect(mockShopify.getVariantsBySkus).toHaveBeenCalledWith(['CHILD-001']);
    });

    it('looks up by sku directly for standalone simple products', async () => {
      mockShopify.getVariantsBySkus.mockResolvedValue([
        { sku: 'PARENT-001', product: { id: 'gid://shopify/Product/456' } }
      ]);

      const standaloneData = { ...extractedData, productType: 'standalone-simple' };
      await service.updateShopifyStore('myshopify', standaloneData);

      expect(mockShopify.getVariantsBySkus).toHaveBeenCalledWith(['PARENT-001']);
    });

    it('calls updateProductFields with mapped fields', async () => {
      await service.updateShopifyStore('myshopify', extractedData);

      expect(mockShopify.updateProductFields).toHaveBeenCalledWith(
        'gid://shopify/Product/123',
        expect.objectContaining({
          title: 'My Product',
          vendor: 'BrandCo',
          descriptionHtml: '<p>desc</p>',
          productType: 'Accessories',
          seoTitle: 'MT',
          seoDescription: 'MD',
          tags: ['kw1', 'kw2']
        })
      );
    });

    it('returns success: true even when image replace fails', async () => {
      mockShopify.deleteAllProductMedia.mockRejectedValue(new Error('cdn error'));

      const result = await service.updateShopifyStore('myshopify', extractedData);

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'images' })])
      );
    });

    it('returns success: true on happy path', async () => {
      const result = await service.updateShopifyStore('myshopify', extractedData);
      expect(result.success).toBe(true);
    });

    it('records warning when media ID fetch fails', async () => {
      mockShopify.query.mockRejectedValue(new Error('GraphQL error'));

      const result = await service.updateShopifyStore('myshopify', extractedData);

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'images' })])
      );
    });
  });

  // ── updateProductFields (main entry point) ────────────────────────────────

  describe('updateProductFields', () => {
    const sourceProduct = {
      sku: 'PARENT-001',
      name: 'My Product',
      type_id: 'configurable',
      visibility: 4,
      price: 99,
      media_gallery_entries: [],
      custom_attributes: [
        { attribute_code: 'description', value: '<p>desc</p>' },
        { attribute_code: 'brand', value: '42' },
        { attribute_code: 'meta_title', value: 'MT' },
        { attribute_code: 'meta_keyword', value: 'kw1' },
        { attribute_code: 'meta_description', value: 'MD' }
      ],
      extension_attributes: {
        category_links: [{ category_id: '5' }],
        configurable_product_link_data: [
          JSON.stringify({ simple_product_sku: 'CHILD-001', simple_product_id: 1 })
        ]
      }
    };

    beforeEach(() => {
      service.sourceService.getProductBySku = jest.fn().mockResolvedValue(sourceProduct);
      service.attributeService.translateBrandAttribute = jest.fn().mockResolvedValue('BrandCo');
      service.attributeService.translateCategories = jest.fn().mockResolvedValue({ '5': 'Vapes' });
      service.googleChatService.notifyProductUpdateStart = jest.fn().mockResolvedValue(undefined);
      service.googleChatService.notifyProductUpdateEnd = jest.fn().mockResolvedValue(undefined);
      service.updateMagentoStore = jest.fn().mockResolvedValue({ success: true, warnings: [] });
      service.updateShopifyStore = jest.fn().mockResolvedValue({ success: true, warnings: [] });
    });

    it('throws immediately when source product not found', async () => {
      service.sourceService.getProductBySku.mockResolvedValue(null);
      await expect(service.updateProductFields('MISSING-SKU')).rejects.toThrow();
      expect(service.googleChatService.notifyProductUpdateStart).not.toHaveBeenCalled();
    });

    it('sends start notification after extraction', async () => {
      await service.updateProductFields('PARENT-001', {
        targetMagentoStores: ['ejuices'],
        targetShopifyStores: []
      });
      expect(service.googleChatService.notifyProductUpdateStart).toHaveBeenCalledWith(
        'PARENT-001',
        expect.any(Array)
      );
    });

    it('calls updateMagentoStore for each resolved Magento store', async () => {
      await service.updateProductFields('PARENT-001', {
        targetMagentoStores: ['ejuices'],
        includeShopify: false
      });
      expect(service.updateMagentoStore).toHaveBeenCalledWith('ejuices', expect.any(Object));
    });

    it('calls updateShopifyStore for each resolved Shopify store', async () => {
      await service.updateProductFields('PARENT-001', {
        targetShopifyStores: ['myshopify'],
        includeMagento: false
      });
      expect(service.updateShopifyStore).toHaveBeenCalledWith('myshopify', expect.any(Object));
    });

    it('sends end notification on success', async () => {
      await service.updateProductFields('PARENT-001', { targetMagentoStores: ['ejuices'], includeShopify: false });
      expect(service.googleChatService.notifyProductUpdateEnd).toHaveBeenCalledWith(
        expect.objectContaining({ sku: 'PARENT-001', success: true })
      );
    });

    it('sends end notification even when a store update fails', async () => {
      service.updateMagentoStore.mockResolvedValue({ success: false, error: 'not found' });
      await service.updateProductFields('PARENT-001', { targetMagentoStores: ['ejuices'], includeShopify: false });
      expect(service.googleChatService.notifyProductUpdateEnd).toHaveBeenCalled();
    });

    it('returns result.success false when any store fails', async () => {
      service.updateMagentoStore.mockResolvedValue({ success: false, error: 'not found' });
      const result = await service.updateProductFields('PARENT-001', {
        targetMagentoStores: ['ejuices'], includeShopify: false
      });
      expect(result.success).toBe(false);
    });

    it('skips Magento when includeMagento is false', async () => {
      await service.updateProductFields('PARENT-001', { includeMagento: false, includeShopify: false });
      expect(service.updateMagentoStore).not.toHaveBeenCalled();
    });

    it('skips Shopify when includeShopify is false', async () => {
      await service.updateProductFields('PARENT-001', { includeMagento: false, includeShopify: false });
      expect(service.updateShopifyStore).not.toHaveBeenCalled();
    });
  });
});
