# Per-Store AI Content Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate customized titles and descriptions per target store during product migration using OpenAI, running before product creation so failures abort cleanly.

**Architecture:** A new `ContentGenerationService` sits between extraction and creation in the orchestrator. It takes the extracted product data and per-store prompts, calls OpenAI for each store, and returns a `generatedContent` map. The orchestrator clones `extractedData` with AI content per-store before passing to creation services. No changes to creation services.

**Tech Stack:** Node.js, OpenAI SDK (existing `OpenAIClient`), Jest, express-validator

**Spec:** `docs/superpowers/specs/2026-03-24-per-store-ai-content-generation-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/services/ai/content-generation.service.js` | Create | Build prompts, call OpenAI per store, parse responses, return `generatedContent` map |
| `tests/services/ai/content-generation.service.test.js` | Create | Unit tests for ContentGenerationService |
| `src/services/migration/orchestrator.service.js` | Modify | Add AI generation phase, apply content per-store, track `phases.aiGeneration` |
| `tests/services/migration/orchestrator-ai-content.test.js` | Create | Unit tests for orchestrator AI content integration |
| `src/routes/v1/migration.routes.js` | Modify | Add `storePrompts` validation rules |
| `tests/services/migration/orchestrator-standalone.test.js` | Modify | Add `jest.mock` for ContentGenerationService to prevent breakage |

---

### Task 1: ContentGenerationService — prompt building and response parsing

**Files:**
- Create: `src/services/ai/content-generation.service.js`
- Create: `tests/services/ai/content-generation.service.test.js`
- Reference: `src/services/ai/openai.client.js`
- Reference: `src/services/description.service.js` (for `parseAIResponse` pattern)

- [ ] **Step 1: Write failing tests for prompt building and response parsing**

```js
// tests/services/ai/content-generation.service.test.js
'use strict';

jest.mock('../../../src/services/ai/openai.client');
jest.mock('../../../src/config', () => ({
  openai: { apiKey: 'test-key', model: 'gpt-4o' }
}));

const ContentGenerationService = require('../../../src/services/ai/content-generation.service');
const OpenAIClient = require('../../../src/services/ai/openai.client');

describe('ContentGenerationService', () => {
  let service;
  let mockOpenAIInstance;

  beforeEach(() => {
    mockOpenAIInstance = {
      generateDescription: jest.fn()
    };
    OpenAIClient.mockImplementation(() => mockOpenAIInstance);
    service = new ContentGenerationService();
  });

  describe('buildPrompt', () => {
    it('should combine user prompt with original title and description', () => {
      const prompt = service.buildPrompt(
        'Write for a premium audience',
        'Original Product Title',
        '<p>Original description</p>'
      );

      expect(prompt).toContain('Write for a premium audience');
      expect(prompt).toContain('Original Product Title');
      expect(prompt).toContain('<p>Original description</p>');
      expect(prompt).toContain('Return your response as a JSON object');
    });
  });

  describe('parseResponse', () => {
    it('should parse valid JSON response with title and description', () => {
      const response = '{"title": "New Title", "description": "<div>New desc</div>"}';
      const result = service.parseResponse(response);
      expect(result).toEqual({
        title: 'New Title',
        description: '<div>New desc</div>'
      });
    });

    it('should extract JSON from response with extra text', () => {
      const response = 'Here is the result: {"title": "New Title", "description": "<div>Desc</div>"} end';
      const result = service.parseResponse(response);
      expect(result).toEqual({
        title: 'New Title',
        description: '<div>Desc</div>'
      });
    });

    it('should throw on completely unparseable response', () => {
      expect(() => service.parseResponse('not json at all'))
        .toThrow('Failed to parse AI response');
    });

    it('should throw when title is missing from parsed response', () => {
      const response = '{"description": "<div>Desc</div>"}';
      expect(() => service.parseResponse(response))
        .toThrow('AI response missing required field: title');
    });

    it('should throw when description is missing from parsed response', () => {
      const response = '{"title": "Title"}';
      expect(() => service.parseResponse(response))
        .toThrow('AI response missing required field: description');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/services/ai/content-generation.service.test.js --verbose`
