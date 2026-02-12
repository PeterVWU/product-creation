const MagentoClient = require('./magento.client');
const logger = require('../../config/logger');
const config = require('../../config');
const { buildProductPayload } = require('../../utils/helpers');

class TargetService extends MagentoClient {
  constructor(baseUrl, token, config = {}) {
    super(baseUrl, token, config);
    // Store constructor parameters for creating scoped instances
    this._baseUrl = baseUrl;
    this._token = token;
    this._config = config;
    // Cache for category lookups
    this._categoryCache = new Map();
  }

  createScopedInstance(storeCode) {
    const scopedConfig = { ...this._config, storeCode };
    return new TargetService(this._baseUrl, this._token, scopedConfig);
  }

  async createProduct(productData) {
    logger.info('Creating product in target', { sku: productData.sku });
    const payload = buildProductPayload(productData);
    // Log payload without base64 image data to avoid cluttering logs
    const logPayload = JSON.parse(JSON.stringify(payload));
    if (logPayload.product?.media_gallery_entries) {
      logPayload.product.media_gallery_entries = logPayload.product.media_gallery_entries.map(entry => ({
        ...entry,
        content: entry.content ? { ...entry.content, base64_encoded_data: '[REDACTED]' } : entry.content
      }));
    }
    logger.debug('Product payload being sent', { payload: JSON.stringify(logPayload, null, 2) });
    // Use /rest/all/V1/products to ensure global-scope attributes (weight, etc.) are saved
    // Store-scoped endpoints don't save global attributes properly (Magento bug)
    const response = await this.client.post('/rest/all/V1/products', payload);
    logger.info('Product creation response', {
      sku: response.data?.sku,
      weight: response.data?.weight,
      responseKeys: Object.keys(response.data || {})
    });
    return response.data;
  }

  async getProductBySku(sku) {
    logger.debug('Checking if product exists in target', { sku });
    try {
      return await this.get(`/rest/V1/products/${encodeURIComponent(sku)}`);
    } catch (error) {
      return null;
    }
  }

  async getConfigurableChildren(parentSku) {
    logger.debug('Fetching configurable children', { parentSku });
    try {
      return await this.get(`/rest/V1/configurable-products/${encodeURIComponent(parentSku)}/children`);
    } catch (error) {
      logger.warn('Failed to fetch configurable children', { parentSku, error: error.message });
      return [];
    }
  }

  async updateProduct(sku, productData) {
    logger.info('Updating product in target', { sku });
    const payload = buildProductPayload(productData);
    return await this.put(`/rest/V1/products/${encodeURIComponent(sku)}`, payload);
  }

  async updateProductPrice(sku, price) {
    logger.info('Updating product price in target', { sku, price });
    const payload = {
      product: {
        sku,
        price
      }
    };
    return await this.put(`/rest/V1/products/${encodeURIComponent(sku)}`, payload);
  }

  async updateProductWeight(sku, weight) {
    logger.info('Updating product weight', { sku, weight });
    const payload = {
      product: {
        sku,
        weight: weight.toString()
      }
    };
    // Use global endpoint for global-scope attributes
    const response = await this.client.put(`/rest/all/V1/products/${encodeURIComponent(sku)}`, payload);
    logger.info('Weight update response', { sku, weight: response.data?.weight });
    return response.data;
  }

  async getAttributeByCode(code) {
    logger.debug('Fetching attribute from target', { code });
    try {
      return await this.get(`/rest/V1/products/attributes/${code}`);
    } catch (error) {
      logger.warn('Attribute not found in target', { code });
      return null;
    }
  }

  async getAttributeOptions(attributeCode) {
    logger.debug('Fetching attribute options from target', { attributeCode });
    try {
      return await this.get(`/rest/V1/products/attributes/${attributeCode}/options`);
    } catch (error) {
      logger.warn('Failed to fetch attribute options from target', { attributeCode });
      return [];
    }
  }

  async findAttributeOptionByLabel(attributeCode, label) {
    logger.debug('Finding attribute option by label', { attributeCode, label });

    const options = await this.getAttributeOptions(attributeCode);

    const option = options.find(
      opt => opt.label && opt.label.toLowerCase() === label.toLowerCase()
    );

    return option || null;
  }

  async createAttributeOption(attributeCode, label) {
    logger.info('Creating attribute option in target', { attributeCode, label });

    const payload = {
      option: {
        label: label,
        sort_order: 0,
        is_default: false
      }
    };

    try {
      const result = await this.post(
        `/rest/V1/products/attributes/${attributeCode}/options`,
        payload
      );
      return result;
    } catch (error) {
      logger.error('Failed to create attribute option', {
        attributeCode,
        label,
        error: error.message
      });
      throw error;
    }
  }

  async ensureAttributeOptionExists(attributeCode, label) {
    logger.debug('Ensuring attribute option exists', { attributeCode, label });

    let option = await this.findAttributeOptionByLabel(attributeCode, label);

    if (!option) {
      logger.info('Attribute option not found, creating', { attributeCode, label });
      const newOptionId = await this.createAttributeOption(attributeCode, label);
      const options = await this.getAttributeOptions(attributeCode);
      option = options.find(opt => opt.label === label);
    }

    return option;
  }

