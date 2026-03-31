const express = require('express');
const { body, param, query } = require('express-validator');
const { validateRequest } = require('../../middleware/validation.middleware');
const asyncHandler = require('../../utils/async-handler');
const auth = require('../../middleware/auth.middleware');
const permit = require('../../middleware/permission.middleware');
const { generateDescription, deleteProduct, findParentProduct } = require('../../controllers/product.controller');

const router = express.Router();

router.post(
  '/generate-description',
  auth(), permit('product:read'),
  [
    body('sku').notEmpty().withMessage('SKU is required').trim(),
    validateRequest
  ],
  asyncHandler(generateDescription)
);

router.delete(
  '/:sku',
  auth(), permit('product:delete'),
  [
    param('sku').notEmpty().withMessage('SKU is required').trim(),
    query('platform').isIn(['source-magento', 'target-magento', 'target-shopify']).withMessage('platform must be one of: source-magento, target-magento, target-shopify'),
    query('storeName').optional().trim(),
    validateRequest
  ],
  asyncHandler(deleteProduct)
);

router.get(
  '/:sku/parent',
  auth(), permit('product:read'),
  [
    param('sku').notEmpty().withMessage('SKU is required').trim(),
    validateRequest
  ],
  asyncHandler(findParentProduct)
);

module.exports = router;
