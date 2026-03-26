const express = require('express');
const asyncHandler = require('../../utils/async-handler');
const auth = require('../../middleware/auth.middleware');
const permit = require('../../middleware/permission.middleware');
const { queryAuditLogs } = require('../../controllers/audit.controller');

const router = express.Router();

router.use(auth());
router.get('/', permit('audit:read'), asyncHandler(queryAuditLogs));

module.exports = router;
