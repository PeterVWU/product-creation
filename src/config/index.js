require('dotenv').config();

/**
 * Parse Shopify store configurations from environment variables.
 * Supports prefix-based naming: SHOPIFY_STORE_<NAME>_URL and SHOPIFY_STORE_<NAME>_TOKEN
 *
 * Example:
 *   SHOPIFY_STORE_WHOLESALE_URL=wholesale-store.myshopify.com
 *   SHOPIFY_STORE_WHOLESALE_TOKEN=shpat_xxxxxxxxxxxxx
 *
 * Results in: { wholesale: { url: '...', token: '...' } }
 */
function parseShopifyStores() {
  const stores = {};
  const storePattern = /^SHOPIFY_STORE_([A-Z0-9_]+)_URL$/;

  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(storePattern);
    if (match) {
      const storeName = match[1].toLowerCase();
      const tokenKey = `SHOPIFY_STORE_${match[1]}_TOKEN`;

      if (process.env[tokenKey]) {
        stores[storeName] = {
          url: value,
          token: process.env[tokenKey]
        };
      }
    }
  }

  return stores;
}

/**
 * Parse Magento target store configurations from environment variables.
 * Supports prefix-based naming: MAGENTO_STORE_<NAME>_URL and MAGENTO_STORE_<NAME>_TOKEN
 *
 * Example:
 *   MAGENTO_STORE_EJUICES_URL=https://www.ejuices.com/
 *   MAGENTO_STORE_EJUICES_TOKEN=admin_token_here
 *
 * Results in: { ejuices: { url: '...', token: '...' } }
 */
function parseMagentoStores() {
  const stores = {};
  const storePattern = /^MAGENTO_STORE_([A-Z0-9_]+)_URL$/;

  for (const [key, value] of Object.entries(process.env)) {
    const match = key.match(storePattern);
    if (match) {
      const storeName = match[1].toLowerCase();
      const tokenKey = `MAGENTO_STORE_${match[1]}_TOKEN`;

      if (process.env[tokenKey]) {
        stores[storeName] = {
          url: value,
          token: process.env[tokenKey]
        };
      }
    }
  }

  return stores;
}

const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development'
  },

  source: {
    baseUrl: process.env.SOURCE_MAGENTO_BASE_URL,
    token: process.env.SOURCE_MAGENTO_TOKEN,
    adminUrl: process.env.SOURCE_MAGENTO_ADMIN_URL
  },

  magentoStores: parseMagentoStores(),

  api: {
    timeout: parseInt(process.env.API_TIMEOUT, 10) || 30000,
    maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 3,
    retryDelay: parseInt(process.env.RETRY_DELAY, 10) || 1000
  },

  concurrency: {
    maxRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS, 10) || 5,
    maxImageSizeMB: parseInt(process.env.MAX_IMAGE_SIZE_MB, 10) || 10
  },

  migration: {
    includeImages: process.env.DEFAULT_INCLUDE_IMAGES === 'true',
    createMissingAttributes: process.env.DEFAULT_CREATE_MISSING_ATTRIBUTES === 'true',
    overwriteExisting: process.env.DEFAULT_OVERWRITE_EXISTING === 'true'
  },

  errorHandling: {
    continueOnError: process.env.CONTINUE_ON_ERROR === 'true'
  },

  notifications: {
    googleChat: {
      enabled: process.env.GOOGLE_CHAT_ENABLED === 'true',
      webhookUrl: process.env.GOOGLE_CHAT_WEBHOOK_URL,
      timeout: parseInt(process.env.GOOGLE_CHAT_TIMEOUT, 10) || 5000
    },
    slack: {
      enabled: process.env.SLACK_ENABLED === 'true',
      token: process.env.SLACK_BOT_TOKEN,
      channel: process.env.SLACK_CHANNEL_ID,
      timeout: parseInt(process.env.SLACK_TIMEOUT, 10) || 5000
    }
  },

  shopify: {
    apiVersion: process.env.SHOPIFY_API_VERSION || '2026-07',
    defaultStore: process.env.SHOPIFY_DEFAULT_STORE || null,
    stores: parseShopifyStores(),
    oauth: {
      enabled: process.env.SHOPIFY_OAUTH_ENABLED === 'true',
      clientId: process.env.SHOPIFY_CLIENT_ID,
      clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
      publicBaseUrl: (process.env.SHOPIFY_PUBLIC_BASE_URL || '').replace(/\/$/, ''),
      scopes: ['write_products', 'write_files', 'write_publications'],
      keyring: (() => { try { return JSON.parse(process.env.SHOPIFY_ENCRYPTION_KEYRING || '{}'); } catch (_) { throw new Error('SHOPIFY_ENCRYPTION_KEYRING must be valid JSON'); } })(),
      activeKeyId: process.env.SHOPIFY_ENCRYPTION_ACTIVE_KEY_ID
    }
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o'
  },

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    name: process.env.DB_NAME || 'migration_api',
    user: process.env.DB_USER || 'migration_user',
    password: process.env.DB_PASSWORD || ''
  },

  auth: {
    enabled: process.env.AUTH_ENABLED === 'true'
  },

  priceSync: {
    // Map store codes to customer group IDs for tier pricing
    // Parsed from PRICE_SYNC_STORE_GROUP_MAP=ejuicesco:2,wholesale:3 (comma-separated store:groupId pairs)
    storeGroupMapping: parseStoreGroupMapping()
  }
};

/**
 * Parse store-to-group mapping from environment variable.
 * Format: PRICE_SYNC_STORE_GROUP_MAP=store1:groupId1,store2:groupId2
 * Example: PRICE_SYNC_STORE_GROUP_MAP=ejuicesco:2,wholesale:3
 *
 * @returns {Object} Mapping of store codes to customer group IDs
 */
function parseStoreGroupMapping() {
  const mapping = {};
  const envValue = process.env.PRICE_SYNC_STORE_GROUP_MAP;

  if (!envValue) {
    return mapping;
  }

  const pairs = envValue.split(',').map(s => s.trim()).filter(Boolean);

  for (const pair of pairs) {
    const [storeCode, groupIdStr] = pair.split(':').map(s => s.trim());
    const groupId = parseInt(groupIdStr, 10);

    if (storeCode && !isNaN(groupId)) {
      mapping[storeCode.toLowerCase()] = groupId;
    }
  }

  return mapping;
}

const validateConfig = () => {
  const required = {
    'SOURCE_MAGENTO_BASE_URL': config.source.baseUrl,
    'SOURCE_MAGENTO_TOKEN': config.source.token
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (config.shopify.oauth.enabled) {
    if (!config.auth.enabled) throw new Error('AUTH_ENABLED=true is required when SHOPIFY_OAUTH_ENABLED=true');
    const oauthRequired = ['clientId', 'clientSecret', 'publicBaseUrl', 'activeKeyId'];
    const oauthMissing = oauthRequired.filter(key => !config.shopify.oauth[key]);
    if (oauthMissing.length) throw new Error(`Missing Shopify OAuth configuration: ${oauthMissing.join(', ')}`);
    if (!config.shopify.oauth.publicBaseUrl.startsWith('https://')) throw new Error('SHOPIFY_PUBLIC_BASE_URL must use HTTPS');
  }
};

validateConfig();

module.exports = config;
