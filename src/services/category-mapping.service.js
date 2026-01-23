const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');

class CategoryMappingService {
  constructor(mappingFilePath = null) {
    this.mappingFilePath = mappingFilePath || path.join(process.cwd(), 'category-mapping.json');
    this.mappings = [];
    this.sourceToShopify = new Map();
    this.sourceToTargetMagento = new Map();
    this.loaded = false;
  }

  loadMappings() {
    if (this.loaded) {
      return;
    }

    try {
      if (!fs.existsSync(this.mappingFilePath)) {
        logger.warn('Category mapping file not found', { path: this.mappingFilePath });
        this.loaded = true;
        return;
      }

      const fileContent = fs.readFileSync(this.mappingFilePath, 'utf-8');
      const data = JSON.parse(fileContent);

      this.mappings = data.mappings || [];

      // Build lookup maps
      for (const mapping of this.mappings) {
        const sourceKey = mapping.source.toLowerCase();

        if (mapping.shopify) {
          this.sourceToShopify.set(sourceKey, mapping.shopify);
        }

        if (mapping.targetMagento) {
          this.sourceToTargetMagento.set(sourceKey, mapping.targetMagento);
        }
      }

      this.loaded = true;

      logger.info('Category mappings loaded', {
        mappingCount: this.mappings.length,
        shopifyMappings: this.sourceToShopify.size,
        magentoMappings: this.sourceToTargetMagento.size
      });
    } catch (error) {
      logger.error('Failed to load category mappings', {
        path: this.mappingFilePath,
        error: error.message
      });
      this.loaded = true;
    }
  }

  /**
   * Get the Shopify productType for the given source category names.
   * Returns the first matching Shopify type, or null if no match found.
   * @param {string[]} sourceCategoryNames - Array of source category names
   * @returns {string|null} - The Shopify product type or null
   */
  getShopifyProductType(sourceCategoryNames) {
    this.loadMappings();

    if (!sourceCategoryNames || sourceCategoryNames.length === 0) {
      return null;
    }

    for (const categoryName of sourceCategoryNames) {
      const key = categoryName.toLowerCase();
      if (this.sourceToShopify.has(key)) {
        const shopifyType = this.sourceToShopify.get(key);
        logger.debug('Found Shopify product type mapping', {
          sourceCategory: categoryName,
          shopifyType
        });
        return shopifyType;
      }
    }

    logger.debug('No Shopify product type mapping found', { sourceCategoryNames });
    return null;
  }

  /**
   * Get the target Magento category names for the given source category names.
   * Maps all matching source categories to their target equivalents.
   * Unmapped categories pass through unchanged.
   * @param {string[]} sourceCategoryNames - Array of source category names
   * @returns {string[]} - Array of target category names
   */
  getTargetMagentoCategories(sourceCategoryNames) {
    this.loadMappings();

    if (!sourceCategoryNames || sourceCategoryNames.length === 0) {
      return [];
    }

    const targetCategories = [];
    const seen = new Set();

    for (const categoryName of sourceCategoryNames) {
      const key = categoryName.toLowerCase();
      let targetName;

      if (this.sourceToTargetMagento.has(key)) {
        targetName = this.sourceToTargetMagento.get(key);
        logger.debug('Mapped source category to target', {
          sourceCategory: categoryName,
          targetCategory: targetName
        });
      } else {
        // Unmapped categories pass through unchanged
        targetName = categoryName;
        logger.debug('Category unmapped, passing through unchanged', {
          category: categoryName
        });
      }

      // Avoid duplicates (e.g., "Pod System Kits" and "Pod Mod Systems" both map to "Vape Kits")
      if (!seen.has(targetName.toLowerCase())) {
        seen.add(targetName.toLowerCase());
        targetCategories.push(targetName);
      }
    }

    return targetCategories;
  }

  /**
   * Check if a source category has a mapping defined
   * @param {string} sourceCategoryName - The source category name
   * @returns {boolean} - True if a mapping exists
   */
  hasMapping(sourceCategoryName) {
    this.loadMappings();
    return this.sourceToTargetMagento.has(sourceCategoryName.toLowerCase());
  }
}

module.exports = CategoryMappingService;
