const db = require('../connection');

const TABLE = 'ai_prompts';

module.exports = {
  async create({ storeName, promptText, createdBy }) {
    return db.transaction(async (trx) => {
      const current = await trx(TABLE)
        .where({ store_name: storeName })
        .max('version as max_version')
        .first();

      const nextVersion = (current?.max_version || 0) + 1;

      await trx(TABLE)
        .where({ store_name: storeName, is_active: true })
        .update({ is_active: false, updated_at: trx.fn.now() });

      const [row] = await trx(TABLE)
        .insert({
          store_name: storeName,
          prompt_text: promptText,
          version: nextVersion,
          is_active: true,
          created_by: createdBy
        })
        .returning('*');

      return row;
    });
  },

  async findActiveByStore(storeName) {
    const prompt = await db(TABLE)
      .where({ store_name: storeName, is_active: true })
      .first();
    return prompt || null;
  },

  async findAllActive() {
    return db(TABLE)
      .where({ is_active: true })
      .orderBy('store_name');
  },

  async getHistory(storeName) {
    return db(TABLE)
      .where({ store_name: storeName })
      .orderBy('version', 'desc');
  }
};
