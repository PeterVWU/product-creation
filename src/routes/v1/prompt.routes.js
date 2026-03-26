const express = require('express');
const asyncHandler = require('../../utils/async-handler');
const auth = require('../../middleware/auth.middleware');
const permit = require('../../middleware/permission.middleware');
const {
  listActivePrompts,
  getActivePrompt,
  getPromptHistory,
  createPrompt
} = require('../../controllers/prompt.controller');

const router = express.Router();

router.use(auth());

router.get('/', permit('ai:prompts:read'), asyncHandler(listActivePrompts));
router.get('/:store', permit('ai:prompts:read'), asyncHandler(getActivePrompt));
router.get('/:store/history', permit('ai:prompts:read'), asyncHandler(getPromptHistory));
router.post('/:store', permit('ai:prompts:write'), asyncHandler(createPrompt));

module.exports = router;