Expected: FAIL — `Cannot find module '../../../src/services/ai/content-generation.service'`

- [ ] **Step 3: Implement ContentGenerationService — prompt building and parsing**

```js
// src/services/ai/content-generation.service.js
'use strict';

const OpenAIClient = require('./openai.client');
const logger = require('../../config/logger');
const { DescriptionGenerationError } = require('../../utils/error-handler');

const PROMPT_TEMPLATE = `{userPrompt}

Based on the following product information, generate a customized title and description.

Original Title: {originalTitle}
Original Description: {originalDescription}

Return your response as a JSON object with two fields:
1. "title": The customized product title
2. "description": The customized product description in HTML format

Respond ONLY with the JSON object, no other text.`;

class ContentGenerationService {
  constructor() {
    this.openaiClient = new OpenAIClient();
  }

  buildPrompt(userPrompt, originalTitle, originalDescription) {
    return PROMPT_TEMPLATE
      .replace('{userPrompt}', userPrompt)
      .replace('{originalTitle}', originalTitle)
      .replace('{originalDescription}', originalDescription || '');
  }

  parseResponse(response) {
    let parsed;

    try {
      parsed = JSON.parse(response);
    } catch (e) {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[0]);
        } catch (e2) {
          // fall through
        }
      }
    }

    if (!parsed) {
      throw new DescriptionGenerationError(
        'Failed to parse AI response',
        'AI_PARSE_FAILED',
        502,
        { response: response.substring(0, 200) }
      );
    }

    if (!parsed.title) {
      throw new DescriptionGenerationError(
        'AI response missing required field: title',
        'AI_PARSE_FAILED',
        502
      );
    }

    if (!parsed.description) {
      throw new DescriptionGenerationError(
        'AI response missing required field: description',
        'AI_PARSE_FAILED',
        502
      );
    }

    return {
      title: parsed.title,
      description: parsed.description
    };
  }
}

module.exports = ContentGenerationService;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/services/ai/content-generation.service.test.js --verbose`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/ai/content-generation.service.js tests/services/ai/content-generation.service.test.js
git commit -m "feat: add ContentGenerationService with prompt building and response parsing"
```

---

### Task 2: ContentGenerationService — generateForStores method

**Files:**
- Modify: `src/services/ai/content-generation.service.js`
- Modify: `tests/services/ai/content-generation.service.test.js`

- [ ] **Step 1: Write failing tests for generateForStores**

Append to the existing test file's `describe('ContentGenerationService')` block:

```js
  describe('generateForStores', () => {
    const extractedData = {
      parent: {
        sku: 'TEST-SKU',
        name: 'Original Title',
        custom_attributes: [
          { attribute_code: 'description', value: '<p>Original desc</p>' },
          { attribute_code: 'meta_title', value: 'Meta' }
        ]
      },
      children: []
    };

    it('should generate content for each store with a prompt', async () => {
      mockOpenAIInstance.generateDescription
        .mockResolvedValueOnce('{"title": "eJuices Title", "description": "<div>eJuices desc</div>"}');

      const storePrompts = {
        ejuices: { prompt: 'Write for premium audience' }
      };

      const result = await service.generateForStores(extractedData, storePrompts);

      expect(result).toEqual({
        ejuices: {
          title: 'eJuices Title',
          description: '<div>eJuices desc</div>'
        }
      });

      expect(mockOpenAIInstance.generateDescription).toHaveBeenCalledTimes(1);
      expect(mockOpenAIInstance.generateDescription).toHaveBeenCalledWith(
        expect.stringContaining('Write for premium audience')
      );
    });

    it('should generate content for multiple stores sequentially', async () => {
      mockOpenAIInstance.generateDescription
        .mockResolvedValueOnce('{"title": "Title A", "description": "<div>A</div>"}')
        .mockResolvedValueOnce('{"title": "Title B", "description": "<div>B</div>"}');

      const storePrompts = {
        ejuices: { prompt: 'Prompt A' },
        misthub: { prompt: 'Prompt B' }
      };

      const result = await service.generateForStores(extractedData, storePrompts);

      expect(Object.keys(result)).toEqual(['ejuices', 'misthub']);
      expect(result.ejuices.title).toBe('Title A');
      expect(result.misthub.title).toBe('Title B');
    });

    it('should return empty map when storePrompts is empty', async () => {
      const result = await service.generateForStores(extractedData, {});
      expect(result).toEqual({});
      expect(mockOpenAIInstance.generateDescription).not.toHaveBeenCalled();
    });

    it('should return empty map when storePrompts is undefined', async () => {
      const result = await service.generateForStores(extractedData, undefined);
      expect(result).toEqual({});
    });

    it('should throw when OpenAI call fails', async () => {
      mockOpenAIInstance.generateDescription.mockRejectedValueOnce(new Error('API error'));

      const storePrompts = {
        ejuices: { prompt: 'Write something' }
      };

      await expect(service.generateForStores(extractedData, storePrompts))
        .rejects.toThrow('API error');
    });

    it('should throw when response parsing fails', async () => {
      mockOpenAIInstance.generateDescription.mockResolvedValueOnce('not json');

      const storePrompts = {
        ejuices: { prompt: 'Write something' }
      };

      await expect(service.generateForStores(extractedData, storePrompts))
        .rejects.toThrow('Failed to parse AI response');
    });

    it('should use empty string for description when product has no description attribute', async () => {
      const noDescData = {
        parent: {
          sku: 'TEST-SKU',
          name: 'Title',
          custom_attributes: []
        },
        children: []
      };

      mockOpenAIInstance.generateDescription
        .mockResolvedValueOnce('{"title": "New", "description": "<div>New</div>"}');

      await service.generateForStores(noDescData, { ejuices: { prompt: 'Go' } });

      expect(mockOpenAIInstance.generateDescription).toHaveBeenCalledWith(
        expect.stringContaining('Original Description: ')
      );
    });
  });
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `npx jest tests/services/ai/content-generation.service.test.js --verbose`
Expected: FAIL — `service.generateForStores is not a function`

