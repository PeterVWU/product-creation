// tests/services/migration/orchestrator-standalone.test.js
'use strict';

jest.mock('../../../src/config', () => ({
  source: { baseUrl: 'http://source.test', token: 'tok', },
  api: {},
  migration: { includeImages: true, createMissingAttributes: false, overwriteExisting: false },
  errorHandling: { continueOnError: false },
  magentoStores: { ejuices: {} }
}));

jest.mock('../../../src/services/magento/source.service');
jest.mock('../../../src/services/magento/target.service');
jest.mock('../../../src/services/migration/extraction.service');
jest.mock('../../../src/services/migration/standalone-extraction.service');
jest.mock('../../../src/services/migration/standalone-magento-creation.service');
jest.mock('../../../src/services/migration/preparation.service');
jest.mock('../../../src/services/category-mapping.service');
jest.mock('../../../src/services/notification/google-chat.service');
jest.mock('../../../src/services/ai/content-generation.service');

const OrchestratorService = require('../../../src/services/migration/orchestrator.service');
const SourceService = require('../../../src/services/magento/source.service');
const TargetService = require('../../../src/services/magento/target.service');
const StandaloneExtractionService = require('../../../src/services/migration/standalone-extraction.service');
const StandaloneMagentoCreationService = require('../../../src/services/migration/standalone-magento-creation.service');
const PreparationService = require('../../../src/services/migration/preparation.service');
const GoogleChatService = require('../../../src/services/notification/google-chat.service');
const ContentGenerationService = require('../../../src/services/ai/content-generation.service');

describe('OrchestratorService — standalone simple path', () => {
  let orchestrator;
  let mockSourceServiceInstance;
  let mockTargetServiceInstance;
  let mockStandaloneExtractionInstance;
  let mockCreationInstance;
  let mockPreparationInstance;
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

    mockTargetServiceInstance = {
      getProductBySku: jest.fn().mockResolvedValue(null), // product doesn't exist
      getStoreWebsiteMapping: jest.fn().mockResolvedValue({ default: 1 }),
    };
    TargetService.getInstanceForStore = jest.fn().mockReturnValue(mockTargetServiceInstance);

    mockStandaloneExtractionInstance = {
      extractProduct: jest.fn().mockResolvedValue(mockExtractedData)
    };
    StandaloneExtractionService.mockImplementation(() => mockStandaloneExtractionInstance);

    mockCreationInstance = {
      createProduct: jest.fn().mockResolvedValue({
        parentProductId: 999,
        imagesUploaded: 0,
        storeResults: { default: { success: true } }
      })
    };
    StandaloneMagentoCreationService.mockImplementation(() => mockCreationInstance);

    mockPreparationInstance = {
      prepareTarget: jest.fn().mockResolvedValue({
        attributeSet: { id: 4 },
        categoryMapping: {},
        attributeMapping: {}
      })
    };
    PreparationService.mockImplementation(() => mockPreparationInstance);

    mockGoogleChatInstance = {
      notifyMigrationStart: jest.fn().mockResolvedValue({}),
      notifyMigrationEnd: jest.fn().mockResolvedValue({})
    };
    GoogleChatService.mockImplementation(() => mockGoogleChatInstance);

    ContentGenerationService.mockImplementation(() => ({
      generateForStores: jest.fn().mockResolvedValue({})
    }));

    orchestrator = new OrchestratorService();
  });

  describe('classifyProductType', () => {
    it('returns configurable for type_id configurable', () => {
      expect(orchestrator.classifyProductType({ type_id: 'configurable', sku: 'X' })).toBe('configurable');
    });

    it('returns standalone-simple for simple product with visibility > 1', () => {
      expect(orchestrator.classifyProductType({ type_id: 'simple', visibility: 4, sku: 'X' })).toBe('standalone-simple');
      expect(orchestrator.classifyProductType({ type_id: 'simple', visibility: 2, sku: 'X' })).toBe('standalone-simple');
    });

    it('throws ExtractionError for simple product with visibility === 1', () => {
      expect(() => orchestrator.classifyProductType({ type_id: 'simple', visibility: 1, sku: 'X' }))
        .toThrow('configurable variant');
    });

    it('throws ExtractionError for falsy type_id', () => {
      expect(() => orchestrator.classifyProductType({ type_id: null, sku: 'X' }))
        .toThrow('could not be determined');
    });

    it('throws ExtractionError for unsupported type_id', () => {
      expect(() => orchestrator.classifyProductType({ type_id: 'bundle', sku: 'X' }))
        .toThrow('Unsupported product type');
    });
  });

  describe('migrateProduct — standalone simple path', () => {
    it('calls standaloneExtractionService.extractProduct with prefetched product', async () => {
      await orchestrator.migrateProduct('SIMPLE-001', { targetMagentoStores: ['ejuices'] });

      expect(mockStandaloneExtractionInstance.extractProduct).toHaveBeenCalledWith(
        'SIMPLE-001',
        standaloneProduct
      );
    });

    it('does NOT call the configurable extractionService', async () => {
      // The regular extraction service should not be called for standalone simples
      const ExtractionService = require('../../../src/services/migration/extraction.service');
      const mockExtractionInstance = { extractProduct: jest.fn() };
      ExtractionService.mockImplementation(() => mockExtractionInstance);

      // Re-create orchestrator with fresh mocks
      const freshOrchestrator = new OrchestratorService();
      await freshOrchestrator.migrateProduct('SIMPLE-001', { targetMagentoStores: ['ejuices'] });

      expect(mockExtractionInstance.extractProduct).not.toHaveBeenCalled();
    });

    it('calls notifyMigrationStart with empty childSkus', async () => {
      await orchestrator.migrateProduct('SIMPLE-001', { targetMagentoStores: ['ejuices'] });

      expect(mockGoogleChatInstance.notifyMigrationStart).toHaveBeenCalledWith(
        'SIMPLE-001',
        [],
        ['ejuices']
      );
    });

    it('returns success:true when creation succeeds', async () => {
      const result = await orchestrator.migrateProduct('SIMPLE-001', { targetMagentoStores: ['ejuices'] });

      expect(result.success).toBe(true);
    });

    it('returns error for product that already exists on target', async () => {
      mockTargetServiceInstance.getProductBySku = jest.fn().mockResolvedValue({ id: 999, sku: 'SIMPLE-001' });

      const result = await orchestrator.migrateProduct('SIMPLE-001', { targetMagentoStores: ['ejuices'] });

      expect(result.instanceResults['ejuices'].success).toBe(false);
      expect(result.instanceResults['ejuices'].mode).toBe('error');
    });

    it('throws ExtractionError immediately for configurable variant (visibility=1)', async () => {
      mockSourceServiceInstance.getProductBySku.mockResolvedValue({
        sku: 'CHILD-001',
        type_id: 'simple',
        visibility: 1
      });

      const result = await orchestrator.migrateProduct('CHILD-001', { targetMagentoStores: ['ejuices'] });

      expect(result.success).toBe(false);
      expect(result.errors[0].message).toMatch('configurable variant');
    });
  });
});
