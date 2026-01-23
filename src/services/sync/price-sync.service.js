const logger = require('../../config/logger');
const config = require('../../config');
const SourceService = require('../magento/source.service');
const TargetService = require('../magento/target.service');
const ShopifyTargetService = require('../shopify/shopify-target.service');
const GoogleChatService = require('../notification/google-chat.service');
const { validateStoreCodes, normalizeStoreCodes } = require('../../utils/store-scope-helpers');

class PriceSyncService {
  constructor() {
    this.sourceService = new SourceService(
      config.source.baseUrl,
      config.source.token,
      config.api
    );

    this.targetService = new TargetService(
      config.target.baseUrl,
      config.target.token,
      config.api
    );

    this.targetConfig = {
      baseUrl: config.target.baseUrl,
      token: config.target.token,
      apiConfig: config.api,
      defaultStoreCodes: config.target.storeCodes
    };

    this.shopifyStores = config.shopify.stores;
    this.googleChatService = new GoogleChatService();
  }

  /**
   * Main entry point for price synchronization
   * @param {string} sku - Parent product SKU
   * @param {Object} options - Sync options
   * @returns {Object} Sync result
   */
  async syncPrices(sku, options = {}) {
    const startTime = Date.now();

    logger.info('Starting price sync', { sku, options });

    const result = {
      success: true,
      sku,
      variantCount: 0,
      results: {
        magento: {},
        shopify: {}
      },
      errors: [],
      warnings: []
    };

    // Resolve target stores for notifications
    const targetMagentoStores = this.resolveMagentoTargetStores(options.targetMagentoStores);
    const targetShopifyStores = this.resolveShopifyTargetStores(options.targetShopifyStores);
    const allTargetStores = [...targetMagentoStores, ...targetShopifyStores.map(s => `shopify:${s}`)];

    try {
      // Step 1: Extract prices from source
      const priceData = await this.extractPrices(sku);
      result.variantCount = priceData.children.length;

      logger.info('Prices extracted from source', {
        sku,
        variantCount: priceData.children.length
      });

      // Send start notification
      await this.googleChatService.notifyPriceSyncStart(
        sku,
        priceData.children.length,
        allTargetStores
      );

      // Step 2: Update Magento prices if enabled
      const includeMagento = options.includeMagento !== false;
      if (includeMagento) {
        const magentoResult = await this.updateMagentoPrices(priceData, options);
        result.results.magento = magentoResult.storeResults;

        if (magentoResult.errors.length > 0) {
          result.errors.push(...magentoResult.errors);
        }
        if (magentoResult.warnings.length > 0) {
          result.warnings.push(...magentoResult.warnings);
        }
      }

      // Step 3: Update Shopify prices if enabled
      const includeShopify = options.includeShopify !== false;
      if (includeShopify && Object.keys(this.shopifyStores).length > 0) {
        const shopifyResult = await this.updateShopifyPrices(priceData, options);
        result.results.shopify = shopifyResult.storeResults;

        if (shopifyResult.errors.length > 0) {
          result.errors.push(...shopifyResult.errors);
        }
        if (shopifyResult.warnings.length > 0) {
          result.warnings.push(...shopifyResult.warnings);
        }
      }

      // Determine overall success
      const magentoFailed = Object.values(result.results.magento).some(r => !r.success);
      const shopifyFailed = Object.values(result.results.shopify).some(r => !r.success);
      result.success = !magentoFailed && !shopifyFailed && result.errors.length === 0;

      const duration = Date.now() - startTime;
      logger.info('Price sync completed', {
        sku,
        success: result.success,
        duration: `${duration}ms`
      });

      // Send end notification
      await this.googleChatService.notifyPriceSyncEnd({
        sku,
        success: result.success,
        variantCount: result.variantCount,
        prices: priceData.children,
        errors: result.errors,
        targetStores: allTargetStores,
        duration
      });

      return result;
    } catch (error) {
      result.success = false;
      result.errors.push({
        phase: 'price-sync',
        message: error.message,
        details: error.stack
      });

      const duration = Date.now() - startTime;
      logger.error('Price sync failed', {
        sku,
        error: error.message,
        duration: `${duration}ms`
      });

      // Send failure notification
      await this.googleChatService.notifyPriceSyncEnd({
        sku,
        success: false,
        variantCount: 0,
        prices: [],
        errors: result.errors,
        targetStores: allTargetStores,
        duration
      });

      return result;
    }
  }

  /**
   * Extract prices from source Magento
   * @param {string} sku - Parent product SKU
   * @returns {Object} Price data with parent and children prices
   */
  async extractPrices(sku) {
    logger.info('Extracting prices from source', { sku });

    const parent = await this.sourceService.getProductBySku(sku);
    if (!parent) {
      throw new Error(`Product not found in source: ${sku}`);
    }

    const priceData = {
      parentSku: sku,
      parentPrice: parent.price,
      isConfigurable: parent.type_id === 'configurable',
      children: []
    };

    // If configurable, get children prices
    if (priceData.isConfigurable) {
      const childLinks = this.extractChildLinks(parent);
      const childSkus = this.resolveChildSkus(childLinks);

      for (const childSku of childSkus) {
        try {
          const child = await this.sourceService.getProductBySku(childSku);
          if (child) {
            priceData.children.push({
              sku: child.sku,
              price: child.price
            });
          }
        } catch (error) {
          logger.warn('Failed to fetch child product price', {
            parentSku: sku,
            childSku,
            error: error.message
          });
        }
      }
    }

    // Log extracted price data for debugging
    logger.info('Price data extracted from Magento', {
      parentSku: priceData.parentSku,
      isConfigurable: priceData.isConfigurable,
      childCount: priceData.children.length,
      childSkus: priceData.children.map(c => c.sku)
    });

    return priceData;
  }

