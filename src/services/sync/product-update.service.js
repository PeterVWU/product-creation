'use strict';

const logger = require('../../config/logger');
const config = require('../../config');
const SourceService = require('../magento/source.service');
const TargetService = require('../magento/target.service');
const ShopifyTargetService = require('../shopify/shopify-target.service');
const AttributeService = require('../attribute.service');
const CategoryMappingService = require('../category-mapping.service');
const GoogleChatService = require('../notification/google-chat.service');
const { ExtractionError } = require('../../utils/error-handler');

class ProductUpdateService {
  constructor() {
    this.sourceService = new SourceService(
      config.source.baseUrl,
      config.source.token,
      config.api
    );
    this.attributeService = new AttributeService(this.sourceService);
    this.categoryMappingService = new CategoryMappingService();
    this.shopifyStores = config.shopify.stores;
    this.googleChatService = new GoogleChatService();
  }

  // ── Product type classification ──────────────────────────────────────────

  classifyProductType(product) {
    if (!product || !product.type_id) {
      throw new ExtractionError(`Product type could not be determined for SKU: ${product?.sku}`);
    }
    if (product.type_id === 'configurable') return 'configurable';
    if (product.type_id === 'simple') {
      if (product.visibility === 1) {
        throw new ExtractionError(
          `Product ${product.sku} is a child simple (non-standalone). Pass the parent SKU instead.`
        );
      }
      return 'standalone-simple';
    }
    throw new ExtractionError(`Unsupported product type: ${product.type_id} for SKU: ${product.sku}`);
  }

  // ── Custom attribute helpers ─────────────────────────────────────────────

  extractCustomAttribute(product, code) {
    if (!product.custom_attributes) return null;
    const attr = product.custom_attributes.find(a => a.attribute_code === code);
    return attr ? attr.value : null;
  }

  parseMetaKeywordsToTags(metaKeyword) {
    if (!metaKeyword) return [];
    return metaKeyword.split(',').map(k => k.trim()).filter(k => k.length > 0);
  }

  // ── Store resolvers ──────────────────────────────────────────────────────

  resolveMagentoTargetStores(optionStores) {
    if (optionStores && Array.isArray(optionStores) && optionStores.length > 0) {
      return optionStores.map(s => s.toLowerCase());
    }
    // Default to ALL configured Magento stores (differs from PriceSyncService which defaults to [])
    return Object.keys(config.magentoStores);
  }

  resolveShopifyTargetStores(optionStores) {
    const available = Object.keys(this.shopifyStores);
    if (optionStores && Array.isArray(optionStores) && optionStores.length > 0) {
      return optionStores.filter(s => available.includes(s.toLowerCase())).map(s => s.toLowerCase());
    }
    return available;
  }

  // ── Child link extraction (mirrors PriceSyncService.extractChildLinks) ───

  extractChildLinks(parent) {
    const links = [];
    if (parent.extension_attributes?.configurable_product_link_data) {
      for (const dataStr of parent.extension_attributes.configurable_product_link_data) {
        try {
          const data = JSON.parse(dataStr);
          if (data.simple_product_sku) {
            links.push({ sku: data.simple_product_sku, id: data.simple_product_id });
          }
        } catch (error) {
          logger.warn('Failed to parse configurable_product_link_data', { error: error.message });
        }
      }
      return links;
    }
    if (parent.extension_attributes?.configurable_product_links) {
      return parent.extension_attributes.configurable_product_links.map(link =>
        typeof link === 'object' ? link : { sku: link }
      );
    }
    return links;
  }

  // ── Image URL builder ────────────────────────────────────────────────────

  buildSourceImageUrls(mediaEntries) {
    const baseUrl = config.source.baseUrl;
    return (mediaEntries || []).map(entry => ({
      url: `${baseUrl}/media/catalog/product${entry.file}`,
      alt: entry.label || ''
    }));
  }