- [ ] **Step 3: Implement generateForStores**

Add to `ContentGenerationService` class in `src/services/ai/content-generation.service.js`, before the closing `}`:

```js
  async generateForStores(extractedData, storePrompts) {
    if (!storePrompts || Object.keys(storePrompts).length === 0) {
      return {};
    }

    const originalTitle = extractedData.parent.name;
    const descAttr = (extractedData.parent.custom_attributes || [])
      .find(a => a.attribute_code === 'description');
    const originalDescription = descAttr?.value || '';

    const generatedContent = {};

    for (const [storeName, storeConfig] of Object.entries(storePrompts)) {
      logger.info('Generating AI content for store', { storeName, sku: extractedData.parent.sku });

      const prompt = this.buildPrompt(storeConfig.prompt, originalTitle, originalDescription);
      const response = await this.openaiClient.generateDescription(prompt);
      const parsed = this.parseResponse(response);

      generatedContent[storeName] = parsed;

      logger.info('AI content generated for store', {
        storeName,
        sku: extractedData.parent.sku,
        titleLength: parsed.title.length,
        descriptionLength: parsed.description.length
      });
    }

    return generatedContent;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/services/ai/content-generation.service.test.js --verbose`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/ai/content-generation.service.js tests/services/ai/content-generation.service.test.js