  /**
   * Extract child links from parent product
   */
  extractChildLinks(parent) {
    const links = [];

    if (parent.extension_attributes?.configurable_product_link_data) {
      for (const dataStr of parent.extension_attributes.configurable_product_link_data) {
        try {
          const data = JSON.parse(dataStr);
          if (data.simple_product_sku) {
            links.push({
              sku: data.simple_product_sku,
              id: data.simple_product_id
            });
          }
        } catch (error) {
          logger.warn('Failed to parse configurable_product_link_data', { error: error.message });
        }
      }
      return links;
    }

    if (parent.extension_attributes?.configurable_product_links) {
      return parent.extension_attributes.configurable_product_links.map(link => {
        return typeof link === 'object' ? link.sku || link.id || link : link;
      });
    }

    return links;
  }

  /**
   * Resolve child SKUs from links
   */
  resolveChildSkus(childLinks) {
    if (!childLinks || childLinks.length === 0) {
      return [];
    }

    const skus = [];
    for (const link of childLinks) {
      if (typeof link === 'object' && link.sku) {
        skus.push(link.sku);
      } else if (typeof link === 'string') {
        skus.push(link);
      }
    }

    return skus;
  }

  /**
   * Update prices on all Magento target stores
   * @param {Object} priceData - Price data from source
   * @param {Object} options - Sync options
   * @returns {Object} Results for each store
   */
  async updateMagentoPrices(priceData, options = {}) {
    const targetStores = this.resolveMagentoTargetStores(options.targetMagentoStores);
    const storeResults = {};
    const errors = [];
    const warnings = [];

    logger.info('Updating Magento prices', {
      sku: priceData.parentSku,
      targetStores: targetStores.length > 0 ? targetStores : ['default']
    });

    // If no specific stores, update using default (non-scoped) endpoint
    if (targetStores.length === 0) {
      try {
        const result = await this.updateMagentoPricesForStore(priceData, null);
        storeResults['default'] = result;
      } catch (error) {
        storeResults['default'] = {
          success: false,
          error: error.message
        };
        errors.push({
          store: 'default',
          message: error.message
        });
      }
    } else {
      // Update for each specified store
      for (const storeCode of targetStores) {
        try {
          const result = await this.updateMagentoPricesForStore(priceData, storeCode);
          storeResults[storeCode] = result;
        } catch (error) {
          storeResults[storeCode] = {
            success: false,
            error: error.message
          };
          errors.push({
            store: storeCode,
            message: error.message
          });

          if (!config.errorHandling.continueOnError) {
            break;
          }
        }
      }
    }

    return { storeResults, errors, warnings };
  }

  /**
   * Update prices for a single Magento store
   */
  async updateMagentoPricesForStore(priceData, storeCode) {
    // Use scoped endpoint to update prices for specific store view
    // Non-scoped updates only affect global/default, not store-specific overrides
    const service = storeCode
      ? this.targetService.createScopedInstance(storeCode)
      : this.targetService;

    let variantsUpdated = 0;

    // Update variant (children) prices only - parent products do not have prices
    for (const child of priceData.children) {
      try {
        await service.updateProductPrice(child.sku, child.price);
        variantsUpdated++;
        logger.debug('Variant price updated', {
          sku: child.sku,
          price: child.price,
          storeCode: storeCode || 'default'
        });
      } catch (error) {
        logger.warn('Failed to update variant price', {
          sku: child.sku,
          storeCode: storeCode || 'default',
          error: error.message
        });
        // Continue with other variants even if one fails
      }
    }

    return {
      success: true,
      variantsUpdated
    };
  }

  /**
   * Update prices on all Shopify target stores
   * @param {Object} priceData - Price data from source
   * @param {Object} options - Sync options
   * @returns {Object} Results for each store
   */
  async updateShopifyPrices(priceData, options = {}) {
    const targetStores = this.resolveShopifyTargetStores(options.targetShopifyStores);
    const storeResults = {};
    const errors = [];
    const warnings = [];

    logger.info('Updating Shopify prices', {
      sku: priceData.parentSku,
      targetStores
    });

    for (const storeName of targetStores) {
      const storeConfig = this.shopifyStores[storeName];
      if (!storeConfig) {
        warnings.push({
          store: storeName,
          message: `Shopify store "${storeName}" not configured`
        });
        continue;
      }

      try {
        const result = await this.updateShopifyPricesForStore(priceData, storeName, storeConfig);
        storeResults[storeName] = result;
      } catch (error) {
        storeResults[storeName] = {
          success: false,
          error: error.message
        };
        errors.push({
          store: storeName,
          message: error.message
        });

        if (!config.errorHandling.continueOnError) {
          break;
        }
      }
    }

    return { storeResults, errors, warnings };
  }

