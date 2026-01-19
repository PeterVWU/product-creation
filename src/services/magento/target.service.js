const MagentoClient = require('./magento.client');
const logger = require('../../config/logger');
const { buildProductPayload } = require('../../utils/helpers');

class TargetService extends MagentoClient {
  constructor(baseUrl, token, config = {}) {
    super(baseUrl, token, config);
    // Store constructor parameters for creating scoped instances
    this._baseUrl = baseUrl;
    this._token = token;
    this._config = config;
  }

  createScopedInstance(storeCode) {
    const scopedConfig = { ...this._config, storeCode };
    return new TargetService(this._baseUrl, this._token, scopedConfig);
  }

  async createProduct(productData) {
    logger.info('Creating product in target', { sku: productData.sku });
    const payload = buildProductPayload(productData);
    return await this.post('/rest/V1/products', payload);
  }

  async getProductBySku(sku) {
    logger.debug('Checking if product exists in target', { sku });
    try {
      return await this.get(`/rest/V1/products/${encodeURIComponent(sku)}`);
    } catch (error) {
      return null;
    }
  }

  async updateProduct(sku, productData) {
    logger.info('Updating product in target', { sku });
    const payload = buildProductPayload(productData);
    return await this.put(`/rest/V1/products/${encodeURIComponent(sku)}`, payload);
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
}

module.exports = TargetService;