  async uploadProductImage(sku, base64Image, metadata = {}) {
    logger.info('Uploading image to product', { sku });

    const payload = {
      entry: {
        media_type: 'image',
        label: metadata.label || 'Product Image',
        position: metadata.position || 1,
        disabled: false,
        types: metadata.types || ['image'],
        content: {
          base64_encoded_data: base64Image,
          type: metadata.contentType || 'image/jpeg',
          name: metadata.fileName || `${sku}-image.jpg`
        }
      }
    };

    try {
      return await this.post(`/rest/V1/products/${encodeURIComponent(sku)}/media`, payload);
    } catch (error) {
      logger.error('Failed to upload image', { sku, error: error.message });
      throw error;
    }
  }

  async createConfigurableOptions(sku, options) {
    logger.info('Creating configurable options', { sku, optionsCount: options.length });

    const results = [];

    for (const option of options) {
      try {
        const payload = { option };
        const result = await this.post(
          `/rest/V1/configurable-products/${encodeURIComponent(sku)}/options`,
          payload
        );
        results.push(result);
        logger.debug('Configurable option created', { sku, attributeId: option.attribute_id });
      } catch (error) {
        logger.error('Failed to create configurable option', {
          sku,
          attributeId: option.attribute_id,
          error: error.message
        });
        throw error;
      }
    }

    return results;
  }

  async linkChildProduct(parentSku, childSku) {
    logger.info('Linking child to parent', { parentSku, childSku });

    try {
      return await this.post(
        `/rest/V1/configurable-products/${encodeURIComponent(parentSku)}/child`,
        { childSku }
      );
    } catch (error) {
      logger.error('Failed to link child product', {
        parentSku,
        childSku,
        error: error.message
      });
      throw error;
    }
  }

  async getAttributeSetByName(name) {
    logger.debug('Finding attribute set by name', { name });
    try {
      const response = await this.get('/rest/V1/products/attribute-sets/sets/list?searchCriteria=');
      const attributeSet = response.items.find(
        set => set.attribute_set_name.toLowerCase() === name.toLowerCase()
      );
      return attributeSet || null;
    } catch (error) {
      logger.warn('Failed to fetch attribute sets', { error: error.message });
      return null;
    }
  }

  async getStoreWebsiteMapping() {
    logger.debug('Fetching store to website mapping');
    try {
      const storeViews = await this.get('/rest/V1/store/storeViews');
      const mapping = {};
      for (const store of storeViews) {
        mapping[store.code] = store.website_id;
      }
      logger.debug('Store website mapping retrieved', { mapping });
      return mapping;
    } catch (error) {
      logger.error('Failed to fetch store website mapping', { error: error.message });
      throw error;
    }
  }

  async getCategoryByName(name) {
    logger.debug('Searching for category by name', { name });

    try {
      // Search for category by name using Magento search criteria
      const searchCriteria = `searchCriteria[filterGroups][0][filters][0][field]=name&` +
        `searchCriteria[filterGroups][0][filters][0][value]=${encodeURIComponent(name)}&` +
        `searchCriteria[filterGroups][0][filters][0][conditionType]=eq`;

      const response = await this.get(`/rest/V1/categories/list?${searchCriteria}`);

      if (response.items && response.items.length > 0) {
        const category = response.items[0];
        logger.debug('Category found', { name, categoryId: category.id });
        return category;
      }

      logger.debug('Category not found', { name });
      return null;
    } catch (error) {
      logger.warn('Failed to search for category', { name, error: error.message });
      return null;
    }
  }

  async getCategoryIdByName(name) {
    // Check cache first
    const cacheKey = name.toLowerCase();
    if (this._categoryCache.has(cacheKey)) {
      const cachedId = this._categoryCache.get(cacheKey);
      logger.debug('Category ID found in cache', { name, categoryId: cachedId });
      return cachedId;
    }

    const category = await this.getCategoryByName(name);

    if (category) {
      // Cache the result
      this._categoryCache.set(cacheKey, category.id);
      return category.id;
    }

    return null;
  }

  clearCategoryCache() {
    this._categoryCache.clear();
    logger.debug('Category cache cleared');
  }

  /**
   * Get a TargetService instance for a named Magento store.
   * @param {string} storeName - The store name (e.g., 'ejuices', 'misthub')
   * @returns {TargetService}
   */
  static getInstanceForStore(storeName) {
    const storeConfig = config.magentoStores[storeName];
    if (!storeConfig) {
      const available = Object.keys(config.magentoStores);
      throw new Error(
        `Magento store '${storeName}' not configured. ` +
        `Available stores: ${available.length ? available.join(', ') : 'none'}`
      );
    }
    return new TargetService(storeConfig.url, storeConfig.token, config.api);
  }
}

module.exports = TargetService;
