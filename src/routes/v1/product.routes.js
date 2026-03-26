const express = require('express');
const { body } = require('express-validator');
const { validateRequest } = require('../../middleware/validation.middleware');
const asyncHandler = require('../../utils/async-handler');
const auth = require('../../middleware/auth.middleware');
const permit = require('../../middleware/permission.middleware');
const { generateDescription } = require('../../controllers/product.controller');

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

module.exports = router;
