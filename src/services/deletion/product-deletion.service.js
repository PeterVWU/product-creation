const logger = require('../../config/logger');
const config = require('../../config');
const SourceService = require('../magento/source.service');
const TargetService = require('../magento/target.service');
const ShopifyTargetService = require('../shopify/shopify-target.service');

class ProductDeletionService {
  /**
   * Get the appropriate platform service instance.
   */
  _getService(platform, storeName) {
    switch (platform) {
      case 'source-magento':
        return new SourceService(config.source.baseUrl, config.source.token, config.api);
      case 'target-magento':
        return TargetService.getInstanceForStore(storeName);
      case 'target-shopify': {
        const storeConfig = config.shopify.stores[storeName];
        if (!storeConfig) {
          const available = Object.keys(config.shopify.stores);
          throw Object.assign(
            new Error(`Shopify store '${storeName}' not configured. Available: ${available.join(', ') || 'none'}`),
            { statusCode: 400 }
          );
        }
        return new ShopifyTargetService(storeConfig.url, storeConfig.token);
      }
      default:
        throw Object.assign(
          new Error(`Invalid platform: ${platform}`),
          { statusCode: 400 }
        );
    }
  }

  /**
   * Fetch product by SKU from the given platform.
   * Returns null if not found.
   */
  async _fetchProduct(service, sku, platform) {
    if (platform === 'target-shopify') {
      const variants = await service.getVariantsBySkus([sku]);
      if (!variants || variants.length === 0) return null;
      const productId = variants[0].product?.id;
      if (!productId) return null;
      const product = await service.getProductById(productId);
      return product ? { ...product, _shopifyProductId: product.id } : null;
    }
    // Magento (source or target)
    return await service.getProductBySku(sku);
  }

  /**
   * Fetch children for a configurable/multi-variant product.
   */
  async _fetchChildren(service, product, sku, platform) {
    if (platform === 'target-shopify') {
      // Shopify variants are in the product response
      const variants = product.variants?.edges?.map(e => e.node) || [];
      // Only treat as "children" if there are multiple variants
      return variants.length > 1 ? variants : [];
    }
    // Magento configurable product
    if (product.type_id === 'configurable') {
      return await service.getConfigurableChildren(sku);
    }
    return [];
  }

  /**
   * Delete a single product/variant from the platform.
   */
  async _deleteSingle(service, identifier, platform) {
    if (platform === 'target-shopify') {
      // identifier is a Shopify product ID (gid://...)
      return await service.deleteProduct(identifier);
    }
    // Magento: identifier is SKU
    return await service.deleteProduct(identifier);
  }

  /**
   * Delete a product by SKU from the specified platform.
   * @param {Object} params
   * @param {string} params.sku - Product SKU
   * @param {string} params.platform - One of: source-magento, target-magento, target-shopify
   * @param {string} [params.storeName] - Required for target platforms
   * @returns {Object} Result with success, sku, deletedSkus, failedSkus
   */
  async deleteProduct({ sku, platform, storeName }) {
    logger.info('Starting product deletion', { sku, platform, storeName });

    const service = this._getService(platform, storeName);
    const deletedSkus = [];
    const failedSkus = [];

    // 1. Fetch product to verify it exists
    const product = await this._fetchProduct(service, sku, platform);
    if (!product) {
      const err = new Error(`Product not found: ${sku}`);
      err.statusCode = 404;
      throw err;
    }

    // 2. Fetch children if configurable/multi-variant
    const children = await this._fetchChildren(service, product, sku, platform);

    // 3. Delete children first (stop on failure)
    for (const child of children) {
      const childIdentifier = platform === 'target-shopify' ? child.id : child.sku;
      const childSku = child.sku || childIdentifier;
      try {
        await this._deleteSingle(service, childIdentifier, platform);
        deletedSkus.push(childSku);
        logger.info('Child product deleted', { childSku, parentSku: sku });
      } catch (error) {
        failedSkus.push(childSku);
        logger.error('Child deletion failed, stopping', { childSku, parentSku: sku, error: error.message });
        return {
          success: false,
          sku,
          platform,
          storeName,
          deletedSkus,
          failedSkus,
          error: `Child deletion failed for ${childSku}: ${error.message}`
        };
      }
    }

    // 4. Delete the parent product
    try {
      const parentIdentifier = platform === 'target-shopify' ? product._shopifyProductId : sku;
      await this._deleteSingle(service, parentIdentifier, platform);
      deletedSkus.push(sku);
      logger.info('Parent product deleted', { sku });
    } catch (error) {
      failedSkus.push(sku);
      logger.error('Parent deletion failed', { sku, error: error.message });
      return {
        success: false,
        sku,
        platform,
        storeName,
        deletedSkus,
        failedSkus,
        error: `Parent deletion failed: ${error.message}`
      };
    }

    // 5. Verify deletion
    const verifyResult = await this._fetchProduct(service, sku, platform);
    if (verifyResult) {
      logger.warn('Product still exists after deletion', { sku, platform });
      return {
        success: false,
        sku,
        platform,
        storeName,
        deletedSkus,
        failedSkus: [sku],
        error: 'Product still exists after deletion attempt'
      };
    }

    logger.info('Product deletion verified', { sku, platform, storeName, deletedCount: deletedSkus.length });
    return {
      success: true,
      sku,
      platform,
      storeName,
      deletedSkus
    };
  }
}

module.exports = new ProductDeletionService();
