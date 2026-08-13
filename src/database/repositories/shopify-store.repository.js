const db = require('../connection');
const TABLE = 'shopify_stores';

module.exports = {
  findByAlias(alias, trx = db) { return trx(TABLE).where({ alias }).first(); },
  findByDomain(shopDomain, trx = db) { return trx(TABLE).where({ shop_domain: shopDomain }).first(); },
  list() { return db(TABLE).orderBy('alias'); },
  async createPending({ alias, shopDomain }, trx = db) {
    const [row] = await trx(TABLE).insert({ alias, shop_domain: shopDomain, status: 'pending' }).returning('*'); return row;
  },
  async update(id, values, trx = db) {
    const [row] = await trx(TABLE).where({ id }).update({ ...values, updated_at: trx.fn.now() }).returning('*'); return row;
  },
  transaction(fn) { return db.transaction(fn); },
  async withLockedStore(id, fn) { return db.transaction(async trx => fn(await trx(TABLE).where({ id }).forUpdate().first(), trx)); },
  dueForMaintenance(before) { return db(TABLE).whereIn('status', ['active']).andWhere(q => q.where('access_token_expires_at', '<=', before).orWhere('refresh_token_expires_at', '<=', before)); },
  async markUninstalled(shopDomain, webhookId) {
    return db.transaction(async trx => {
      const inserted = await trx('shopify_uninstall_webhooks').insert({ webhook_id: webhookId, shop_domain: shopDomain }).onConflict('webhook_id').ignore().returning('webhook_id');
      if (!inserted.length) return { duplicate: true };
      const [store] = await trx(TABLE).where({ shop_domain: shopDomain }).update({ status: 'uninstalled', access_token_envelope: null, refresh_token_envelope: null, access_token_expires_at: null, refresh_token_expires_at: null, uninstalled_at: trx.fn.now(), updated_at: trx.fn.now() }).returning('*');
      if (store) await trx('audit_logs').insert({ action: 'shopify.uninstalled', resource_type: 'shopify_store', resource_id: store.id, metadata: JSON.stringify({ alias: store.alias, shopDomain, webhookId }), status: 'success' });
      return { duplicate: false, store };
    });
  }
};
