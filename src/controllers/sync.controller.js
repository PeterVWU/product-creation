const logger = require('../config/logger');
const PriceSyncService = require('../services/sync/price-sync.service');
const { ValidationError } = require('../utils/error-handler');
const ProductUpdateService = require('../services/sync/product-update.service');

const priceSyncService = new PriceSyncService();
const productUpdateService = new ProductUpdateService();

const syncPrices = async (req, res, next) => {
  try {
    const { sku, options = {} } = req.body;

    if (!sku) {
      throw new ValidationError('SKU is required', [{ field: 'sku', message: 'SKU cannot be empty' }]);
    }

    logger.info('Price sync request received', { sku, options });

    const result = await priceSyncService.syncPrices(sku, options);

    const statusCode = result.success ? 200 : 207;

    res.status(statusCode).json(result);
  } catch (error) {
    next(error);
  }
};

const updateProductFields = async (req, res, next) => {
  try {
    const { sku, options = {} } = req.body;

    if (!sku) {
      throw new ValidationError('SKU is required', [{ field: 'sku', message: 'SKU cannot be empty' }]);
    }

    logger.info('Product fields update request received', { sku, options });

    const result = await productUpdateService.updateProductFields(sku, options);

    const statusCode = result.success ? 200 : 207;

    res.status(statusCode).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  syncPrices,
  updateProductFields
};
