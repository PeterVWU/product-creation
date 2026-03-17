// src/services/migration/standalone-extraction.service.js
'use strict';

const logger = require('../../config/logger');
const AttributeService = require('../attribute.service');

class StandaloneExtractionService {
  constructor(sourceService) {
    this.sourceService = sourceService;
    this.attributeService = new AttributeService(sourceService);
  }

  /**
   * Extract a standalone simple product.
   * @param {string} sku
   * @param {Object} prefetchedProduct - Already fetched by the orchestrator type probe
   * @returns {{ parent, images, categories, translations, children, childLinks }}
   */
  async extractProduct(sku, prefetchedProduct) {
    const startTime = Date.now();
    logger.info('Starting standalone extraction phase', { sku });

    try {
      const parent = prefetchedProduct;

      const translations = await this._buildTranslations(parent);
      const images = this._extractImages(parent);
      const categories = this._extractCategories(translations);

      const duration = Date.now() - startTime;
      logger.info('Standalone extraction phase completed', {
        sku,
        duration: `${duration}ms`,
        categoriesFound: categories.length
      });

      return {
        parent,
        images,
        categories,
        translations,
        children: [],   // Required: orchestrators read .children.length and .map()
        childLinks: []  // Required: matches ExtractionService return shape
      };
    } catch (error) {
      logger.error('Standalone extraction phase failed', { sku, error: error.message });
      throw error;
    }
  }

  async _buildTranslations(parent) {
    const translations = {
      attributeSet: null,
      attributes: {},         // hardcoded empty — no configurable options
      attributeValues: {},    // hardcoded empty — no configurable option values
      categories: {},
      customAttributes: {}
    };

    translations.attributeSet = await this.attributeService.translateAttributeSet(
      parent.attribute_set_id
    );

    if (parent.custom_attributes) {
      translations.customAttributes = await this.attributeService.translateCustomAttributes(parent);
    }

    translations.brandLabel = await this.attributeService.translateBrandAttribute(parent);

    const categoryIds = parent.extension_attributes?.category_links?.map(link => link.category_id) || [];
    if (categoryIds.length > 0) {
      translations.categories = await this.attributeService.translateCategories(categoryIds);
    }

    return translations;
  }

  _extractImages(parent) {
    const images = {
      parent: [],
      children: {}  // empty — no variants
    };

    if (parent.media_gallery_entries && parent.media_gallery_entries.length > 0) {
      images.parent = parent.media_gallery_entries
        .filter(entry => !entry.disabled)
        .map(entry => ({
          file: entry.file,
          label: entry.label,
          position: entry.position,
          types: entry.types || [],
          disabled: false
        }));
    }

    return images;
  }

  _extractCategories(translations) {
    return Object.entries(translations.categories || {}).map(([id, name]) => ({
      id: parseInt(id, 10),
      name
    }));
  }
}

module.exports = StandaloneExtractionService;
