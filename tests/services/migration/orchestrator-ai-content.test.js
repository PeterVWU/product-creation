// tests/services/migration/orchestrator-ai-content.test.js
'use strict';

jest.mock('../../../src/config', () => ({
  source: { baseUrl: 'http://source.test', token: 'tok' },
  api: {},
  migration: { includeImages: true, createMissingAttributes: false, overwriteExisting: false },
  errorHandling: { continueOnError: false },
  magentoStores: { ejuices: {}, misthub: {} }
}));

jest.mock('../../../src/services/magento/source.service');
jest.mock('../../../src/services/magento/target.service');
jest.mock('../../../src/services/migration/extraction.service');
jest.mock('../../../src/services/migration/standalone-extraction.service');
jest.mock('../../../src/services/migration/standalone-magento-creation.service');
jest.mock('../../../src/services/migration/preparation.service');
jest.mock('../../../src/services/migration/creation.service');
jest.mock('../../../src/services/category-mapping.service');
jest.mock('../../../src/services/notification/google-chat.service');
jest.mock('../../../src/services/ai/content-generation.service');

const OrchestratorService = require('../../../src/services/migration/orchestrator.service');
const SourceService = require('../../../src/services/magento/source.service');
const TargetService = require('../../../src/services/magento/target.service');
const ExtractionService = require('../../../src/services/migration/extraction.service');
const StandaloneExtractionService = require('../../../src/services/migration/standalone-extraction.service');
const StandaloneMagentoCreationService = require('../../../src/services/migration/standalone-magento-creation.service');
const PreparationService = require('../../../src/services/migration/preparation.service');
const CreationService = require('../../../src/services/migration/creation.service');
const GoogleChatService = require('../../../src/services/notification/google-chat.service');
const ContentGenerationService = require('../../../src/services/ai/content-generation.service');

