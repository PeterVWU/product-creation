const { body } = require('express-validator');
const { validateRequest } = require('./validation.middleware');

module.exports = () => [
  body('sourceProductId').isString().matches(/^(?:gid:\/\/shopify\/Product\/)?[1-9]\d*$/)
    .withMessage('sourceProductId must be a Shopify product GID or numeric ID string'),
  body('options').isObject().withMessage('options is required'),
  body('options.targetShopifyStores').isArray({ min: 1, max: 50 }).withMessage('Select at least one destination store'),
  body('options.targetShopifyStores.*').isString().trim().notEmpty().isLength({ max: 64 }),
  body('options.includeImages').optional().isBoolean({ strict: true }),
  body('options.productStatus').optional().isIn(['DRAFT', 'ACTIVE', 'ARCHIVED']),
  validateRequest
];
