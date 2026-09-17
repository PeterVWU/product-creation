const express = require('express');
const { body } = require('express-validator');
const { validateRequest } = require('../../middleware/validation.middleware');
const asyncHandler = require('../../utils/async-handler');
const auth = require('../../middleware/auth.middleware');
const permit = require('../../middleware/permission.middleware');
const {
  syncPrices,
  updateProductFields,
  deduplicateProductImages
} = require('../../controllers/sync.controller');

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

router.post(
  '/product-images/deduplicate',
  auth(), permit('sync:product-fields'),
  [
    body('sku').notEmpty().withMessage('SKU is required').trim(),
    body('options').optional().isObject().withMessage('Options must be an object'),
    body('options.targetMagentoStores')
      .optional()
      .isArray({ min: 1 })
      .withMessage('targetMagentoStores must be a non-empty array when provided'),
    body('options.targetMagentoStores.*')
      .optional()
      .isString()
      .notEmpty()
      .withMessage('Each Magento target store must be a non-empty string'),
    body('options.targetShopifyStores')
      .optional()
      .isArray({ min: 1 })
      .withMessage('targetShopifyStores must be a non-empty array when provided'),
    body('options.targetShopifyStores.*')
      .optional()
      .isString()
      .notEmpty()
      .withMessage('Each Shopify target store must be a non-empty string'),
    body('options.shopifyHandles')
      .optional()
      .isObject()
      .withMessage('shopifyHandles must be an object keyed by store alias'),
    body('options.dryRun')
      .optional()
      .isBoolean()
      .withMessage('dryRun must be a boolean'),
    validateRequest
  ],
  asyncHandler(deduplicateProductImages)
);

module.exports = router;
