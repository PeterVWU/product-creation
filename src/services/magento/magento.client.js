const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const logger = require('../../config/logger');
const { MagentoAPIError } = require('../../utils/error-handler');
const { extractErrorMessage } = require('../../utils/helpers');

class MagentoClient {
  constructor(baseUrl, token, config = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this.timeout = config.timeout || 30000;
    this.maxRetries = config.maxRetries || 3;
    this.retryDelay = config.retryDelay || 1000;
    this.storeCode = config.storeCode || null;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      }
    });

    this.setupRetry();
    this.setupInterceptors();
  }

  setupRetry() {
    axiosRetry(this.client, {
      retries: this.maxRetries,
      retryDelay: (retryCount) => {
        return retryCount * this.retryDelay;
      },
      retryCondition: (error) => {
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               error.response?.status === 429;
      },
      onRetry: (retryCount, error, requestConfig) => {
        logger.warn('Retrying request', {
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
        const fullUrl = `${config.baseURL}${config.url}`;
        logger.info('Magento API Request', {
          method: config.method?.toUpperCase(),
          url: fullUrl,
          payload: config.data || null
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
        logger.debug('Magento API Response', {
          status: response.status,
          url: response.config.url
        });
        return response;
      },
      (error) => {
        const errorMessage = extractErrorMessage(error);
        const statusCode = error.response?.status || 500;

        logger.error('Magento API Error', {
          message: errorMessage,
          status: statusCode,
          url: error.config?.url,
          method: error.config?.method
        });

        throw new MagentoAPIError(
          errorMessage,
          statusCode,
          error.response?.data
        );
      }
    );
  }

  buildEndpoint(endpoint) {
    if (!this.storeCode) {
      return endpoint;
    }
    // Convert /rest/V1/... to /rest/{storeCode}/V1/...
    return endpoint.replace(/^\/rest\/V1\//, `/rest/${this.storeCode}/V1/`);
  }

  async get(endpoint, params = {}) {
    const response = await this.client.get(this.buildEndpoint(endpoint), { params });
    return response.data;
  }

  async post(endpoint, data = {}) {
    const response = await this.client.post(this.buildEndpoint(endpoint), data);
    return response.data;
  }

  async put(endpoint, data = {}) {
    const response = await this.client.put(this.buildEndpoint(endpoint), data);
    return response.data;
  }

  async delete(endpoint) {
    const response = await this.client.delete(this.buildEndpoint(endpoint));
    return response.data;
  }

  buildSearchCriteria(filters) {
    const params = {};

    filters.forEach((filter, groupIndex) => {
      const filterIndex = 0;
      params[`searchCriteria[filterGroups][${groupIndex}][filters][${filterIndex}][field]`] = filter.field;
      params[`searchCriteria[filterGroups][${groupIndex}][filters][${filterIndex}][value]`] = filter.value;
      params[`searchCriteria[filterGroups][${groupIndex}][filters][${filterIndex}][conditionType]`] = filter.conditionType || 'eq';
    });

    return params;
  }

  async testConnection() {
    try {
      await this.get('/rest/V1/store/storeViews');
      return { connected: true, baseUrl: this.baseUrl };
    } catch (error) {
      return { connected: false, baseUrl: this.baseUrl, error: error.message };
    }
  }
}

module.exports = MagentoClient;
