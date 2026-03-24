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
});
