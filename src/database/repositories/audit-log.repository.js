const db = require('../connection');

const TABLE = 'audit_logs';

module.exports = {
  async create({ apiKeyId, action, resourceType, resourceId, metadata, status, durationMs }) {
    const [row] = await db(TABLE)
      .insert({
        api_key_id: apiKeyId || null,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        metadata: JSON.stringify(metadata || {}),
        status,
        duration_ms: durationMs
      })
      .returning('*');
    return row;
  },

  async query({ action, apiKeyId, startDate, endDate, limit = 50, offset = 0 } = {}) {
    let query = db(TABLE);
    let countQuery = db(TABLE);

    if (action) {
      query = query.where('action', action);
      countQuery = countQuery.where('action', action);
    }
    if (apiKeyId) {
      query = query.where('api_key_id', apiKeyId);
      countQuery = countQuery.where('api_key_id', apiKeyId);
    }
    if (startDate) {
      query = query.where('created_at', '>=', startDate);
      countQuery = countQuery.where('created_at', '>=', startDate);
    }
    if (endDate) {
      query = query.where('created_at', '<=', endDate);
      countQuery = countQuery.where('created_at', '<=', endDate);
    }

    const [{ count }] = await countQuery.count('id as count');

    const data = await query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      data,
      total: parseInt(count, 10),
      limit,
      offset
    };
  }
};
