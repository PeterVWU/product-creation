// tests/services/migration/shopify-orchestrator-standalone.test.js
'use strict';

jest.mock('../../../src/config', () => ({
  source: { baseUrl: 'http://source.test', token: 'tok' },
  api: {},
  migration: { includeImages: true },
  errorHandling: { continueOnError: false },
  shopify: {
    apiVersion: '2024-01',
    defaultStore: 'wholesale',
    stores: {
      wholesale: { url: 'https://wholesale.myshopify.com', token: 'tok' }
    }
  }
}));

jest.mock('../../../src/services/magento/source.service');
jest.mock('../../../src/services/migration/extraction.service');
jest.mock('../../../src/services/migration/standalone-extraction.service');
jest.mock('../../../src/services/migration/shopify-creation.service');
jest.mock('../../../src/services/shopify/shopify-target.service');
jest.mock('../../../src/services/category-mapping.service');
jest.mock('../../../src/services/notification/google-chat.service');

const ShopifyOrchestratorService = require('../../../src/services/migration/shopify-orchestrator.service');
const SourceService = require('../../../src/services/magento/source.service');
const StandaloneExtractionService = require('../../../src/services/migration/standalone-extraction.service');
const ShopifyCreationService = require('../../../src/services/migration/shopify-creation.service');
const ShopifyTargetService = require('../../../src/services/shopify/shopify-target.service');
const GoogleChatService = require('../../../src/services/notification/google-chat.service');

describe('ShopifyOrchestratorService — standalone simple path', () => {
  let orchestrator;
  let mockSourceServiceInstance;
  let mockShopifyTargetInstance;
  let mockStandaloneExtractionInstance;
  let mockCreationServiceInstance;
  let mockGoogleChatInstance;

  const standaloneProduct = {
    sku: 'SIMPLE-001',
    type_id: 'simple',
    visibility: 4,
    name: 'Test Simple',
    price: 29.99
  };

  const mockExtractedData = {
    parent: standaloneProduct,
    images: { parent: [], children: {} },
    categories: [],
    translations: {},
    children: [],
    childLinks: []
  };

  beforeEach(() => {
    mockSourceServiceInstance = {
      getProductBySku: jest.fn().mockResolvedValue(standaloneProduct)
    };
    SourceService.mockImplementation(() => mockSourceServiceInstance);

    mockShopifyTargetInstance = {
      getVariantsBySkus: jest.fn().mockResolvedValue([]), // product doesn't exist
      buildAdminUrl: jest.fn().mockReturnValue('https://admin.shopify.com/products/456')
    };
    ShopifyTargetService.mockImplementation(() => mockShopifyTargetInstance);

    mockStandaloneExtractionInstance = {
      extractProduct: jest.fn().mockResolvedValue(mockExtractedData)
    };
    StandaloneExtractionService.mockImplementation(() => mockStandaloneExtractionInstance);

    mockCreationServiceInstance = {
      createStandaloneProduct: jest.fn().mockResolvedValue({
        parentProductId: 'gid://shopify/Product/456',
        shopifyHandle: 'test-simple',
        createdVariants: [{ id: 'gid://shopify/ProductVariant/789', sku: 'SIMPLE-001', title: 'Default Title', success: true }],
        imagesUploaded: 0,
        success: true
      })
    };
    ShopifyCreationService.mockImplementation(() => mockCreationServiceInstance);

    mockGoogleChatInstance = {
      notifyMigrationStart: jest.fn().mockResolvedValue({}),
      notifyMigrationEnd: jest.fn().mockResolvedValue({})
    };
    GoogleChatService.mockImplementation(() => mockGoogleChatInstance);

    orchestrator = new ShopifyOrchestratorService();
  });

  describe('classifyProductType', () => {
    it('returns standalone-simple for visible simple product', () => {
      expect(orchestrator.classifyProductType({ type_id: 'simple', visibility: 4, sku: 'X' })).toBe('standalone-simple');
    });

    it('throws for variant child (visibility=1)', () => {
      expect(() => orchestrator.classifyProductType({ type_id: 'simple', visibility: 1, sku: 'X' }))
        .toThrow('configurable variant');
    });
  });

  describe('migrateProduct — standalone simple path', () => {
    it('calls standaloneExtractionService.extractProduct with the pre-fetched product', async () => {
      await orchestrator.migrateProduct('SIMPLE-001', { shopifyStore: 'wholesale' });

      expect(mockStandaloneExtractionInstance.extractProduct).toHaveBeenCalledWith(
        'SIMPLE-001',
        standaloneProduct
      );
    });

    it('calls createStandaloneProduct on ShopifyCreationService', async () => {
      await orchestrator.migrateProduct('SIMPLE-001', { shopifyStore: 'wholesale' });

      expect(mockCreationServiceInstance.createStandaloneProduct).toHaveBeenCalledWith(
        mockExtractedData,
        'wholesale'
      );
    });

    it('sets shopifyProductId and shopifyProductUrl in context', async () => {
      const result = await orchestrator.migrateProduct('SIMPLE-001', { shopifyStore: 'wholesale' });

      expect(result.shopifyProductId).toBe('gid://shopify/Product/456');
      expect(result.shopifyProductUrl).toBeTruthy();
    });

    it('returns success:true when creation succeeds', async () => {
      const result = await orchestrator.migrateProduct('SIMPLE-001', { shopifyStore: 'wholesale' });

      expect(result.success).toBe(true);
    });

    it('sets summary.variantsMigrated to 1', async () => {
      const result = await orchestrator.migrateProduct('SIMPLE-001', { shopifyStore: 'wholesale' });

      expect(result.summary.variantsMigrated).toBe(1);
    });

    it('returns success:false when product already exists on Shopify', async () => {
      mockShopifyTargetInstance.getVariantsBySkus = jest.fn().mockResolvedValue([
        { id: 'gid://shopify/ProductVariant/111', sku: 'SIMPLE-001', product: { id: 'gid://shopify/Product/222' } }
      ]);

      const result = await orchestrator.migrateProduct('SIMPLE-001', { shopifyStore: 'wholesale' });

      expect(result.success).toBe(false);
      expect(result.errors[0].message).toMatch('already exists');
    });

    it('calls notifyMigrationStart with empty childSkus', async () => {
      await orchestrator.migrateProduct('SIMPLE-001', { shopifyStore: 'wholesale' });

      expect(mockGoogleChatInstance.notifyMigrationStart).toHaveBeenCalledWith(
        'SIMPLE-001',
        [],
        ['wholesale']
      );
    });
  });
});