  /**
   * Update prices for a single Shopify store
   */
  async updateShopifyPricesForStore(priceData, storeName, storeConfig) {
    const shopifyService = new ShopifyTargetService(
      storeConfig.url,
      storeConfig.token,
      { apiVersion: config.shopify.apiVersion }
    );

    const childSkus = priceData.children.map(c => c.sku);

    logger.info('Looking up Shopify variants by child SKUs', {
      parentSku: priceData.parentSku,
      childSkus,
      storeName
    });

    // Step 1: Look up all child variants by SKU directly
    const variants = await shopifyService.getVariantsBySkus(childSkus);

    // Log full variant data including compareAtPrice
    logger.info('Shopify variants retrieved with pricing data', {
      storeName,
      variants: variants.map(v => ({
        sku: v.sku,
        price: v.price,
        compareAtPrice: v.compareAtPrice,
        hasCompareAt: v.compareAtPrice !== null
      }))
    });

    if (variants.length === 0) {
      throw new Error(`No variants found in Shopify store "${storeName}" for SKUs: ${childSkus.slice(0, 5).join(', ')}...`);
    }

    // Step 2: Group variants by product ID (they may belong to different products)
    const variantsByProduct = new Map();
    for (const variant of variants) {
      const productId = variant.product.id;
      if (!variantsByProduct.has(productId)) {
        variantsByProduct.set(productId, []);
      }
      variantsByProduct.get(productId).push(variant);
    }

    // Step 3: Build variant prices array by matching Magento children to Shopify variants
    // If variant has compareAtPrice, update compareAtPrice only (preserve sale price)
    // If no compareAtPrice, update regular price
    const variantPrices = [];
    for (const child of priceData.children) {
      const variant = variants.find(v => v.sku === child.sku);
      if (variant) {
        const hasCompareAt = variant.compareAtPrice !== null;
        variantPrices.push({
          id: variant.id,
          price: child.price,
          productId: variant.product.id,
          updateCompareAt: hasCompareAt
        });

        if (hasCompareAt) {
          logger.debug('Variant has compareAtPrice, will update compareAtPrice only', {
            sku: child.sku,
            currentCompareAt: variant.compareAtPrice,
            currentPrice: variant.price,
            newCompareAt: child.price
          });
        }
      }
    }

    logger.info('SKU matching complete', {
      storeName,
      matchedCount: variantPrices.length,
      totalMagentoChildren: priceData.children.length,
      unmatchedMagentoSkus: priceData.children
        .filter(c => !variants.find(v => v.sku === c.sku))
        .map(c => c.sku)
    });

    if (variantPrices.length === 0) {
      throw new Error(`No matching variants found in Shopify store "${storeName}"`);
    }

    // Step 4: Update prices grouped by product ID
    let totalUpdated = 0;
    for (const [productId, productVariants] of variantsByProduct) {
      const pricesToUpdate = variantPrices
        .filter(vp => vp.productId === productId)
        .map(({ id, price, updateCompareAt }) => ({ id, price, updateCompareAt }));

      // Log what we're about to update
      logger.info('Preparing variant price update', {
        storeName,
        productId,
        updates: pricesToUpdate.map(p => ({
          id: p.id,
          newPrice: p.price,
          updateCompareAt: p.updateCompareAt,
          field: p.updateCompareAt ? 'compareAtPrice' : 'price'
        }))
      });

      if (pricesToUpdate.length > 0) {
        const updateResult = await shopifyService.updateVariantPrices(productId, pricesToUpdate);
        totalUpdated += updateResult.updatedCount;
      }
    }

    logger.info('Shopify prices updated', {
      sku: priceData.parentSku,
      storeName,
      variantsUpdated: totalUpdated
    });

    return {
      success: true,
      variantsUpdated: totalUpdated
    };
  }

  /**
   * Resolve target Magento stores from options or config defaults
   */
  resolveMagentoTargetStores(optionStores) {
    if (optionStores && Array.isArray(optionStores) && optionStores.length > 0) {
      const validation = validateStoreCodes(optionStores);
      if (!validation.valid) {
        logger.warn('Invalid Magento store codes provided', { errors: validation.errors });
        return [];
      }
      return normalizeStoreCodes(optionStores);
    }
    return normalizeStoreCodes(this.targetConfig.defaultStoreCodes);
  }

  /**
   * Resolve target Shopify stores from options or config defaults
   */
  resolveShopifyTargetStores(optionStores) {
    const availableStores = Object.keys(this.shopifyStores);

    if (optionStores && Array.isArray(optionStores) && optionStores.length > 0) {
      // Filter to only include configured stores
      return optionStores.filter(store =>
        availableStores.includes(store.toLowerCase())
      ).map(store => store.toLowerCase());
    }

    // Default to all configured Shopify stores
    return availableStores;
  }
}

module.exports = PriceSyncService;
