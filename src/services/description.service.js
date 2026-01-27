const OpenAIClient = require('./ai/openai.client');
const SourceService = require('./magento/source.service');
const config = require('../config');
const logger = require('../config/logger');
const { DescriptionGenerationError } = require('../utils/error-handler');

const PROMPT_TEMPLATE = `Write a 5 sentence description for {title}. This is a web listing that should be seo-optimized. Voice should be informative and professional, emphasizing key product features.

Reference the flavor list below for a concise flavor description for each of the following using vivid and highly sensuous language in a simple bulleted list format. Bold the flavor names. Also include a features section based on your findings.

FLAVORS:
{flavors}

Return your response as a JSON object with two fields:
1. "description": The HTML content (see example format below)
2. "keywords": A comma-separated string of 15 SEO keywords relevant to this product

Example description HTML format:
<div><h2>Nexa Ultra V2 50K Puffs Disposable Vape</h2></div>
<div>
    <p>"Experience next-level vaping with the Nexa Ultra V2 50K Puffs Disposable Vape Device, engineered for performance, longevity, and an unmatched flavor experience. Boasting an impressive 50,000 puff capacity, this powerhouse is built for extended use, supported by a reliable 900mAh rechargeable battery that ensures consistent output across sessions. The device offers customizable inhalation with both Normal and Boost Modes, letting users switch between smooth draws and more intense hits depending on their preference. A dynamic LED screen provides real-time updates on battery life, puff count, and mode selection, all easily viewable in any lighting condition thanks to its innovative Dark Mode feature. Choose from a wide array of vibrant, expertly blended flavors that deliver rich, layered profiles with every puff, making the Nexa Ultra V2 a standout choice for discerning vapers seeking both style and substance.</p>

    <p><strong>Flavors:</strong></p>
    <ul>
        <li><strong>Watermelon Ice:</strong> A lush burst of sun-ripened watermelon floods the senses, chased by a crystalline wave of icy menthol that tingles and refreshes with every exhale.</li>
        <li><strong>Strawberry Mango:</strong> Velvety strawberries swirl with golden mango nectar in a tropical duet that's sweet, juicy, and dripping with exotic indulgence.</li>
    </ul>

    <p><strong>Features:</strong></p>
    <ul>
        <li>Up to 50,000 Puffs</li>
        <li>900mAh Rechargeable Battery</li>
    </ul>
</div>

Respond ONLY with the JSON object, no other text.`;

const PROMPT_TEMPLATE_NO_FLAVORS = `Write a 5 sentence description for {title}. This is a web listing that should be seo-optimized. Voice should be informative and professional, emphasizing key product features.

Also include a features section based on your findings.

Return your response as a JSON object with two fields:
1. "description": The HTML content with a <div> wrapper containing a <p> for the description and a <ul> for features
2. "keywords": A comma-separated string of 15 SEO keywords relevant to this product

Respond ONLY with the JSON object, no other text.`;

class DescriptionService {
  constructor() {
    this.openaiClient = new OpenAIClient();
    this.sourceService = new SourceService(
      config.source.baseUrl,
      config.source.token
    );
  }

  async generateAndUpdateDescription(sku) {
    logger.info('Starting description generation', { sku });

    // Step 1: Fetch product from source Magento
    const product = await this.sourceService.getProductBySku(sku);
    if (!product) {
      throw new DescriptionGenerationError(
        `Product with SKU '${sku}' not found`,
        'PRODUCT_NOT_FOUND',
        404
      );
    }

    const title = product.name;
    logger.info('Product found', { sku, title });

    // Step 2: Get flavor attribute options for ID-to-label mapping
    const flavorOptions = await this.sourceService.getAttributeOptions('flavor');
    const flavorMap = this.buildFlavorMap(flavorOptions);
    logger.debug('Flavor options loaded', { count: flavorOptions.length });

    // Step 3: Get configurable children and extract flavors
    const children = await this.sourceService.getConfigurableChildren(sku);
    const flavors = this.extractFlavors(children, flavorMap);
    logger.info('Flavors extracted', { sku, count: flavors.length });

    // Step 4: Build prompt and generate description
    const prompt = this.buildPrompt(title, flavors);
    const response = await this.openaiClient.generateDescription(prompt);
    const { description, keywords } = this.parseAIResponse(response);
    logger.info('Description generated', { sku, descriptionLength: description.length, keywordsLength: keywords.length });

    // Step 5: Update product with description and meta keywords
    await this.updateProduct(sku, description, keywords);
    logger.info('Product updated', { sku });

    return {
      sku,
      title,
      flavorsFound: flavors.length,
      description,
      keywords,
      updatedAt: new Date().toISOString()
    };
  }

  parseAIResponse(response) {
    try {
      // Try to parse as JSON directly
      let parsed = JSON.parse(response);
      return {
        description: parsed.description || '',
        keywords: parsed.keywords || ''
      };
    } catch (e) {
      // If JSON parsing fails, try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return {
            description: parsed.description || '',
            keywords: parsed.keywords || ''
          };
        } catch (e2) {
          logger.warn('Failed to parse AI response as JSON', { response: response.substring(0, 200) });
        }
      }
      // Fallback: return entire response as description, no keywords
      return {
        description: response,
        keywords: ''
      };
    }
  }

  buildFlavorMap(flavorOptions) {
    const map = new Map();
    for (const option of flavorOptions) {
      if (option.value && option.label) {
        map.set(option.value, option.label);
      }
    }
    return map;
  }

  extractFlavors(children, flavorMap) {
    const flavors = [];

    for (const child of children) {
      const customAttributes = child.custom_attributes || [];
      const flavorAttr = customAttributes.find(attr => attr.attribute_code === 'flavor');

      if (flavorAttr && flavorAttr.value) {
        // Look up the label from the flavor map
        const label = flavorMap.get(flavorAttr.value) || flavorAttr.value;
        flavors.push(label);
      }
    }

    // Remove duplicates and sort
    return [...new Set(flavors)].sort();
  }

  buildPrompt(title, flavors) {
    if (flavors.length === 0) {
      return PROMPT_TEMPLATE_NO_FLAVORS.replace('{title}', title);
    }

    const flavorsList = flavors.map(f => `- ${f}`).join('\n');
    return PROMPT_TEMPLATE
      .replace('{title}', title)
      .replace('{flavors}', flavorsList);
  }

  async updateProduct(sku, description, keywords) {
    const customAttributes = [
      {
        attribute_code: 'description',
        value: description
      }
    ];

    if (keywords) {
      customAttributes.push({
        attribute_code: 'meta_keyword',
        value: keywords
      });
    }

    const payload = {
      product: {
        sku,
        custom_attributes: customAttributes
      }
    };

    try {
      await this.sourceService.client.put(
        `/rest/all/V1/products/${encodeURIComponent(sku)}`,
        payload
      );
    } catch (error) {
      throw new DescriptionGenerationError(
        'Failed to update product',
        'UPDATE_FAILED',
        502,
        { originalError: error.message }
      );
    }
  }
}

module.exports = DescriptionService;
