const express = require('express');
const asyncHandler = require('../../utils/async-handler');
const {
  healthCheck,
  magentoHealthCheck,
  shopifyHealthCheck
} = require('../../controllers/health.controller');

const router = express.Router();

router.get('/', asyncHandler(healthCheck));
router.get('/magento', asyncHandler(magentoHealthCheck));
router.get('/shopify', asyncHandler(shopifyHealthCheck));

module.exports = router;
