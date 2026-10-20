const db = require('../connection');
const TABLE = 'shopify_product_mappings';

module.exports = {
  // Serialize requests for the same source/destination across API processes.
  // The caller catches remote failures inside this transaction so checkpoints survive.
  async withMapping(key, handle, fn) {
    return db.transaction(async trx => {
      await trx(TABLE).insert({ ...key, creation_handle: handle }).onConflict([
        'source_shop', 'source_product_id', 'target_shop'
      ]).ignore();
      const row = await trx(TABLE).where(key).forUpdate().first();
      const save = async values => {
        const [updated] = await trx(TABLE).where({ id: row.id })
          .update({ ...values, updated_at: trx.fn.now() }).returning('*');
        Object.assign(row, updated);
      };
      return fn(row, save);
    });
  }
};
