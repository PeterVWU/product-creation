const OpenAI = require('openai');
const config = require('../../config');
const logger = require('../../config/logger');
const { DescriptionGenerationError } = require('../../utils/error-handler');

class OpenAIClient {
  constructor() {
    if (!config.openai.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    this.client = new OpenAI({ apiKey: config.openai.apiKey });
    this.model = config.openai.model;
    this.maxRetries = 3;
    this.retryDelay = 1000;
  }

  async generateDescription(prompt) {
    let lastError;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.debug('Calling OpenAI API', { model: this.model, attempt });

        const response = await this.client.chat.completions.create({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error('Empty response from OpenAI');
        }

        logger.info('OpenAI response received', {
          model: this.model,
          tokens: response.usage?.total_tokens
        });

        return content;
      } catch (error) {
        lastError = error;
        logger.warn('OpenAI API call failed', {
          attempt,
          error: error.message,
          status: error.status
        });

        if (error.status === 429) {
          throw new DescriptionGenerationError(
            'OpenAI rate limit exceeded',
            'AI_RATE_LIMITED',
            429,
            { originalError: error.message }
          );
        }

        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt - 1);
          logger.debug('Retrying after delay', { delay });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw new DescriptionGenerationError(
      'Failed to generate description after retries',
      'AI_GENERATION_FAILED',
      502,
      { originalError: lastError?.message }
    );
  }
}

module.exports = OpenAIClient;
