const express = require('express');
const migrationRoutes = require('./migration.routes');
const healthRoutes = require('./health.routes');
const syncRoutes = require('./sync.routes');
const productRoutes = require('./product.routes');
const keyRoutes = require('./key.routes');
const promptRoutes = require('./prompt.routes');
const auditRoutes = require('./audit.routes');

const router = express.Router();

router.use('/migrate', migrationRoutes);
router.use('/health', healthRoutes);
router.use('/sync', syncRoutes);
router.use('/products', productRoutes);
router.use('/keys', keyRoutes);
router.use('/prompts', promptRoutes);
router.use('/audit', auditRoutes);

module.exports = router;
