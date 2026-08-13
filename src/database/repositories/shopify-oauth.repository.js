const db = require('../connection');
const TABLE = 'shopify_oauth_attempts';
module.exports = {
  async create(data) { const [row] = await db(TABLE).insert(data).returning('*'); return row; },
  async start(ticketHash, stateHash) {
    return db.transaction(async trx => {
      const row = await trx(TABLE).where({ ticket_hash: ticketHash }).forUpdate().first();
      if (!row || row.started_at || row.used_at || new Date(row.expires_at) <= new Date()) return null;
      const [updated] = await trx(TABLE).where({ id: row.id }).update({ state_hash: stateHash, started_at: trx.fn.now() }).returning('*'); return updated;
    });
  },
  async consume(stateHash) {
    return db.transaction(async trx => {
      const row = await trx(TABLE).where({ state_hash: stateHash }).forUpdate().first();
      if (!row || row.used_at || new Date(row.expires_at) <= new Date()) return null;
      const [updated] = await trx(TABLE).where({ id: row.id }).update({ used_at: trx.fn.now() }).returning('*'); return updated;
    });
  }
};
