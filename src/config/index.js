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

const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    env: process.env.NODE_ENV || 'development'
  },

  source: {
    baseUrl: process.env.SOURCE_MAGENTO_BASE_URL,
    token: process.env.SOURCE_MAGENTO_TOKEN
  },

  target: {
    baseUrl: process.env.TARGET_MAGENTO_BASE_URL,
    token: process.env.TARGET_MAGENTO_TOKEN,
    adminPath: process.env.TARGET_MAGENTO_ADMIN_PATH || 'admin',
    storeCodes: process.env.TARGET_STORE_CODES?.split(',').map(s => s.trim()).filter(Boolean) || []
  },

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
    }
  },

  shopify: {
    apiVersion: process.env.SHOPIFY_API_VERSION || '2025-01',
    defaultStore: process.env.SHOPIFY_DEFAULT_STORE || null,
    stores: parseShopifyStores()
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4o'
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
    'SOURCE_MAGENTO_TOKEN': config.source.token,
    'TARGET_MAGENTO_BASE_URL': config.target.baseUrl,
    'TARGET_MAGENTO_TOKEN': config.target.token
  };

  const missing = Object.entries(required)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};

validateConfig();

module.exports = config;
