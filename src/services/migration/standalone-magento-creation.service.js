// src/services/migration/standalone-magento-creation.service.js
'use strict';

const logger = require('../../config/logger');
const ImageService = require('../image.service');
const config = require('../../config');
const constants = require('../../config/constants');

class StandaloneMagentoCreationService {
  constructor(sourceService, targetService) {
    this.sourceService = sourceService;
    this.targetService = targetService;
    this.imageService = new ImageService(sourceService, targetService, {
      maxSizeMB: config.concurrency.maxImageSizeMB
    });
  }

  /**
   * Create a standalone simple product across all store views.
   * Owns the store-view loop — caller invokes this once.
   */
  async createProduct(extractedData, preparedData, storeViews, websiteIds, options = {}) {
    const { parent } = extractedData;
    logger.info('Starting standalone Magento product creation', { sku: parent.sku, storeViews });

    const storeResults = {};
    let parentProductId = null;
    let isFirstStore = true;
    let imagesUploaded = 0;

    for (const storeCode of storeViews) {
      if (isFirstStore) {
        logger.info('Creating standalone product globally (first store view)', {
          sku: parent.sku,
          storeCode,
          websiteIds
        });

        try {
          const productData = this._buildProductData(parent, preparedData, websiteIds, options);
          const createdProduct = await this.targetService.createOrUpdateProduct(productData);
          parentProductId = createdProduct.id;

          if (options.includeImages && extractedData.images.parent.length > 0) {
            imagesUploaded = await this._uploadImages(parent.sku, extractedData.images.parent);
          }

          storeResults[storeCode] = {
            success: true,
            productId: parentProductId,
            imagesUploaded,
            mode: 'standalone-creation'
          };

          logger.info('Standalone product created on first store view', {
            sku: parent.sku,
            storeCode,
            productId: parentProductId
          });

          isFirstStore = false;
        } catch (error) {
          logger.error('Standalone product creation failed on first store view', {
            sku: parent.sku,
            storeCode,
            error: error.message
          });

          storeResults[storeCode] = {
            success: false,
            error: error.message,
            mode: 'standalone-creation'
          };

          if (!config.errorHandling.continueOnError) {
            throw error;
          }
          // If continueOnError: true, next store also tries as first store
        }
      } else {
        // Subsequent stores: update store-scoped attributes only
        logger.info('Updating standalone product for subsequent store view', {
          sku: parent.sku,
          storeCode
        });

        try {
          await this.updateProductForStore(extractedData, storeCode, options);

          storeResults[storeCode] = {
            success: true,
            productId: parentProductId,
            mode: 'store-update'
          };
        } catch (error) {
          logger.error('Standalone product store update failed', {
            sku: parent.sku,
            storeCode,
            error: error.message
          });

          storeResults[storeCode] = {
            success: false,
            error: error.message,
            mode: 'store-update'
          };

          if (!config.errorHandling.continueOnError) {
            throw error;
          }
        }
      }
    }

    logger.info('Standalone Magento product creation completed', { sku: parent.sku });

    return { parentProductId, imagesUploaded, storeResults };
  }

  /**
   * Update store-scoped attributes for a subsequent store view.
   * Mirrors CreationService.updateProductsForStore() for the parent only.
   */
  async updateProductForStore(extractedData, storeCode, options = {}) {
    const { parent } = extractedData;
    const scopedTargetService = this.targetService.createScopedInstance(storeCode);

    const updateData = {
      sku: parent.sku,
      name: parent.name,
      price: parent.price,
      status: options.productEnabled !== false
        ? constants.MAGENTO_API.STATUS.ENABLED
        : constants.MAGENTO_API.STATUS.DISABLED,
      visibility: constants.MAGENTO_API.VISIBILITY.CATALOG_SEARCH
    };

    await scopedTargetService.createOrUpdateProduct(updateData);

    logger.info('Updated standalone product for store scope', { sku: parent.sku, storeCode });
  }

  _buildProductData(parent, preparedData, websiteIds, options) {
    // Custom attributes — skip category_ids (handled via category_links)
    const customAttributes = [];
    if (parent.custom_attributes) {
      for (const attr of parent.custom_attributes) {
        if (attr.attribute_code === 'category_ids') continue;
        customAttributes.push({
          attribute_code: attr.attribute_code,
          value: attr.value
        });
      }
    }

    const productData = {
      sku: parent.sku,
      name: parent.name,
      attribute_set_id: preparedData.attributeSet?.id || 4,
      price: parent.price,
      status: options.productEnabled !== false
        ? constants.MAGENTO_API.STATUS.ENABLED
        : constants.MAGENTO_API.STATUS.DISABLED,
      visibility: constants.MAGENTO_API.VISIBILITY.CATALOG_SEARCH,
      type_id: constants.MAGENTO_API.PRODUCT_TYPES.SIMPLE,
      weight: '0.1',
      custom_attributes: customAttributes
    };

    if (websiteIds && websiteIds.length > 0) {
      productData.website_ids = websiteIds;
    }

    // Category links from prepared category mapping
    if (preparedData.categoryMapping && Object.keys(preparedData.categoryMapping).length > 0) {
      const categoryLinks = Object.values(preparedData.categoryMapping).map(categoryId => ({
        category_id: categoryId.toString(),
        position: 0
      }));
      productData.extension_attributes = { category_links: categoryLinks };
    }

    // Stock item from source product
    const sourceStockItem = parent.extension_attributes?.stock_item;
    if (sourceStockItem) {
      productData.stock_item = {
        qty: sourceStockItem.qty || 0,
        is_in_stock: sourceStockItem.is_in_stock !== false,
        manage_stock: sourceStockItem.manage_stock !== false
      };
    }

    return productData;
  }

  async _uploadImages(sku, imageEntries) {
    try {
      await this.imageService.migrateImages(sku, imageEntries, { isParent: true });
      return imageEntries.length;
    } catch (error) {
      logger.warn('Failed to upload images for standalone product', {
        sku,
        error: error.message
      });
      return 0;
    }
  }
}

module.exports = StandaloneMagentoCreationService;
