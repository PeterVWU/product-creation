const express = require('express');
const migrationRoutes = require('./migration.routes');
const healthRoutes = require('./health.routes');
const syncRoutes = require('./sync.routes');
const productRoutes = require('./product.routes');

const router = express.Router();

router.use('/migrate', migrationRoutes);
router.use('/health', healthRoutes);
router.use('/sync', syncRoutes);
router.use('/products', productRoutes);

module.exports = router;
