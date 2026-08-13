const crypto = require('crypto');
const axios = require('axios');
const config = require('../../config');
const oauthRepo = require('../../database/repositories/shopify-oauth.repository');
const storeRepo = require('../../database/repositories/shopify-store.repository');
const audit = require('../audit/audit.service');
const TokenCryptoService = require('./token-crypto.service');

const oauthConfig = config.shopify.oauth || {};
const cryptoService = new TokenCryptoService(oauthConfig.keyring || {}, oauthConfig.activeKeyId || null);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
const canonicalShop = value => String(value || '').trim().toLowerCase();
const validShop = value => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value);
const validAlias = value => /^[a-z0-9_-]+$/.test(value);

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || '')); const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

class ShopifyOAuthService {
  callbackUrl() { return `${oauthConfig.publicBaseUrl}/api/v1/shopify/oauth/callback`; }
  webhookUrl() { return `${oauthConfig.publicBaseUrl}/api/v1/shopify/webhooks/app-uninstalled`; }

  async createConnect({ alias, shopDomain, apiKeyId }) {
    alias = String(alias || '').toLowerCase(); shopDomain = canonicalShop(shopDomain);
    if (!validAlias(alias)) throw Object.assign(new Error('Alias may contain only lowercase letters, numbers, _ and -'), { statusCode: 400 });
    if (!validShop(shopDomain)) throw Object.assign(new Error('shopDomain must be a canonical *.myshopify.com domain'), { statusCode: 400 });
    if (config.shopify.stores[alias]) throw Object.assign(new Error(`Alias '${alias}' conflicts with an environment store`), { statusCode: 409 });
    let store = await storeRepo.findByAlias(alias); const domainStore = await storeRepo.findByDomain(shopDomain);
    if ((store && (store.status === 'active' || store.shop_domain !== shopDomain)) || (domainStore && domainStore.alias !== alias)) {
      throw Object.assign(new Error('Store alias or domain is already assigned'), { statusCode: 409 });
    }
    if (!store) store = await storeRepo.createPending({ alias, shopDomain });
    const ticket = random();
    await oauthRepo.create({ alias, shop_domain: shopDomain, ticket_hash: hash(ticket), api_key_id: apiKeyId || null, expires_at: new Date(Date.now() + 10 * 60 * 1000) });
    await audit.logAction({ apiKeyId, action: 'shopify.onboarding.started', resourceType: 'shopify_store', resourceId: store.id, metadata: { alias, shopDomain }, status: 'success' });
    return { connectUrl: `${config.shopify.oauth.publicBaseUrl}/api/v1/shopify/oauth/start?ticket=${encodeURIComponent(ticket)}`, expiresIn: 600 };
  }

  async start(ticket) {
    const state = random(); const attempt = ticket && await oauthRepo.start(hash(ticket), hash(state));
    if (!attempt) throw Object.assign(new Error('Connect URL is invalid, expired, or already used'), { statusCode: 400 });
    const query = new URLSearchParams({ client_id: oauthConfig.clientId, scope: oauthConfig.scopes.join(','), redirect_uri: this.callbackUrl(), state, 'grant_options[]': 'offline', expiring: '1' });
    return { state, url: `https://${attempt.shop_domain}/admin/oauth/authorize?${query}` };
  }

  verifyCallbackHmac(query) {
    const provided = query.hmac;
    const message = Object.keys(query).filter(k => k !== 'hmac' && k !== 'signature').sort().map(k => `${k}=${Array.isArray(query[k]) ? query[k].join(',') : query[k]}`).join('&');
    return safeEqual(provided, crypto.createHmac('sha256', oauthConfig.clientSecret).update(message).digest('hex'));
  }

