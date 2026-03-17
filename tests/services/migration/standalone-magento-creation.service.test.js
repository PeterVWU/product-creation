// tests/services/migration/standalone-magento-creation.service.test.js
'use strict';

const StandaloneMagentoCreationService = require('../../../src/services/migration/standalone-magento-creation.service');

jest.mock('../../../src/services/image.service');
const ImageService = require('../../../src/services/image.service');

// Mock config to avoid needing env vars
jest.mock('../../../src/config', () => ({
  concurrency: { maxImageSizeMB: 5 },
  errorHandling: { continueOnError: false }
}));

jest.mock('../../../src/config/constants', () => ({
  MAGENTO_API: {
    STATUS: { ENABLED: 1, DISABLED: 2 },
    VISIBILITY: { CATALOG_SEARCH: 4 },
    PRODUCT_TYPES: { SIMPLE: 'simple' }
  }
}));

describe('StandaloneMagentoCreationService', () => {
  let service;
  let mockSourceService;
  let mockTargetService;
  let mockImageServiceInstance;

  const mockExtractedData = {
    parent: {
      sku: 'SIMPLE-001',
      name: 'Test Simple Product',
      price: 29.99,
      attribute_set_id: 10,
      custom_attributes: [
        { attribute_code: 'brand', value: 'Vaporesso' },
        { attribute_code: 'category_ids', value: '5,8' }
      ],
      extension_attributes: {
        stock_item: { qty: 100, is_in_stock: true, manage_stock: true }
      }
    },
    images: { parent: [{ file: '/img/test.jpg' }], children: {} },
    categories: [{ id: 5, name: 'E-Liquids' }],
    children: [],
    childLinks: []
  };

  const mockPreparedData = {
    attributeSet: { id: 10 },
    categoryMapping: { 'E-Liquids': 15 },
    attributeMapping: {}
  };

  const mockStoreViews = ['default', 'en_us'];
  const mockWebsiteIds = [1];
  const mockOptions = { productEnabled: true, includeImages: false };

  beforeEach(() => {
    mockTargetService = {
      createOrUpdateProduct: jest.fn().mockResolvedValue({ id: 999, sku: 'SIMPLE-001' }),
      createScopedInstance: jest.fn().mockReturnValue({
        createOrUpdateProduct: jest.fn().mockResolvedValue({ id: 999, sku: 'SIMPLE-001' })
      })
    };

    mockSourceService = {};

    mockImageServiceInstance = {
      migrateImages: jest.fn().mockResolvedValue({ uploaded: 1 })
    };
    ImageService.mockImplementation(() => mockImageServiceInstance);

    service = new StandaloneMagentoCreationService(mockSourceService, mockTargetService);
  });

  describe('createProduct', () => {
    it('calls createOrUpdateProduct with correct product data on first store view', async () => {
      await service.createProduct(mockExtractedData, mockPreparedData, mockStoreViews, mockWebsiteIds, mockOptions);

      expect(mockTargetService.createOrUpdateProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          sku: 'SIMPLE-001',
          type_id: 'simple',
          visibility: 4,
          status: 1,
          attribute_set_id: 10,
          website_ids: [1]
        })
      );
    });

    it('excludes category_ids from custom_attributes and adds extension_attributes.category_links', async () => {
      await service.createProduct(mockExtractedData, mockPreparedData, mockStoreViews, mockWebsiteIds, mockOptions);

      const callArg = mockTargetService.createOrUpdateProduct.mock.calls[0][0];
      const catIdAttr = callArg.custom_attributes.find(a => a.attribute_code === 'category_ids');
      expect(catIdAttr).toBeUndefined();
      expect(callArg.extension_attributes.category_links).toEqual([
        { category_id: '15', position: 0 }
      ]);
    });

    it('calls createScopedInstance and updates attributes for subsequent store views', async () => {
      await service.createProduct(mockExtractedData, mockPreparedData, mockStoreViews, mockWebsiteIds, mockOptions);

      expect(mockTargetService.createScopedInstance).toHaveBeenCalledWith('en_us');
      const scopedService = mockTargetService.createScopedInstance.mock.results[0].value;
      expect(scopedService.createOrUpdateProduct).toHaveBeenCalled();
    });

    it('returns parentProductId from first store creation response', async () => {
      const result = await service.createProduct(mockExtractedData, mockPreparedData, mockStoreViews, mockWebsiteIds, mockOptions);

      expect(result.parentProductId).toBe(999);
    });

    it('returns storeResults with success for each store view', async () => {
      const result = await service.createProduct(mockExtractedData, mockPreparedData, mockStoreViews, mockWebsiteIds, mockOptions);

      expect(result.storeResults['default'].success).toBe(true);
      expect(result.storeResults['en_us'].success).toBe(true);
    });

    it('sets status to DISABLED when options.productEnabled is false', async () => {
      await service.createProduct(
        mockExtractedData, mockPreparedData, mockStoreViews, mockWebsiteIds,
        { ...mockOptions, productEnabled: false }
      );

      const callArg = mockTargetService.createOrUpdateProduct.mock.calls[0][0];
      expect(callArg.status).toBe(2); // DISABLED
    });

    it('does not call imageService when includeImages is false', async () => {
      await service.createProduct(mockExtractedData, mockPreparedData, ['default'], [1], { productEnabled: true, includeImages: false });

      expect(mockImageServiceInstance.migrateImages).not.toHaveBeenCalled();
    });

    it('handles single store view (no scoped update needed)', async () => {
      await service.createProduct(mockExtractedData, mockPreparedData, ['default'], [1], mockOptions);

      expect(mockTargetService.createScopedInstance).not.toHaveBeenCalled();
    });
  });
});
