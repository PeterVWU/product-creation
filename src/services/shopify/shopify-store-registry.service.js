const axios = require('axios');
const config = require('../../config');
const storeRepo = require('../../database/repositories/shopify-store.repository');
const audit = require('../audit/audit.service');
const ShopifyTargetService = require('./shopify-target.service');
const { cryptoService } = require('./shopify-oauth.service');

class ShopifyStoreRegistry {
  async list() {
    const rows = config.shopify.oauth?.enabled ? await storeRepo.list() : []; const aliases = new Set(rows.map(r => r.alias));
    const database = rows.map(r => ({ alias: r.alias, domain: r.shop_domain, source: 'database', status: r.status, scopes: r.scopes || [], accessTokenExpiresAt: r.access_token_expires_at, refreshTokenExpiresAt: r.refresh_token_expires_at, verifiedAt: r.verified_at, uninstalledAt: r.uninstalled_at, lastError: r.last_error }));
    const environment = Object.entries(config.shopify.stores).filter(([alias]) => !aliases.has(alias)).map(([alias, value]) => ({ alias, domain: value.url, source: 'environment', status: 'active', scopes: null, accessTokenExpiresAt: null, refreshTokenExpiresAt: null, verifiedAt: null, uninstalledAt: null, lastError: null }));
    return [...database, ...environment].sort((a, b) => a.alias.localeCompare(b.alias));
  }

  async resolve(alias) {
    alias = (alias || config.shopify.defaultStore || '').toLowerCase();
    const row = alias && config.shopify.oauth?.enabled ? await storeRepo.findByAlias(alias) : null;
    if (row) {
      if (row.status !== 'active' || !row.access_token_envelope) throw Object.assign(new Error(`Shopify store '${alias}' requires reconnection (status: ${row.status})`), { statusCode: 409 });
      return { alias, domain: row.shop_domain, source: 'database', row };
    }
    const env = config.shopify.stores[alias];
    if (env) return { alias, domain: env.url, source: 'environment', token: env.token };
    const available = (await this.list()).map(s => s.alias);
    throw Object.assign(new Error(`Shopify store '${alias || 'default'}' not configured. Available stores: ${available.join(', ') || 'none'}`), { statusCode: 400 });
  }

  async tokenFor(resolved, forceRefresh = false) {
    if (resolved.source === 'environment') return resolved.token;
    const expires = new Date(resolved.row.access_token_expires_at).getTime();
    if (!forceRefresh && expires > Date.now() + 5 * 60 * 1000) return cryptoService.decrypt(resolved.row.access_token_envelope, resolved.row.id, 'access');
    return this.refresh(resolved.row.id, forceRefresh);
  }

  async refresh(storeId, force = false) {
    return storeRepo.withLockedStore(storeId, async (row, trx) => {
      if (!row || row.status !== 'active' || !row.refresh_token_envelope) throw Object.assign(new Error('Shopify store requires reauthorization'), { statusCode: 409 });
      if (!force && new Date(row.access_token_expires_at).getTime() > Date.now() + 5 * 60 * 1000) return cryptoService.decrypt(row.access_token_envelope, row.id, 'access');
      try {
        const refreshToken = cryptoService.decrypt(row.refresh_token_envelope, row.id, 'refresh');
        const response = await axios.post(`https://${row.shop_domain}/admin/oauth/access_token`, { client_id: config.shopify.oauth.clientId, client_secret: config.shopify.oauth.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }, { timeout: config.api.timeout });
        const tokens = response.data; const now = Date.now();
        await storeRepo.update(row.id, { access_token_envelope: cryptoService.encrypt(tokens.access_token, row.id, 'access'), refresh_token_envelope: cryptoService.encrypt(tokens.refresh_token, row.id, 'refresh'), access_token_expires_at: new Date(now + Number(tokens.expires_in) * 1000), refresh_token_expires_at: new Date(now + Number(tokens.refresh_token_expires_in || 7776000) * 1000), last_error: null }, trx);
        await audit.logAction({ action: 'shopify.credential.refreshed', resourceType: 'shopify_store', resourceId: row.id, metadata: { alias: row.alias }, status: 'success' });
        return tokens.access_token;
      } catch (error) {
        if ([400, 401].includes(error.response?.status)) {
          await storeRepo.update(row.id, { status: 'reauthorization_required', access_token_envelope: null, refresh_token_envelope: null, access_token_expires_at: null, refresh_token_expires_at: null, last_error: 'Refresh credentials are invalid or expired' }, trx);
          await audit.logAction({ action: 'shopify.reauthorization.required', resourceType: 'shopify_store', resourceId: row.id, metadata: { alias: row.alias }, status: 'failure' });
          throw Object.assign(new Error(`Shopify store '${row.alias}' requires reconnection`), { statusCode: 409 });
        }
        throw error;
      }
    });
  }

  async getTargetService(alias) {
    const resolved = await this.resolve(alias);
    return new ShopifyTargetService(resolved.domain, () => this.tokenFor(resolved), { ...config.api, apiVersion: config.shopify.apiVersion, refreshToken: () => this.tokenFor(resolved, true) });
  }

  async maintain() {
    const rows = await storeRepo.dueForMaintenance(new Date(Date.now() + 24 * 60 * 60 * 1000));
    return Promise.allSettled(rows.map(row => this.refresh(row.id)));
  }
}
module.exports = new ShopifyStoreRegistry();
