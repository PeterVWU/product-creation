const OpenAIClient = require('../ai/openai.client');
const logger = require('../../config/logger');
const vapordnaPrompt = require('./prompts/vapordna.prompt');

const STORE_PROMPTS = {
  vapordna: vapordnaPrompt
};

class StoreDescriptionService {
  constructor(openaiClient = null) {
    this.openaiClient = openaiClient;
  }

  getOpenAIClient() {
    if (!this.openaiClient) {
      this.openaiClient = new OpenAIClient();
    }
    return this.openaiClient;
  }

  hasPromptForStore(storeName) {
    if (!storeName) return false;
    return Boolean(STORE_PROMPTS[storeName.toLowerCase()]);
  }

  async generate(storeName, context) {
    const key = storeName ? storeName.toLowerCase() : null;
    const promptModule = key ? STORE_PROMPTS[key] : null;
    if (!promptModule) {
      logger.debug('No store-specific prompt configured', { storeName });
      return null;
    }

    const prompt = promptModule.buildPrompt(context);
    logger.info('Generating store-specific description', {
      storeName: key,
      title: context.title,
      flavorCount: (context.flavors || []).length,
      hasPartner: Boolean(context.partnerUrl)
    });

    const response = await this.getOpenAIClient().generateDescription(prompt);
    const parsed = this.parseResponse(response);

    logger.info('Store description generated', {
      storeName: key,
      descriptionLength: parsed.descriptionHtml.length,
      keywordsLength: parsed.keywords.length
    });

    return parsed;
  }

  parseResponse(response) {
    const tryParse = (text) => {
      const obj = JSON.parse(text);
      return {
        descriptionHtml: obj.description || '',
        keywords: obj.keywords || ''
      };
    };

    try {
      return tryParse(response);
    } catch (_) {
      const match = response.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return tryParse(match[0]);
        } catch (e2) {
          logger.warn('Failed to parse store description response', {
            snippet: response.substring(0, 200)
          });
        }
      }
      return { descriptionHtml: response, keywords: '' };
    }
  }
}

module.exports = StoreDescriptionService;
