const db = require('../connection');

const TABLE = 'api_keys';

module.exports = {
  async create({ name, keyPrefix, keyHash, roleId }) {
    const [row] = await db(TABLE)
      .insert({
        name,
        key_prefix: keyPrefix,
        key_hash: keyHash,
        role_id: roleId
      })
      .returning(['id', 'name', 'key_prefix', 'role_id', 'is_active', 'created_at']);
    return row;
  },

  async findByPrefix(prefix) {
    const key = await db(TABLE)
      .where({ key_prefix: prefix, is_active: true })
      .first();
    return key || null;
  },

  async findById(id) {
    const key = await db(TABLE)
      .select('id', 'name', 'key_prefix', 'role_id', 'is_active', 'created_at', 'updated_at')
      .where({ id })
      .first();
    return key || null;
  },

  async findAll() {
    return db(TABLE)
      .select('id', 'name', 'key_prefix', 'role_id', 'is_active', 'created_at', 'updated_at')
      .orderBy('created_at', 'desc');
  },

  async update(id, fields) {
    const allowedFields = ['name', 'role_id', 'is_active'];
    const updateData = {};
    for (const field of allowedFields) {
      if (fields[field] !== undefined) {
        updateData[field] = fields[field];
      }
    }
    const [row] = await db(TABLE)
      .where({ id })
      .update(updateData)
      .returning(['id', 'name', 'key_prefix', 'role_id', 'is_active', 'created_at', 'updated_at']);
    return row;
  }
};
