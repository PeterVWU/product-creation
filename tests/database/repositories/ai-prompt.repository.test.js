const db = require('../../../src/database/connection');
const aiPromptRepo = require('../../../src/database/repositories/ai-prompt.repository');

beforeAll(async () => {
  await db.migrate.latest();
  await db.seed.run();
});

afterAll(async () => {
  await db('ai_prompts').del();
  await db.destroy();
});

describe('ai-prompt.repository', () => {
  test('create inserts a prompt with version 1', async () => {
    const prompt = await aiPromptRepo.create({
      storeName: 'ejuices',
      promptText: 'Write in a casual tone',
      createdBy: null
    });
    expect(prompt.store_name).toBe('ejuices');
    expect(prompt.version).toBe(1);
    expect(prompt.is_active).toBe(true);
  });

  test('create second prompt deactivates first, increments version', async () => {
    const prompt2 = await aiPromptRepo.create({
      storeName: 'ejuices',
      promptText: 'Write in a formal tone',
      createdBy: null
    });
    expect(prompt2.version).toBe(2);
    expect(prompt2.is_active).toBe(true);

    const all = await db('ai_prompts').where({ store_name: 'ejuices' });
    const active = all.filter(p => p.is_active);
    expect(active).toHaveLength(1);
    expect(active[0].version).toBe(2);
  });

  test('findActiveByStore returns the active prompt', async () => {
    const prompt = await aiPromptRepo.findActiveByStore('ejuices');
    expect(prompt).toBeTruthy();
    expect(prompt.is_active).toBe(true);
    expect(prompt.prompt_text).toBe('Write in a formal tone');
  });

  test('findActiveByStore returns null for unknown store', async () => {
    const prompt = await aiPromptRepo.findActiveByStore('nonexistent');
    expect(prompt).toBeNull();
  });

  test('findAllActive returns one prompt per store', async () => {
    await aiPromptRepo.create({
      storeName: 'misthub',
      promptText: 'Write for misthub',
      createdBy: null
    });
    const all = await aiPromptRepo.findAllActive();
    expect(all.length).toBeGreaterThanOrEqual(2);
    const stores = all.map(p => p.store_name);
    expect(stores).toContain('ejuices');
    expect(stores).toContain('misthub');
  });

  test('getHistory returns all versions for a store', async () => {
    const history = await aiPromptRepo.getHistory('ejuices');
    expect(history).toHaveLength(2);
    expect(history[0].version).toBe(2);
    expect(history[1].version).toBe(1);
  });
});