git commit -m "feat: add generateForStores method to ContentGenerationService"
```

---

### Task 3: Orchestrator — AI content generation phase and data cloning

**Files:**
- Modify: `src/services/migration/orchestrator.service.js`
- Create: `tests/services/migration/orchestrator-ai-content.test.js`
- Reference: `tests/services/migration/orchestrator-standalone.test.js` (for mock patterns)

- [ ] **Step 1: Write failing tests for orchestrator AI content integration**

```js
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

      // CreationService.createProducts receives extractedData — check the parent was overridden
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

      // Original extractedData should be untouched
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

      // migrateToInstance is called twice — check the second call uses original data
      // Since CreationService is shared mock, check call count and args
      const calls = mockCreationInstance.createProducts.mock.calls;
      expect(calls).toHaveLength(2);

      // First call (ejuices) — AI content
      expect(calls[0][0].parent.name).toBe('AI Title');
      // Second call (misthub) — original content
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
      // No creation should have happened
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

      // Verify standalone creation received modified data
      const createCall = mockStandaloneCreationInstance.createProduct.mock.calls[0];
      const passedData = createCall[0];
      expect(passedData.parent.name).toBe('AI Simple Title');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/services/migration/orchestrator-ai-content.test.js --verbose`
Expected: FAIL — orchestrator doesn't call `ContentGenerationService` yet

- [ ] **Step 3: Implement AI content phase in orchestrator**

In `src/services/migration/orchestrator.service.js`:

**Add import** at the top (after the existing requires):
```js
const ContentGenerationService = require('../ai/content-generation.service');
```

**Add to constructor** (after `this.googleChatService = new GoogleChatService();`):
```js
    this.contentGenerationService = new ContentGenerationService();
```

**Add helper method** `applyGeneratedContent` to the class:
```js
  /**
   * Create a copy of extractedData with AI-generated title and description
   * applied to the parent. Does not mutate the original.
   */
  applyGeneratedContent(extractedData, content) {
    const clonedCustomAttributes = (extractedData.parent.custom_attributes || [])
      .map(attr => ({ ...attr }));

    const descAttr = clonedCustomAttributes.find(a => a.attribute_code === 'description');
    if (descAttr) {
      descAttr.value = content.description;
    } else {
      clonedCustomAttributes.push({
        attribute_code: 'description',
        value: content.description
      });
    }

    return {
      ...extractedData,
      parent: {
        ...extractedData.parent,
        name: content.title,
        custom_attributes: clonedCustomAttributes
      }
    };
  }
```

**Add helper method** `executeAIGenerationPhase` to the class:
```js
  async executeAIGenerationPhase(extractedData, storePrompts, context) {
    const phaseStartTime = Date.now();

    try {
      logger.info('Executing AI content generation phase', { sku: extractedData.parent.sku });

      const generatedContent = await this.contentGenerationService.generateForStores(
        extractedData,
        storePrompts
      );

      const storesGenerated = Object.keys(generatedContent).length;

      context.phases.aiGeneration = {
        success: true,
        duration: Date.now() - phaseStartTime,
        storesGenerated
      };

      logger.info('AI content generation phase completed', {
        sku: extractedData.parent.sku,
        storesGenerated,
        duration: `${context.phases.aiGeneration.duration}ms`
      });

      return generatedContent;
    } catch (error) {
      context.phases.aiGeneration = {
        success: false,
        duration: Date.now() - phaseStartTime,
        storesGenerated: 0
      };

      context.errors.push({
        phase: 'ai-generation',
        message: error.message,
        details: error.stack
      });

      logger.error('AI content generation phase failed', {
        sku: extractedData.parent.sku,
        error: error.message,
        duration: `${context.phases.aiGeneration.duration}ms`
      });

      throw error;
    }
  }
```

**Modify `migrateProduct`** — in the configurable path, after `const extractedData = await this.executeExtractionPhase(sku, migrationContext);` and before the `for (const storeName of targetMagentoStores)` loop, add:

```js
        const generatedContent = await this.executeAIGenerationPhase(
          extractedData,
          options.storePrompts,
          migrationContext
        );
```

Then modify the `migrateToInstance` call inside the loop to pass potentially modified data:

```js
            const storeExtractedData = generatedContent[storeName]
              ? this.applyGeneratedContent(extractedData, generatedContent[storeName])
              : extractedData;

            const instanceResult = await this.migrateToInstance(
              storeName,
              storeExtractedData,
              migrationOptions,
              migrationContext
            );
```

**Do the same for the standalone path** — after `const extractedData = await this.executeStandaloneExtractionPhase(...)` and before the standalone store loop, add:

```js
        const generatedContent = await this.executeAIGenerationPhase(
          extractedData,
          options.storePrompts,
          migrationContext
        );
