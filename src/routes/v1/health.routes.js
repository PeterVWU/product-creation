const express = require('express');
const asyncHandler = require('../../utils/async-handler');
const {
  healthCheck,
  magentoHealthCheck
} = require('../../controllers/health.controller');

const router = express.Router();

router.get('/', asyncHandler(healthCheck));
router.get('/magento', asyncHandler(magentoHealthCheck));

module.exports = router;
