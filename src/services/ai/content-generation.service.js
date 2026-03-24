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
