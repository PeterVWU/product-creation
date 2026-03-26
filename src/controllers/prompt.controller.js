const aiPromptRepo = require('../database/repositories/ai-prompt.repository');

const listActivePrompts = async (req, res, next) => {
  try {
    const prompts = await aiPromptRepo.findAllActive();
    res.json({ success: true, data: prompts });
  } catch (error) {
    next(error);
  }
};

const getActivePrompt = async (req, res, next) => {
  try {
    const { store } = req.params;
    const prompt = await aiPromptRepo.findActiveByStore(store);
    if (!prompt) {
      return res.status(404).json({ success: false, error: `No active prompt for store '${store}'` });
    }
    res.json({ success: true, data: prompt });
  } catch (error) {
    next(error);
  }
};

const getPromptHistory = async (req, res, next) => {
  try {
    const { store } = req.params;
    const history = await aiPromptRepo.getHistory(store);
    res.json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
};

const createPrompt = async (req, res, next) => {
  try {
    const { store } = req.params;
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, error: 'prompt is required in request body' });
    }
    const record = await aiPromptRepo.create({
      storeName: store,
      promptText: prompt,
      createdBy: req.apiKey?.id || null
    });
    res.status(201).json({ success: true, data: record });
  } catch (error) {
    next(error);
  }
};

module.exports = { listActivePrompts, getActivePrompt, getPromptHistory, createPrompt };
