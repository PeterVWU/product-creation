const OpenAIClient = require('./ai/openai.client');
const TargetService = require('./magento/target.service');
const config = require('../config');
const logger = require('../config/logger');
const { DescriptionGenerationError } = require('../utils/error-handler');

const PROMPT_TEMPLATE = `Write a 5 sentence description for {title}. This is a web listing that should be seo-optimized. Voice should be informative and professional, emphasizing key product features.

Reference the flavor list below for a concise flavor description for each of the following using vivid and highly sensuous language in a simple bulleted list format. Bold the flavor names. Reference example format attached. Also include a features section based on your findings.

Include 15 SEO keywords relevant to this product at the end.

FLAVORS:
{flavors}

Example:
<div>Nexa Ultra V2 50K Puffs Disposable Vape</div>
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
</div>`;

const PROMPT_TEMPLATE_NO_FLAVORS = `Write a 5 sentence description for {title}. This is a web listing that should be seo-optimized. Voice should be informative and professional, emphasizing key product features.

Also include a features section based on your findings.

Include 15 SEO keywords relevant to this product at the end.

Format the output as HTML with a <div> wrapper containing a <p> for the description and a <ul> for features.`;

class DescriptionService {
  constructor() {
    this.openaiClient = new OpenAIClient();
    this.targetService = new TargetService(
      config.target.baseUrl,
      config.target.token
    );
  }

  async generateAndUpdateDescription(sku) {
    logger.info('Starting description generation', { sku });

    // Step 1: Fetch product from target Magento
    const product = await this.targetService.getProductBySku(sku);
    if (!product) {
      throw new DescriptionGenerationError(
        `Product with SKU '${sku}' not found`,
        'PRODUCT_NOT_FOUND',
        404
      );
    }

    const title = product.name;
    logger.info('Product found', { sku, title });

    // Step 2: Get configurable children and extract flavors
    const children = await this.targetService.getConfigurableChildren(sku);
    const flavors = this.extractFlavors(children);
    logger.info('Flavors extracted', { sku, count: flavors.length });

    // Step 3: Build prompt and generate description
    const prompt = this.buildPrompt(title, flavors);
    const description = await this.openaiClient.generateDescription(prompt);
    logger.info('Description generated', { sku, length: description.length });

    // Step 4: Update product with new description
    await this.updateProductDescription(sku, description);
    logger.info('Product description updated', { sku });

    return {
      sku,
      title,
      flavorsFound: flavors.length,
      description,
      updatedAt: new Date().toISOString()
    };
  }

  extractFlavors(children) {
    const flavors = [];

    for (const child of children) {
      const customAttributes = child.custom_attributes || [];
      const flavorAttr = customAttributes.find(attr => attr.attribute_code === 'flavor');

      if (flavorAttr && flavorAttr.value) {
        // Value could be the label or an ID - we want the label
        // If it's a number, we'd need to look up the label, but typically it's already the label
        flavors.push(flavorAttr.value);
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

  async updateProductDescription(sku, description) {
    const payload = {
      product: {
        sku,
        custom_attributes: [
          {
            attribute_code: 'description',
            value: description
          }
        ]
      }
    };

    try {
      await this.targetService.client.put(
        `/rest/all/V1/products/${encodeURIComponent(sku)}`,
        payload
      );
    } catch (error) {
      throw new DescriptionGenerationError(
        'Failed to update product description',
        'UPDATE_FAILED',
        502,
        { originalError: error.message }
      );
    }
  }
}

module.exports = DescriptionService;
