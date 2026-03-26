const config = require('../config');
const apiKeyRepo = require('../database/repositories/api-key.repository');
const roleRepo = require('../database/repositories/role.repository');
const { parseApiKey, verifySecret } = require('../utils/api-key.utils');
const { AuthenticationError } = require('../utils/error-handler');

function auth() {
  return async (req, res, next) => {
    if (!config.auth.enabled) {
      req.apiKey = null;
      return next();
    }

    const rawKey = req.headers['x-api-key'];
    if (!rawKey) {
      return next(new AuthenticationError('Missing X-API-Key header'));
    }

    const parsed = parseApiKey(rawKey);
    if (!parsed) {
      return next(new AuthenticationError('Invalid API key format'));
    }

    const keyRow = await apiKeyRepo.findByPrefix(parsed.prefix);
    if (!keyRow) {
      return next(new AuthenticationError('Invalid API key'));
    }

    const valid = await verifySecret(parsed.secret, keyRow.key_hash);
    if (!valid) {
      return next(new AuthenticationError('Invalid API key'));
    }

    const role = await roleRepo.findById(keyRow.role_id);

    req.apiKey = {
      id: keyRow.id,
      name: keyRow.name,
      role: keyRow.role_id,
      permissions: role ? role.permissions : []
    };

    next();
  };
}

module.exports = auth;
