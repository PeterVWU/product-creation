const crypto = require('crypto');
const config = require('../config');
const storeRepo = require('../database/repositories/shopify-store.repository');
const registry = require('../services/shopify/shopify-store-registry.service');
const { service: oauth, canonicalShop, safeEqual } = require('../services/shopify/shopify-oauth.service');

const cookieValue = req => (req.headers.cookie || '').split(';').map(v => v.trim().split('=')).find(([key]) => key === 'shopify_oauth_state')?.[1];
const page = (ok, message) => `<!doctype html><html><head><meta charset="utf-8"><title>Shopify connection</title></head><body><h1>${ok ? 'Store connected' : 'Connection failed'}</h1><p>${message}</p></body></html>`;

exports.connect = async (req, res) => res.status(201).json(await oauth.createConnect({ ...req.body, apiKeyId: req.apiKey?.id }));
exports.list = async (_req, res) => res.json({ stores: await registry.list() });
exports.start = async (req, res) => {
  const result = await oauth.start(req.query.ticket);
  res.cookie('shopify_oauth_state', result.state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 10 * 60 * 1000, path: '/api/v1/shopify/oauth/callback' });
  res.redirect(302, result.url);
};
exports.callback = async (req, res) => {
  try {
    await oauth.callback(req.query, decodeURIComponent(cookieValue(req) || ''));
    res.clearCookie('shopify_oauth_state', { path: '/api/v1/shopify/oauth/callback' });
    res.status(200).type('html').send(page(true, 'You can close this window.'));
  } catch (error) {
    res.clearCookie('shopify_oauth_state', { path: '/api/v1/shopify/oauth/callback' });
    res.status(error.statusCode || 400).type('html').send(page(false, 'Authorization was not completed. Request a new connection link.'));
  }
};
exports.uninstalled = async (req, res) => {
  if (!config.shopify.oauth.enabled) return res.sendStatus(404);
  const provided = req.get('X-Shopify-Hmac-Sha256');
  const expected = crypto.createHmac('sha256', config.shopify.oauth?.clientSecret || '').update(req.body).digest('base64');
  if (!safeEqual(provided, expected)) return res.status(401).send('Unauthorized');
  const domain = canonicalShop(req.get('X-Shopify-Shop-Domain'));
  const webhookId = req.get('X-Shopify-Webhook-Id');
  if (!webhookId || !domain) return res.status(400).send('Missing webhook headers');
  await storeRepo.markUninstalled(domain, webhookId);
  res.sendStatus(200);
};
