const express = require('express');
const migrationRoutes = require('./migration.routes');
const healthRoutes = require('./health.routes');

const router = express.Router();

router.use('/migrate', migrationRoutes);
router.use('/health', healthRoutes);

module.exports = router;
