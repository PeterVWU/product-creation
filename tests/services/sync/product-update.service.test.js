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
});
