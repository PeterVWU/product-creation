const express = require('express');
const { body } = require('express-validator');
const { validateRequest } = require('../../middleware/validation.middleware');
const asyncHandler = require('../../utils/async-handler');
const auth = require('../../middleware/auth.middleware');
const permit = require('../../middleware/permission.middleware');
const { syncPrices, updateProductFields } = require('../../controllers/sync.controller');

const router = express.Router();

router.post(
  '/prices',
  auth(), permit('sync:prices'),
  [
    body('sku').notEmpty().withMessage('SKU is required').trim(),
    body('options').optional().isObject().withMessage('Options must be an object'),
    body('options.targetMagentoStores')
      .optional()
      .isArray()
      .withMessage('targetMagentoStores must be an array'),
    body('options.targetMagentoStores.*')
      .optional()
      .isString()
      .notEmpty()
      .withMessage('Each Magento target store code must be a non-empty string'),
    body('options.targetShopifyStores')
      .optional()
      .isArray()
      .withMessage('targetShopifyStores must be an array'),
    body('options.targetShopifyStores.*')
      .optional()
      .isString()
      .notEmpty()
      .withMessage('Each Shopify target store name must be a non-empty string'),
    body('options.includeMagento')
      .optional()
      .isBoolean()
      .withMessage('includeMagento must be a boolean'),
    body('options.includeShopify')
      .optional()
      .isBoolean()
      .withMessage('includeShopify must be a boolean'),
    validateRequest
  ],
  asyncHandler(syncPrices)
);

router.post(
  '/product-fields',
  auth(), permit('sync:product-fields'),
  [
    body('sku').notEmpty().withMessage('SKU is required').trim(),
    body('options').optional().isObject().withMessage('Options must be an object'),
    body('options.targetMagentoStores')
      .optional()
      .isArray()
      .withMessage('targetMagentoStores must be an array'),
    body('options.targetMagentoStores.*')
      .optional()
      .isString()
      .notEmpty()
      .withMessage('Each Magento target store must be a non-empty string'),
    body('options.targetShopifyStores')
      .optional()
      .isArray()
      .withMessage('targetShopifyStores must be an array'),
    body('options.targetShopifyStores.*')
      .optional()
      .isString()
      .notEmpty()
      .withMessage('Each Shopify target store must be a non-empty string'),
    body('options.includeMagento')
      .optional()
      .isBoolean()
      .withMessage('includeMagento must be a boolean'),
    body('options.includeShopify')
      .optional()
      .isBoolean()
      .withMessage('includeShopify must be a boolean'),
    validateRequest
  ],
  asyncHandler(updateProductFields)
);

module.exports = router;
