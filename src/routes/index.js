const express = require('express');
const v1Routes = require('./v1');

const router = express.Router();

router.use('/v1', v1Routes);

router.get('/', (req, res) => {
  res.json({
    message: 'Magento Product Migration API',
    version: '1.0.0',
    endpoints: {
      health: '/api/v1/health',
      magentoHealth: '/api/v1/health/magento',
      migrateProduct: 'POST /api/v1/migrate/product',
      migrateBatch: 'POST /api/v1/migrate/products/batch',
      generateDescription: 'POST /api/v1/products/generate-description'
    }
  });
});

module.exports = router;
