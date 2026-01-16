const logger = require('../config/logger');
const OrchestratorService = require('../services/migration/orchestrator.service');
const { ValidationError } = require('../utils/error-handler');

const orchestrator = new OrchestratorService();

const migrateProduct = async (req, res, next) => {
  try {
    const { sku, options = {} } = req.body;

    if (!sku) {
      throw new ValidationError('SKU is required', [{ field: 'sku', message: 'SKU cannot be empty' }]);
    }

    logger.info('Migration request received', { sku, options });

    const result = await orchestrator.migrateProduct(sku, options);

    const statusCode = result.success ? 200 : 207;

    res.status(statusCode).json(result);
  } catch (error) {
    next(error);
  }
};

const migrateProductsBatch = async (req, res, next) => {
  try {
    const { skus, options = {} } = req.body;

    if (!skus || !Array.isArray(skus) || skus.length === 0) {
      throw new ValidationError('SKUs array is required', [
        { field: 'skus', message: 'SKUs must be a non-empty array' }
      ]);
    }

    logger.info('Batch migration request received', { skuCount: skus.length, options });

    const batchStartTime = Date.now();
    const results = [];

    for (const sku of skus) {
      try {
        logger.info('Processing SKU in batch', { sku });
        const result = await orchestrator.migrateProduct(sku, options);
        results.push(result);
      } catch (error) {
        logger.error('Failed to migrate SKU in batch', { sku, error: error.message });
        results.push({
          sku,
          success: false,
          errors: [{ message: error.message }]
        });
      }
    }

    const totalDuration = Date.now() - batchStartTime;
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.filter(r => !r.success).length;

    const totalErrors = results.reduce((sum, r) => sum + (r.errors?.length || 0), 0);
    const totalWarnings = results.reduce((sum, r) => sum + (r.warnings?.length || 0), 0);

    logger.info('Batch migration completed', {
      total: skus.length,
      success: successCount,
      failed: failureCount,
      duration: `${totalDuration}ms`
    });

    res.status(200).json({
      success: successCount === skus.length,
      totalProducts: skus.length,
      successCount,
      failureCount,
      results,
      summary: {
        totalDuration,
        totalErrors,
        totalWarnings
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  migrateProduct,
  migrateProductsBatch
};
