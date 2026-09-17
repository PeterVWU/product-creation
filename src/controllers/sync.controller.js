const logger = require('../config/logger');
const PriceSyncService = require('../services/sync/price-sync.service');
const { ValidationError } = require('../utils/error-handler');
const ProductUpdateService = require('../services/sync/product-update.service');
const auditService = require('../services/audit/audit.service');
const DuplicateImageRepairService = require('../services/sync/duplicate-image-repair.service');

const priceSyncService = new PriceSyncService();
const productUpdateService = new ProductUpdateService();
const duplicateImageRepairService = new DuplicateImageRepairService();

const syncPrices = async (req, res, next) => {
  try {
    const startTime = Date.now();
    const { sku, options = {} } = req.body;

    if (!sku) {
      throw new ValidationError('SKU is required', [{ field: 'sku', message: 'SKU cannot be empty' }]);
    }

    logger.info('Price sync request received', { sku, options });

    const result = await priceSyncService.syncPrices(sku, options);

    await auditService.logAction({
      apiKeyId: req.apiKey?.id,
      action: 'product:prices_synced',
      resourceType: 'product',
      resourceId: sku,
      metadata: { targetMagentoStores: options.targetMagentoStores, targetShopifyStores: options.targetShopifyStores, success: result.success },
      status: result.success ? 'success' : 'partial',
      durationMs: Date.now() - startTime
    });

    const statusCode = result.success ? 200 : 207;

    res.status(statusCode).json(result);
  } catch (error) {
    next(error);
  }
};

const updateProductFields = async (req, res, next) => {
  try {
    const startTime = Date.now();
    const { sku, options = {} } = req.body;

    if (!sku) {
      throw new ValidationError('SKU is required', [{ field: 'sku', message: 'SKU cannot be empty' }]);
    }

    logger.info('Product fields update request received', { sku, options });

    const result = await productUpdateService.updateProductFields(sku, options);

    await auditService.logAction({
      apiKeyId: req.apiKey?.id,
      action: 'product:fields_updated',
      resourceType: 'product',
      resourceId: sku,
      metadata: { targetMagentoStores: options.targetMagentoStores, targetShopifyStores: options.targetShopifyStores, success: result.success },
      status: result.success ? 'success' : 'partial',
      durationMs: Date.now() - startTime
    });

    const statusCode = result.success ? 200 : 207;

    res.status(statusCode).json(result);
  } catch (error) {
    next(error);
  }
};

const deduplicateProductImages = async (req, res, next) => {
  try {
    const startTime = Date.now();
    const { sku, options = {} } = req.body;

    if (!sku) {
      throw new ValidationError('SKU is required', [{ field: 'sku', message: 'SKU cannot be empty' }]);
    }

    logger.info('Duplicate product image repair request received', { sku, options });
    const result = await duplicateImageRepairService.repair(sku, options);

    await auditService.logAction({
      apiKeyId: req.apiKey?.id,
      action: 'product:images_deduplicated',
      resourceType: 'product',
      resourceId: sku,
      metadata: {
        targetMagentoStores: options.targetMagentoStores,
        targetShopifyStores: options.targetShopifyStores,
        dryRun: result.dryRun,
        success: result.success
      },
      status: result.success ? 'success' : 'partial',
      durationMs: Date.now() - startTime
    });

    res.status(result.success ? 200 : 207).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  syncPrices,
  updateProductFields,
  deduplicateProductImages
};
