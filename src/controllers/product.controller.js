const logger = require('../config/logger');
const DescriptionService = require('../services/description.service');
const SourceService = require('../services/magento/source.service');
const deletionService = require('../services/deletion/product-deletion.service');
const auditService = require('../services/audit/audit.service');
const config = require('../config');
const { ValidationError } = require('../utils/error-handler');

let descriptionService = null;

const getDescriptionService = () => {
  if (!descriptionService) {
    descriptionService = new DescriptionService();
  }
  return descriptionService;
};

const generateDescription = async (req, res, next) => {
  try {
    const { sku } = req.body;

    if (!sku) {
      throw new ValidationError('SKU is required', [{ field: 'sku', message: 'SKU cannot be empty' }]);
    }

    logger.info('Generate description request received', { sku });

    const result = await getDescriptionService().generateAndUpdateDescription(sku);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

const deleteProduct = async (req, res, next) => {
  try {
    const { sku } = req.params;
    const { platform, storeName } = req.query;

    const startTime = Date.now();
    const result = await deletionService.deleteProduct({ sku, platform, storeName });
    const durationMs = Date.now() - startTime;

    await auditService.logAction({
      apiKeyId: req.apiKey?.id,
      action: 'product:delete',
      resourceType: 'product',
      resourceId: sku,
      metadata: { platform, storeName, deletedSkus: result.deletedSkus, success: result.success },
      status: result.success ? 'success' : 'partial_failure',
      durationMs
    });

    if (!result.success) {
      return res.status(500).json({ success: false, data: result });
    }

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    // Audit failed attempts
    if (req.apiKey) {
      await auditService.logAction({
        apiKeyId: req.apiKey.id,
        action: 'product:delete',
        resourceType: 'product',
        resourceId: req.params.sku,
        metadata: { platform: req.query.platform, storeName: req.query.storeName, error: error.message },
        status: 'error',
        durationMs: 0
      }).catch(() => {}); // Don't let audit failure mask the original error
    }
    next(error);
  }
};

const findParentProduct = async (req, res, next) => {
  try {
    const { sku } = req.params;

    logger.info('Find parent product request received', { sku });

    const sourceService = new SourceService(
      config.source.baseUrl,
      config.source.token,
      config.api
    );

    const result = await sourceService.findParentProduct(sku);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  generateDescription,
  deleteProduct,
  findParentProduct
};