  /**
   * Update content fields for one Magento target store.
   * @param {string} storeName
   * @param {Object} extractedData - { sourceProduct, brandLabel, categories }
   * @returns {Object} { success, warnings, error? }
   */
  async updateMagentoStore(storeName, extractedData) {
    const { sourceProduct, brandLabel, categories } = extractedData;
    const sku = sourceProduct.sku;
    const warnings = [];

    const targetService = TargetService.getInstanceForStore(storeName);

    // ── Step A: Global-scope fields (once per instance) ──────────────────

    // 1. Existence check
    const existingProduct = await targetService.getProductBySku(sku);
    if (!existingProduct) {
      return { success: false, error: 'Product not found in target store' };
    }

    // 2. Brand translation
    let brandOptionId = null;
    if (brandLabel) {
      try {
        const option = await targetService.ensureAttributeOptionExists('brand', brandLabel);
        brandOptionId = option?.value || null;
      } catch (error) {
        logger.warn('Brand translation failed, skipping brand update', { storeName, sku, error: error.message });
        warnings.push({ field: 'brand', message: `Brand translation failed: ${error.message}` });
      }
    }

    // 3. Category mapping
    const sourceCategoryNames = (categories || []).map(c => c.name);
    const categoryIds = [];
    try {
      const targetNames = this.categoryMappingService.getTargetMagentoCategories(sourceCategoryNames);
      for (const name of targetNames) {
        try {
          const catId = await targetService.getCategoryIdByName(name);
          if (catId) {
            categoryIds.push(catId);
          } else {
            warnings.push({ field: 'categories', message: `Category not found on target: ${name}` });
          }
        } catch (error) {
          warnings.push({ field: 'categories', message: `Category lookup failed: ${name}` });
        }
      }
    } catch (error) {
      logger.warn('Category mapping failed, skipping categories', { storeName, sku, error: error.message });
      warnings.push({ field: 'categories', message: `Category mapping failed: ${error.message}` });
    }

    // 4. PUT global fields via /rest/all/
    const globalCustomAttributes = [];
    if (brandOptionId) {
      globalCustomAttributes.push({ attribute_code: 'brand', value: brandOptionId });
    }

    const globalPayload = {
      product: {
        sku,
        custom_attributes: globalCustomAttributes,
        extension_attributes: {
          category_links: categoryIds.map(catId => ({ category_id: catId, position: 0 }))
        }
      }
    };

    await targetService.client.put(
      `/rest/all/V1/products/${encodeURIComponent(sku)}`,
      globalPayload
    );

    // 5. Image replace
    try {
      const mediaEntries = existingProduct.media_gallery_entries || [];
      await targetService.deleteAllProductMedia(sku, mediaEntries);

      for (const entry of (sourceProduct.media_gallery_entries || [])) {
        try {
          const { buffer, contentType } = await this.sourceService.downloadImage(entry.file);
          const base64 = buffer.toString('base64');
          await targetService.uploadProductImage(sku, base64, {
            label: entry.label || '',
            position: entry.position || 1,
            types: entry.types || [],
            contentType: contentType || 'image/jpeg',
            fileName: entry.file?.split('/').pop() || `${sku}-image.jpg`
          });
        } catch (imgError) {
          logger.warn('Failed to upload source image, skipping', { sku, file: entry.file, error: imgError.message });
          warnings.push({ field: 'images', message: `Image upload failed: ${imgError.message}` });
        }
      }
    } catch (error) {
      logger.warn('Image replace failed', { storeName, sku, error: error.message });
      warnings.push({ field: 'images', message: `Image replace failed: ${error.message}` });
    }

    // ── Step B: Store-view-scoped fields (per store view) ────────────────

    const storeWebsiteMapping = await targetService.getStoreWebsiteMapping();
    const storeCodes = Object.keys(storeWebsiteMapping);

    const description = this.extractCustomAttribute(sourceProduct, 'description');
    const metaTitle = this.extractCustomAttribute(sourceProduct, 'meta_title');
    const metaKeyword = this.extractCustomAttribute(sourceProduct, 'meta_keyword');
    const metaDescription = this.extractCustomAttribute(sourceProduct, 'meta_description');

    const scopedCustomAttributes = [];
    if (description !== null) scopedCustomAttributes.push({ attribute_code: 'description', value: description });
    if (metaTitle !== null) scopedCustomAttributes.push({ attribute_code: 'meta_title', value: metaTitle });
    if (metaKeyword !== null) scopedCustomAttributes.push({ attribute_code: 'meta_keyword', value: metaKeyword });
    if (metaDescription !== null) scopedCustomAttributes.push({ attribute_code: 'meta_description', value: metaDescription });

    const scopedProductData = {
      sku,
      name: sourceProduct.name,
      custom_attributes: scopedCustomAttributes
    };

    for (const storeCode of storeCodes) {
      const scopedService = targetService.createScopedInstance(storeCode);
      try {
        await scopedService.updateProduct(sku, scopedProductData);
        logger.debug('Store-view fields updated', { storeName, storeCode, sku });
      } catch (error) {
        logger.warn('Failed to update store-view fields', { storeName, storeCode, sku, error: error.message });
        warnings.push({ field: 'store-view', message: `Store view ${storeCode} update failed: ${error.message}` });
      }
    }

    logger.info('Magento store update complete', { storeName, sku, warnings: warnings.length });
    return { success: true, warnings };
  }
}

module.exports = ProductUpdateService;
