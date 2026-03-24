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