```

Then modify `migrateStandaloneToInstance` call:

```js
            const storeExtractedData = generatedContent[storeName]
              ? this.applyGeneratedContent(extractedData, generatedContent[storeName])
              : extractedData;

            const instanceResult = await this.migrateStandaloneToInstance(
              sku,
              storeExtractedData,
              storeName,
              migrationOptions
            );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/services/migration/orchestrator-ai-content.test.js --verbose`
Expected: All 8 tests PASS

- [ ] **Step 5: Update existing orchestrator test to mock ContentGenerationService**

The existing test at `tests/services/migration/orchestrator-standalone.test.js` will break because it doesn't mock `ContentGenerationService`. Add this line among the existing `jest.mock()` declarations (after the `google-chat.service` mock):

```js
jest.mock('../../../src/services/ai/content-generation.service');
```

- [ ] **Step 6: Run existing orchestrator tests to verify no regressions**

Run: `npx jest tests/services/migration/orchestrator-standalone.test.js --verbose`
Expected: All existing tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/migration/orchestrator.service.js tests/services/migration/orchestrator-ai-content.test.js tests/services/migration/orchestrator-standalone.test.js
git commit -m "feat: integrate AI content generation phase into migration orchestrator"
```

---

### Task 4: Route validation for storePrompts

**Files:**
- Modify: `src/routes/v1/migration.routes.js`

- [ ] **Step 1: Add storePrompts structural validation to the `/product` route**

In `src/routes/v1/migration.routes.js`, add these validators to the `/product` route array (after the existing `options.targetStores.*` validator, before `validateRequest`):

```js
    body('options.storePrompts')
      .optional()
      .isObject()
      .withMessage('storePrompts must be an object'),
    body('options.storePrompts.*')
      .optional()
      .isObject()
      .withMessage('Each storePrompts entry must be an object'),
    body('options.storePrompts.*.prompt')
      .isString()
      .notEmpty()
      .withMessage('Each storePrompts entry must have a non-empty prompt string'),
    body('options.storePrompts')
      .optional()
      .custom((storePrompts, { req }) => {
        if (!storePrompts) return true;
        const targetStores = req.body.options?.targetMagentoStores || req.body.options?.targetStores || [];
        const invalidKeys = Object.keys(storePrompts).filter(key => !targetStores.includes(key));
        if (invalidKeys.length > 0) {
          throw new Error(`storePrompts contains stores not in targetMagentoStores: ${invalidKeys.join(', ')}`);
        }
        return true;
      }),
```

Note: The `prompt` field validator does NOT use `.optional()` — when a store entry exists in `storePrompts`, its `prompt` field is required.

- [ ] **Step 2: Add the same validation to the `/products/batch` route**

Add the same validators to the batch route array.

- [ ] **Step 3: Commit**

```bash
git add src/routes/v1/migration.routes.js
git commit -m "feat: add storePrompts validation to migration routes"
```

---

### Task 5: Add aiContentApplied flag to instance results

**Files:**
- Modify: `src/services/migration/orchestrator.service.js`

- [ ] **Step 1: Add test for aiContentApplied in instance results**

Add to `tests/services/migration/orchestrator-ai-content.test.js`, in the configurable product describe block:

```js
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
```

- [ ] **Step 2: Add test for standalone path aiContentApplied flag**

Add to the `describe('standalone product with storePrompts')` block in the same test file:

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest tests/services/migration/orchestrator-ai-content.test.js -t "aiContentApplied" --verbose`
Expected: FAIL

- [ ] **Step 4: Implement aiContentApplied flag**

In `orchestrator.service.js`, in the configurable path's store loop, after setting `migrationContext.instanceResults[storeName] = instanceResult;`, add:

```js
            instanceResult.aiContentApplied = !!generatedContent[storeName];
```

Do the same in the standalone path's store loop.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest tests/services/migration/orchestrator-ai-content.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 6: Run full test suite**

Run: `npx jest --verbose`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/services/migration/orchestrator.service.js tests/services/migration/orchestrator-ai-content.test.js
git commit -m "feat: add aiContentApplied flag to migration instance results"
```
