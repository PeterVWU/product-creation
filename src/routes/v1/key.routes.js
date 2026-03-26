const express = require('express');
const asyncHandler = require('../../utils/async-handler');
const auth = require('../../middleware/auth.middleware');
const permit = require('../../middleware/permission.middleware');
const { createKey, listKeys, updateKey, deactivateKey } = require('../../controllers/key.controller');

const router = express.Router();

router.use(auth(), permit('*'));

router.post('/', asyncHandler(createKey));
router.get('/', asyncHandler(listKeys));
router.patch('/:id', asyncHandler(updateKey));
router.delete('/:id', asyncHandler(deactivateKey));

module.exports = router;
