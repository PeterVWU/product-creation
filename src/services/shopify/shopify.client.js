const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const logger = require('../../config/logger');
const { ShopifyAPIError } = require('../../utils/error-handler');

class ShopifyClient {
  constructor(shopDomain, accessToken, config = {}) {
    this.shopDomain = shopDomain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    this.accessToken = accessToken;
    this.apiVersion = config.apiVersion || '2025-01';
    this.timeout = config.timeout || 30000;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;

    this.baseUrl = `https://${this.shopDomain}/admin/api/${this.apiVersion}`;
    this.graphqlUrl = `${this.baseUrl}/graphql.json`;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'X-Shopify-Access-Token': this.accessToken,
        'Content-Type': 'application/json'
      }
    });

    this.setupRetry();
    this.setupInterceptors();
  }

  setupRetry() {
    axiosRetry(this.client, {
      retries: this.maxRetries,
      retryDelay: (retryCount, error) => {
        // Check for Shopify rate limit headers
        const retryAfter = error.response?.headers?.['retry-after'];
        if (retryAfter) {
          return parseInt(retryAfter, 10) * 1000;
        }
        return retryCount * this.retryDelay;
      },
      retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               error.response?.status === 429 ||
               error.response?.status === 503;
      },
      onRetry: (retryCount, error, requestConfig) => {
        logger.warn('Retrying Shopify request', {
          retryCount,
          url: requestConfig.url,
          method: requestConfig.method,
          error: error.message
        });
      }
    });
  }

  setupInterceptors() {
    this.client.interceptors.request.use(
      (config) => {
        logger.debug('Shopify API Request', {
          method: config.method?.toUpperCase(),
          url: config.url,
          baseURL: config.baseURL
        });
        return config;
      },
      (error) => {
        logger.error('Request interceptor error', { error: error.message });
        return Promise.reject(error);
      }
    );

    this.client.interceptors.response.use(
      (response) => {
        // Log rate limit info if available
        const throttleStatus = response.headers?.['x-shopify-shop-api-call-limit'];
        if (throttleStatus) {
          logger.debug('Shopify API Rate Limit', { limit: throttleStatus });
        }

        logger.debug('Shopify API Response', {
          status: response.status,
          url: response.config.url
        });
        return response;
      },
      (error) => {
        const errorMessage = this.extractErrorMessage(error);
        const statusCode = error.response?.status || 500;

        logger.error('Shopify API Error', {
          message: errorMessage,
          status: statusCode,
          url: error.config?.url,
          method: error.config?.method
        });

        throw new ShopifyAPIError(
          errorMessage,
          statusCode,
          error.response?.data
        );
      }
    );
  }

  extractErrorMessage(error) {
    if (error.response?.data) {
      // GraphQL errors
      if (error.response.data.errors) {
        const errors = error.response.data.errors;
        if (Array.isArray(errors)) {
          return errors.map(e => e.message).join('; ');
        }
        if (typeof errors === 'string') {
          return errors;
        }
      }
      // Standard error message
      if (error.response.data.message) {
        return error.response.data.message;
      }
    }
    return error.message || 'Unknown Shopify API error';
  }

  async query(graphqlQuery, variables = {}) {
    const response = await this.client.post('/graphql.json', {
      query: graphqlQuery,
      variables
    });

    // Check for GraphQL-level errors
    if (response.data.errors && response.data.errors.length > 0) {
      const errorMessages = response.data.errors.map(e => e.message).join('; ');
      throw new ShopifyAPIError(errorMessages, 400, response.data.errors);
    }

    // Check for user errors in the mutation response
    const dataKeys = Object.keys(response.data.data || {});
    for (const key of dataKeys) {
      const userErrors = response.data.data[key]?.userErrors;
      if (userErrors && userErrors.length > 0) {
        const errorMessages = userErrors.map(e => `${e.field?.join('.') || 'field'}: ${e.message}`).join('; ');
        logger.warn('Shopify GraphQL user errors', { mutation: key, errors: userErrors });
        throw new ShopifyAPIError(errorMessages, 400, userErrors);
      }
    }

    return response.data;
  }

  async testConnection() {
    try {
      const query = `
        query {
          shop {
            name
            email
            primaryDomain {
              url
            }
          }
        }
      `;

      const result = await this.query(query);
      return {
        connected: true,
        shopDomain: this.shopDomain,
        shopName: result.data?.shop?.name,
        shopUrl: result.data?.shop?.primaryDomain?.url
      };
    } catch (error) {
      return {
        connected: false,
        shopDomain: this.shopDomain,
        error: error.message
      };
    }
  }

  getGraphqlEndpoint() {
    return this.graphqlUrl;
  }

  getShopDomain() {
    return this.shopDomain;
  }
}

module.exports = ShopifyClient;
