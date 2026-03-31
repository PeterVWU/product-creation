const MagentoClient = require('./magento.client');
const logger = require('../../config/logger');
const axios = require('axios');

class SourceService extends MagentoClient {
  constructor(baseUrl, token, config = {}) {
    super(baseUrl, token, config);
    this.adminUrl = config.adminUrl || null;
  }

  async getProductBySku(sku) {
    logger.info('Fetching product from source', { sku });
    return await this.get(`/rest/V1/products/${encodeURIComponent(sku)}`);
  }

  async deleteProduct(sku) {
    logger.info('Deleting product from source', { sku });
    return await this.delete(`/rest/V1/products/${encodeURIComponent(sku)}`);
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

  async findParentProduct(sku) {
    logger.info('Looking up parent product for variant', { sku });

    // Step 1: Fetch the product by SKU
    const product = await this.getProductBySku(sku);

    // Step 2: Check if it's actually a variant (simple + visibility=1)
    if (product.type_id === 'configurable') {
      return {
        isVariant: false,
        message: 'Product is already a configurable (parent) product',
        product: { sku: product.sku, name: product.name, type_id: product.type_id }
      };
    }

    if (product.type_id === 'simple' && product.visibility !== 1) {
      return {
        isVariant: false,
        message: 'Product is a standalone simple product (not a variant)',
        product: { sku: product.sku, name: product.name, type_id: product.type_id, visibility: product.visibility }
      };
    }

    // Step 3: It's a variant — search for parent by name
    // Variant names follow patterns like:
    //   "Parent Name - Option1 - Option2" (separator: " - ")
    //   "Parent Name-Option" (separator: "-")
    // Try progressively shorter name segments to find the parent
    const nameSegments = product.name.split(/\s*-\s*/);
    let parentResult = null;

    // Try from longest to shortest base name (drop segments from the end)
    for (let i = nameSegments.length - 1; i >= 1; i--) {
      const baseName = nameSegments.slice(0, i).join('-').trim();
      if (!baseName) continue;

      logger.info('Searching for parent configurable product by name', { variantSku: sku, baseName, attempt: nameSegments.length - i });

      const searchParams = this.buildSearchCriteria([
        { field: 'name', value: `${baseName}%`, conditionType: 'like' },
        { field: 'type_id', value: 'configurable', conditionType: 'eq' }
      ]);

      const searchResult = await this.get('/rest/V1/products', searchParams);
      const candidates = searchResult.items || [];

      if (candidates.length === 0) continue;

      // Verify by checking each candidate's children for our variant SKU
      for (const candidate of candidates) {
        const children = await this.getConfigurableChildren(candidate.sku);
        const isChild = children.some(child => child.sku === sku);

        if (isChild) {
          const adminUrl = this.adminUrl
            ? `${this.adminUrl}/catalog/product/edit/id/${candidate.id}`
            : null;
          logger.info('Found parent product', { variantSku: sku, parentSku: candidate.sku });

          return {
            isVariant: true,
            parentFound: true,
            variant: { sku: product.sku, name: product.name },
            parent: {
              sku: candidate.sku,
              name: candidate.name,
              id: candidate.id,
              adminUrl
            }
          };
        }
      }

      // Keep track of last candidates for the response if no match found
      parentResult = { baseName, candidates };
    }

    if (parentResult) {
      return {
        isVariant: true,
        parentFound: false,
        message: `Found configurable product(s) matching name but none contain variant ${sku}`,
        variant: { sku: product.sku, name: product.name },
        candidates: parentResult.candidates.map(c => ({ sku: c.sku, name: c.name }))
      };
    }

    return {
      isVariant: true,
      parentFound: false,
      message: `No configurable parent found matching name "${product.name}"`,
      variant: { sku: product.sku, name: product.name }
    };
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
