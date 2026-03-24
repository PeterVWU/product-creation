const express = require('express');
const { body } = require('express-validator');
const { validateRequest } = require('../../middleware/validation.middleware');
const asyncHandler = require('../../utils/async-handler');
const {
  migrateProduct,
  migrateProductsBatch,
  migrateProductToShopify
} = require('../../controllers/migration.controller');

const router = express.Router();

router.post(
  '/product',
  [
    body('sku').notEmpty().withMessage('SKU is required').trim(),
    body('options').optional().isObject().withMessage('Options must be an object'),
    body('options.targetStores')
      .optional()
      .isArray()
      .withMessage('targetStores must be an array'),
    body('options.targetStores.*')
      .optional()
      .isString()
      .notEmpty()
      .withMessage('Each target store code must be a non-empty string'),
    body('options.storePrompts')
      .optional()
      .isObject()
      .withMessage('storePrompts must be an object'),
    body('options.storePrompts.*')
      .optional()
      .isObject()
      .withMessage('Each storePrompts entry must be an object'),
    body('options.storePrompts.*.prompt')
      .isString()
      .notEmpty()
      .withMessage('Each storePrompts entry must have a non-empty prompt string'),
    body('options.storePrompts')
      .optional()
      .custom((storePrompts, { req }) => {
        if (!storePrompts) return true;
        const targetStores = req.body.options?.targetMagentoStores || req.body.options?.targetStores || [];
        const invalidKeys = Object.keys(storePrompts).filter(key => !targetStores.includes(key));
        if (invalidKeys.length > 0) {
          throw new Error(`storePrompts contains stores not in targetMagentoStores: ${invalidKeys.join(', ')}`);
        }
        return true;
      }),
    validateRequest
  ],
  asyncHandler(migrateProduct)
);

router.post(
  '/products/batch',
  [
    body('skus').isArray({ min: 1 }).withMessage('SKUs must be a non-empty array'),
    body('skus.*').notEmpty().withMessage('Each SKU must be a non-empty string').trim(),
    body('options').optional().isObject().withMessage('Options must be an object'),
    body('options.targetStores')
      .optional()
      .isArray()
      .withMessage('targetStores must be an array'),
    body('options.targetStores.*')
      .optional()
      .isString()
      .notEmpty()
      .withMessage('Each target store code must be a non-empty string'),
    body('options.storePrompts')
      .optional()
      .isObject()
      .withMessage('storePrompts must be an object'),
    body('options.storePrompts.*')
      .optional()
      .isObject()
      .withMessage('Each storePrompts entry must be an object'),
    body('options.storePrompts.*.prompt')
      .isString()
      .notEmpty()
      .withMessage('Each storePrompts entry must have a non-empty prompt string'),
    body('options.storePrompts')
      .optional()
      .custom((storePrompts, { req }) => {
        if (!storePrompts) return true;
        const targetStores = req.body.options?.targetMagentoStores || req.body.options?.targetStores || [];
        const invalidKeys = Object.keys(storePrompts).filter(key => !targetStores.includes(key));
        if (invalidKeys.length > 0) {
          throw new Error(`storePrompts contains stores not in targetMagentoStores: ${invalidKeys.join(', ')}`);
        }
        return true;
      }),
    validateRequest
  ],
  asyncHandler(migrateProductsBatch)
);

router.post(
  '/product/shopify',
  [
    body('sku').notEmpty().withMessage('SKU is required').trim(),
    body('options').optional().isObject().withMessage('Options must be an object'),
    body('options.includeImages')
      .optional()
      .isBoolean()
      .withMessage('includeImages must be a boolean'),
    body('options.shopifyStore')
      .optional()
      .isString()
      .withMessage('shopifyStore must be a string'),
    validateRequest
  ],
  asyncHandler(migrateProductToShopify)
);

module.exports = router;