  async callback(query, cookieState) {
    const shop = canonicalShop(query.shop);
    if (!validShop(shop) || !query.code || !query.state || !cookieState || !safeEqual(query.state, cookieState)) throw Object.assign(new Error('Invalid OAuth callback'), { statusCode: 400 });
    const timestamp = Number(query.timestamp);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300 || !this.verifyCallbackHmac(query)) throw Object.assign(new Error('OAuth callback signature or timestamp is invalid'), { statusCode: 401 });
    const attempt = await oauthRepo.consume(hash(query.state));
    if (!attempt || attempt.shop_domain !== shop) throw Object.assign(new Error('OAuth state is expired, invalid, or already used'), { statusCode: 400 });
    const store = await storeRepo.findByAlias(attempt.alias);
    try {
      const tokenResponse = await axios.post(`https://${shop}/admin/oauth/access_token`, { client_id: oauthConfig.clientId, client_secret: oauthConfig.clientSecret, code: query.code, expiring: 1 }, { timeout: config.api.timeout });
      const tokens = tokenResponse.data;
      const scopes = String(tokens.scope || '').split(',').map(s => s.trim()).filter(Boolean);
      const missing = oauthConfig.scopes.filter(scope => !scopes.includes(scope));
      if (missing.length) throw new Error(`Required Shopify scopes were not granted: ${missing.join(', ')}`);
      const headers = { 'X-Shopify-Access-Token': tokens.access_token };
      const identity = await axios.post(`https://${shop}/admin/api/${config.shopify.apiVersion}/graphql.json`, { query: 'query { shop { myshopifyDomain } }' }, { headers, timeout: config.api.timeout });
      if (identity.data.errors || canonicalShop(identity.data.data?.shop?.myshopifyDomain) !== shop) throw new Error('Authenticated Shopify shop identity did not match');
      const existingWebhooks = await axios.post(`https://${shop}/admin/api/${config.shopify.apiVersion}/graphql.json`, { query: 'query { webhookSubscriptions(first: 100, topics: [APP_UNINSTALLED]) { nodes { id endpoint { ... on WebhookHttpEndpoint { callbackUrl } } } } }' }, { headers, timeout: config.api.timeout });
      const existing = existingWebhooks.data.data?.webhookSubscriptions?.nodes?.find(item => item.endpoint?.callbackUrl === this.webhookUrl());
      if (existingWebhooks.data.errors) throw new Error('Unable to inspect uninstall webhooks');
      if (!existing) {
        const webhook = await axios.post(`https://${shop}/admin/api/${config.shopify.apiVersion}/graphql.json`, { query: 'mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) { webhookSubscription { id } userErrors { message } } }', variables: { topic: 'APP_UNINSTALLED', webhookSubscription: { callbackUrl: this.webhookUrl(), format: 'JSON' } } }, { headers, timeout: config.api.timeout });
        const webhookResult = webhook.data.data?.webhookSubscriptionCreate;
        if (webhook.data.errors || webhookResult?.userErrors?.length || !webhookResult?.webhookSubscription?.id) throw new Error('Unable to register the uninstall webhook');
      }
      const now = Date.now();
      await storeRepo.update(store.id, { status: 'active', scopes, access_token_envelope: cryptoService.encrypt(tokens.access_token, store.id, 'access'), refresh_token_envelope: cryptoService.encrypt(tokens.refresh_token, store.id, 'refresh'), access_token_expires_at: new Date(now + Number(tokens.expires_in) * 1000), refresh_token_expires_at: new Date(now + Number(tokens.refresh_token_expires_in || 7776000) * 1000), verified_at: new Date(), uninstalled_at: null, last_error: null });
      await audit.logAction({ apiKeyId: attempt.api_key_id, action: 'shopify.onboarding.completed', resourceType: 'shopify_store', resourceId: store.id, metadata: { alias: store.alias, shopDomain: shop, scopes }, status: 'success' });
      return store;
    } catch (error) {
      await storeRepo.update(store.id, { status: 'error', last_error: error.message, access_token_envelope: null, refresh_token_envelope: null });
      await audit.logAction({ apiKeyId: attempt.api_key_id, action: 'shopify.onboarding.failed', resourceType: 'shopify_store', resourceId: store.id, metadata: { alias: store.alias, shopDomain: shop, error: error.message }, status: 'failure' });
      throw Object.assign(new Error('Shopify authorization could not be completed'), { statusCode: 502 });
    }
  }
}

module.exports = { service: new ShopifyOAuthService(), cryptoService, canonicalShop, safeEqual };