describe('OrchestratorService — AI content generation', () => {
  let orchestrator;
  let mockSourceInstance;
  let mockTargetInstance;
  let mockExtractionInstance;
  let mockStandaloneExtractionInstance;
  let mockCreationInstance;
  let mockStandaloneCreationInstance;
  let mockPreparationInstance;
  let mockGoogleChatInstance;
  let mockContentGenInstance;

  const configurableProduct = {
    sku: 'CONFIG-001',
    type_id: 'configurable',
    name: 'Original Title',
    price: 29.99,
    custom_attributes: [
      { attribute_code: 'description', value: '<p>Original desc</p>' }
    ]
  };

  const standaloneProduct = {
    sku: 'SIMPLE-001',
    type_id: 'simple',
    visibility: 4,
    name: 'Original Simple Title',
    price: 19.99,
    custom_attributes: [
      { attribute_code: 'description', value: '<p>Simple desc</p>' }
    ]
  };

  const mockExtractedData = {
    parent: configurableProduct,
    children: [{ sku: 'CHILD-001', name: 'Child 1', price: 9.99 }],
    images: { parent: [], children: {} },
    categories: [],
    translations: {},
    childLinks: []
  };

  const mockStandaloneExtractedData = {
    parent: standaloneProduct,
    children: [],
    images: { parent: [], children: {} },
    categories: [],
    translations: {},
    childLinks: []
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockSourceInstance = {
      getProductBySku: jest.fn()
    };
    SourceService.mockImplementation(() => mockSourceInstance);

    mockTargetInstance = {
      getStoreWebsiteMapping: jest.fn().mockResolvedValue({ default: 1 }),
      getProductBySku: jest.fn().mockResolvedValue(null),
      getConfigurableChildren: jest.fn().mockResolvedValue([])
    };
    TargetService.getInstanceForStore = jest.fn().mockReturnValue(mockTargetInstance);

    mockExtractionInstance = {
      extractProduct: jest.fn().mockResolvedValue(mockExtractedData)
    };
    ExtractionService.mockImplementation(() => mockExtractionInstance);

    mockStandaloneExtractionInstance = {
      extractProduct: jest.fn().mockResolvedValue(mockStandaloneExtractedData)
    };
    StandaloneExtractionService.mockImplementation(() => mockStandaloneExtractionInstance);

    mockCreationInstance = {
      createProducts: jest.fn().mockResolvedValue({
        parentProductId: 100,
        createdChildren: [{ sku: 'CHILD-001', success: true }],
        imagesUploaded: 0,
        warnings: []
      }),
      updateProductsForStore: jest.fn().mockResolvedValue({
        updatedChildren: [{ sku: 'CHILD-001', success: true }],
        warnings: []
      })
    };
    CreationService.mockImplementation(() => mockCreationInstance);

    mockStandaloneCreationInstance = {
      createProduct: jest.fn().mockResolvedValue({
        parentProductId: 200,
        storeResults: { default: { success: true } }
      })
    };
    StandaloneMagentoCreationService.mockImplementation(() => mockStandaloneCreationInstance);

    mockPreparationInstance = {
      prepareTarget: jest.fn().mockResolvedValue({
        attributeSet: { id: 4 },
        attributeMapping: {},
        categoryMapping: {}
      })
    };
    PreparationService.mockImplementation(() => mockPreparationInstance);

    mockGoogleChatInstance = {
      notifyMigrationStart: jest.fn().mockResolvedValue(),
      notifyMigrationEnd: jest.fn().mockResolvedValue()
    };
    GoogleChatService.mockImplementation(() => mockGoogleChatInstance);

    mockContentGenInstance = {
      generateForStores: jest.fn().mockResolvedValue({})
    };
    ContentGenerationService.mockImplementation(() => mockContentGenInstance);

    orchestrator = new OrchestratorService();
  });

  describe('configurable product with storePrompts', () => {
    beforeEach(() => {
      mockSourceInstance.getProductBySku.mockResolvedValue(configurableProduct);
    });

    it('should call generateForStores when storePrompts is provided', async () => {
      mockContentGenInstance.generateForStores.mockResolvedValue({
        ejuices: { title: 'AI Title', description: '<div>AI desc</div>' }
      });

      await orchestrator.migrateProduct('CONFIG-001', {
        targetMagentoStores: ['ejuices'],
        storePrompts: { ejuices: { prompt: 'Premium audience' } }
      });

      expect(mockContentGenInstance.generateForStores).toHaveBeenCalledWith(
        mockExtractedData,
        { ejuices: { prompt: 'Premium audience' } }
      );
    });

    it('should pass modified extractedData with AI content to creation', async () => {
      mockContentGenInstance.generateForStores.mockResolvedValue({
        ejuices: { title: 'AI Title', description: '<div>AI desc</div>' }
      });

      await orchestrator.migrateProduct('CONFIG-001', {
        targetMagentoStores: ['ejuices'],
        storePrompts: { ejuices: { prompt: 'Premium audience' } }
      });

      const createCall = mockCreationInstance.createProducts.mock.calls[0];
      const passedExtractedData = createCall[0];
      expect(passedExtractedData.parent.name).toBe('AI Title');

      const descAttr = passedExtractedData.parent.custom_attributes
        .find(a => a.attribute_code === 'description');
      expect(descAttr.value).toBe('<div>AI desc</div>');
    });

    it('should not mutate original extractedData when applying AI content', async () => {
      mockContentGenInstance.generateForStores.mockResolvedValue({
        ejuices: { title: 'AI Title', description: '<div>AI desc</div>' }
      });

      await orchestrator.migrateProduct('CONFIG-001', {
        targetMagentoStores: ['ejuices'],
        storePrompts: { ejuices: { prompt: 'Premium audience' } }
      });

      expect(mockExtractedData.parent.name).toBe('Original Title');
      const descAttr = mockExtractedData.parent.custom_attributes
        .find(a => a.attribute_code === 'description');
      expect(descAttr.value).toBe('<p>Original desc</p>');
    });

    it('should pass original extractedData for stores without prompts', async () => {
      mockContentGenInstance.generateForStores.mockResolvedValue({
        ejuices: { title: 'AI Title', description: '<div>AI desc</div>' }
      });

      await orchestrator.migrateProduct('CONFIG-001', {
        targetMagentoStores: ['ejuices', 'misthub'],
        storePrompts: { ejuices: { prompt: 'Premium audience' } }
      });

      const calls = mockCreationInstance.createProducts.mock.calls;
      expect(calls).toHaveLength(2);

      expect(calls[0][0].parent.name).toBe('AI Title');
      expect(calls[1][0].parent.name).toBe('Original Title');
    });

    it('should abort migration when AI generation fails', async () => {
      mockContentGenInstance.generateForStores.mockRejectedValue(
        new Error('OpenAI failed')
      );

      const result = await orchestrator.migrateProduct('CONFIG-001', {
        targetMagentoStores: ['ejuices'],
        storePrompts: { ejuices: { prompt: 'Premium audience' } }
      });

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ phase: 'ai-generation' })
        ])
      );
      expect(mockCreationInstance.createProducts).not.toHaveBeenCalled();
    });

    it('should skip AI generation when storePrompts is not provided', async () => {
      await orchestrator.migrateProduct('CONFIG-001', {
        targetMagentoStores: ['ejuices']
      });

      expect(mockContentGenInstance.generateForStores).toHaveBeenCalledWith(
        mockExtractedData,
        undefined
      );
    });

    it('should track aiGeneration phase in migration context', async () => {
      mockContentGenInstance.generateForStores.mockResolvedValue({
        ejuices: { title: 'AI Title', description: '<div>AI</div>' }
      });

      const result = await orchestrator.migrateProduct('CONFIG-001', {
        targetMagentoStores: ['ejuices'],
        storePrompts: { ejuices: { prompt: 'Go' } }
      });

      expect(result.phases.aiGeneration).toBeDefined();
      expect(result.phases.aiGeneration.success).toBe(true);
      expect(result.phases.aiGeneration.storesGenerated).toBe(1);
      expect(typeof result.phases.aiGeneration.duration).toBe('number');
    });

    it('should set aiContentApplied flag in instance results', async () => {
      mockContentGenInstance.generateForStores.mockResolvedValue({
        ejuices: { title: 'AI Title', description: '<div>AI</div>' }
      });

      const result = await orchestrator.migrateProduct('CONFIG-001', {
        targetMagentoStores: ['ejuices', 'misthub'],
        storePrompts: { ejuices: { prompt: 'Go' } }
      });

      expect(result.instanceResults.ejuices.aiContentApplied).toBe(true);
      expect(result.instanceResults.misthub.aiContentApplied).toBe(false);
    });
  });

  describe('standalone product with storePrompts', () => {
    beforeEach(() => {
      mockSourceInstance.getProductBySku.mockResolvedValue(standaloneProduct);
    });

    it('should apply AI content to standalone product', async () => {
      mockContentGenInstance.generateForStores.mockResolvedValue({
        ejuices: { title: 'AI Simple Title', description: '<div>AI simple</div>' }
      });

      await orchestrator.migrateProduct('SIMPLE-001', {
        targetMagentoStores: ['ejuices'],
        storePrompts: { ejuices: { prompt: 'Simple prompt' } }
      });

      expect(mockContentGenInstance.generateForStores).toHaveBeenCalledWith(
        mockStandaloneExtractedData,
        { ejuices: { prompt: 'Simple prompt' } }
      );

      const createCall = mockStandaloneCreationInstance.createProduct.mock.calls[0];
      const passedData = createCall[0];
      expect(passedData.parent.name).toBe('AI Simple Title');
    });

    it('should set aiContentApplied flag in standalone instance results', async () => {
      mockContentGenInstance.generateForStores.mockResolvedValue({
        ejuices: { title: 'AI Title', description: '<div>AI</div>' }
      });

      const result = await orchestrator.migrateProduct('SIMPLE-001', {
        targetMagentoStores: ['ejuices', 'misthub'],
        storePrompts: { ejuices: { prompt: 'Go' } }
      });

      expect(result.instanceResults.ejuices.aiContentApplied).toBe(true);
      expect(result.instanceResults.misthub.aiContentApplied).toBe(false);
    });
  });
});
