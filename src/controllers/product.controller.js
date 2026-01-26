const logger = require('../config/logger');
const DescriptionService = require('../services/description.service');
const { ValidationError } = require('../utils/error-handler');

const descriptionService = new DescriptionService();

const generateDescription = async (req, res, next) => {
  try {
    const { sku } = req.body;

    if (!sku) {
      throw new ValidationError('SKU is required', [{ field: 'sku', message: 'SKU cannot be empty' }]);
    }

    logger.info('Generate description request received', { sku });

    const result = await descriptionService.generateAndUpdateDescription(sku);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  generateDescription
};
