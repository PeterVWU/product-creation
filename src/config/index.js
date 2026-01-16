require('dotenv').config();

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
    token: process.env.TARGET_MAGENTO_TOKEN
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
  }
};

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
