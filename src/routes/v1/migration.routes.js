const express = require('express');
const { body } = require('express-validator');
const { validateRequest } = require('../../middleware/validation.middleware');
const asyncHandler = require('../../utils/async-handler');
const {
  migrateProduct,
  migrateProductsBatch
} = require('../../controllers/migration.controller');

const router = express.Router();

router.post(
  '/product',
  [
    body('sku').notEmpty().withMessage('SKU is required').trim(),
    body('options').optional().isObject().withMessage('Options must be an object'),
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
    validateRequest
  ],
  asyncHandler(migrateProductsBatch)
);

module.exports = router;
