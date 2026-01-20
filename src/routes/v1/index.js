const express = require('express');
const migrationRoutes = require('./migration.routes');
const healthRoutes = require('./health.routes');
const syncRoutes = require('./sync.routes');

const router = express.Router();

router.use('/migrate', migrationRoutes);
router.use('/health', healthRoutes);
router.use('/sync', syncRoutes);

module.exports = router;
