const MagentoClient = require('./magento.client');
const logger = require('../../config/logger');
const axios = require('axios');

class SourceService extends MagentoClient {
  constructor(baseUrl, token, config = {}) {
    super(baseUrl, token, config);
  }

  async getProductBySku(sku) {
    logger.info('Fetching product from source', { sku });
    return await this.get(`/rest/V1/products/${encodeURIComponent(sku)}`);
  }

  async getConfigurableChildren(parentSku) {
    logger.debug('Fetching configurable children from source', { parentSku });
    try {
      return await this.get(`/rest/V1/configurable-products/${encodeURIComponent(parentSku)}/children`);
    } catch (error) {
      logger.warn('Failed to fetch configurable children', { parentSku, error: error.message });
      return [];
    }
  }

  async getSimpleProducts(skus) {
    logger.info('Fetching simple products from source', { count: skus.length });
    const products = [];

    for (const sku of skus) {
      try {
        const product = await this.getProductBySku(sku);
        products.push(product);
      } catch (error) {
        logger.warn('Failed to fetch simple product', { sku, error: error.message });
      }
    }

    return products;
  }

  async getProductById(id) {
    logger.debug('Fetching product by ID from source', { id });
    try {
      return await this.get(`/rest/V1/products/${id}`);
    } catch (error) {
      logger.warn('Failed to fetch product by ID', { id, error: error.message });
      return null;
    }
  }

  async convertProductIdsToSkus(productIds) {
    logger.info('Converting product IDs to SKUs', { count: productIds.length });
    const skus = [];

    for (const id of productIds) {
      try {
        const product = await this.getProductById(id);
        if (product && product.sku) {
          skus.push(product.sku);
          logger.debug('Converted product ID to SKU', { id, sku: product.sku });
        } else {
          logger.warn('Product ID has no SKU', { id });
        }
      } catch (error) {
        logger.warn('Failed to convert product ID', { id, error: error.message });
      }
    }

    return skus;
  }

  async getAttributeSetById(id) {
    logger.debug('Fetching attribute set', { id });
    try {
      const response = await this.get('/rest/V1/products/attribute-sets/sets/list?searchCriteria=');
      const attributeSet = response.items.find(set => set.attribute_set_id === id);
      return attributeSet || null;
    } catch (error) {
      logger.warn('Failed to fetch attribute set', { id, error: error.message });
      return null;
    }
  }

  async getAttributeByCode(code) {
    logger.debug('Fetching attribute by code', { code });
    try {
      return await this.get(`/rest/V1/products/attributes/${code}`);
    } catch (error) {
      logger.warn('Failed to fetch attribute', { code, error: error.message });
      return null;
    }
  }

  async getAttributeOptions(attributeCode) {
    logger.debug('Fetching attribute options', { attributeCode });
    try {
      return await this.get(`/rest/V1/products/attributes/${attributeCode}/options`);
    } catch (error) {
      logger.warn('Failed to fetch attribute options', { attributeCode, error: error.message });
      return [];
    }
  }

  async getCategoryById(id) {
    logger.debug('Fetching category', { id });
    try {
      return await this.get(`/rest/V1/categories/${id}`);
    } catch (error) {
      logger.warn('Failed to fetch category', { id, error: error.message });
      return null;
    }
  }

  async downloadImage(imageUrl) {
    try {
      let fullUrl = imageUrl;
      if (imageUrl.startsWith('/')) {
        // Image URLs starting with / need /media/catalog/product prefix
        fullUrl = `${this.baseUrl}/media/catalog/product${imageUrl}`;
      } else if (!imageUrl.startsWith('http')) {
        fullUrl = `${this.baseUrl}/media/catalog/product${imageUrl}`;
      }

      logger.info('Downloading image', { originalUrl: imageUrl, fullUrl });

      const response = await axios.get(fullUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      logger.info('Image downloaded successfully', {
        url: imageUrl,
        contentType: response.headers['content-type'],
        size: response.data.length
      });

      return {
        buffer: Buffer.from(response.data),
        contentType: response.headers['content-type'] || 'image/jpeg'
      };
    } catch (error) {
      logger.error('Failed to download image', {
        url: imageUrl,
        error: error.message
      });
      throw error;
    }
  }

  extractCustomAttributeValue(product, attributeCode) {
    if (!product.custom_attributes) return null;

    const attribute = product.custom_attributes.find(
      attr => attr.attribute_code === attributeCode
    );

    return attribute ? attribute.value : null;
  }
}

module.exports = SourceService;
