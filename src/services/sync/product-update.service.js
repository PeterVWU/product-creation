'use strict';

const logger = require('../../config/logger');
const config = require('../../config');
const SourceService = require('../magento/source.service');
const TargetService = require('../magento/target.service');
const ShopifyTargetService = require('../shopify/shopify-target.service');
const AttributeService = require('../attribute.service');
const CategoryMappingService = require('../category-mapping.service');
const NotificationService = require('../notification/notification.service');
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
    this.notificationService = new NotificationService();
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

    // 4. Build content fields from source
    const description = this.extractCustomAttribute(sourceProduct, 'description');
    const metaTitle = this.extractCustomAttribute(sourceProduct, 'meta_title');
    const metaKeyword = this.extractCustomAttribute(sourceProduct, 'meta_keyword');
    const metaDescription = this.extractCustomAttribute(sourceProduct, 'meta_description');

    const customAttributes = [];
    if (brandOptionId) {
      customAttributes.push({ attribute_code: 'brand', value: brandOptionId });
    }
    if (description !== null) customAttributes.push({ attribute_code: 'description', value: description });
    if (metaTitle !== null) customAttributes.push({ attribute_code: 'meta_title', value: metaTitle });
    if (metaKeyword !== null) customAttributes.push({ attribute_code: 'meta_keyword', value: metaKeyword });
    if (metaDescription !== null) customAttributes.push({ attribute_code: 'meta_description', value: metaDescription });

    // 5. PUT all fields via /rest/all/ (sets global default for new store views)
    const payload = {
      product: {
        sku,
        name: sourceProduct.name,
        custom_attributes: customAttributes,
        extension_attributes: {
          category_links: categoryIds.map(catId => ({ category_id: catId, position: 0 }))
        }
      }
    };

    await targetService.client.put(
      `/rest/all/V1/products/${encodeURIComponent(sku)}`,
      payload
    );

    // 6. Image replace
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

    logger.info('Magento store update complete', { storeName, sku, warnings: warnings.length });
    return { success: true, warnings };
  }

  /**
   * Update content fields for one Shopify store.
   * @param {string} storeName
   * @param {Object} extractedData - { sourceProduct, productType, brandLabel, categories, firstChildSku }
   * @returns {Object} { success, warnings, error? }
   */
  async updateShopifyStore(storeName, extractedData) {
    const { sourceProduct, productType, brandLabel, categories, firstChildSku } = extractedData;
    const sku = sourceProduct.sku;
    const storeConfig = this.shopifyStores[storeName];
    const warnings = [];

    const shopifyService = new ShopifyTargetService(
      storeConfig.url,
      storeConfig.token,
      { apiVersion: config.shopify.apiVersion }
    );

    // 1. Existence check
    const lookupSku = productType === 'configurable' ? firstChildSku : sku;
    const variants = await shopifyService.getVariantsBySkus([lookupSku]);
    if (!variants || variants.length === 0) {
      return { success: false, error: 'Product not found in target store' };
    }
    const productId = variants[0].product.id;

    // 2. Category mapping
    const sourceCategoryNames = (categories || []).map(c => c.name);
    const shopifyProductType = this.categoryMappingService.getShopifyProductType(sourceCategoryNames, storeName) || '';

    // 3. Update product fields
    const description = this.extractCustomAttribute(sourceProduct, 'description');
    const metaTitle = this.extractCustomAttribute(sourceProduct, 'meta_title');
    const metaDescription = this.extractCustomAttribute(sourceProduct, 'meta_description');
    const metaKeyword = this.extractCustomAttribute(sourceProduct, 'meta_keyword');
    const tags = this.parseMetaKeywordsToTags(metaKeyword);

    const shopifyFields = {
      title: sourceProduct.name,
      descriptionHtml: description || '',
      productType: shopifyProductType,
      tags
    };
    if (brandLabel !== null && brandLabel !== undefined) {
      shopifyFields.vendor = brandLabel;
    }
    if (metaTitle !== null) {
      shopifyFields.seoTitle = metaTitle;
    }
    if (metaDescription !== null) {
      shopifyFields.seoDescription = metaDescription;
    }

    await shopifyService.updateProductFields(productId, shopifyFields);

    // 4. Image replace (best-effort — failure recorded as warning)
    try {
      const imageUrls = this.buildSourceImageUrls(sourceProduct.media_gallery_entries || []);

      // Get current media IDs from the product
      const mediaIds = await this._getShopifyProductMediaIds(shopifyService, productId);
      await shopifyService.deleteAllProductMedia(productId, mediaIds);

      if (imageUrls.length > 0) {
        await shopifyService.createProductMedia(productId, imageUrls);
      }
    } catch (error) {
      logger.warn('Image replace failed for Shopify store', { storeName, sku, error: error.message });
      warnings.push({ field: 'images', message: `Image replace failed: ${error.message}` });
    }

    logger.info('Shopify store update complete', { storeName, sku });
    return { success: true, warnings };
  }

  /**
   * Main entry point: update content fields for one SKU across all target stores.
   * @param {string} sku - Source product SKU
   * @param {Object} options
   */
  async updateProductFields(sku, options = {}) {
    const startTime = Date.now();

    const includeMagento = options.includeMagento !== false;
    const includeShopify = options.includeShopify !== false;
    const targetMagentoStores = includeMagento ? this.resolveMagentoTargetStores(options.targetMagentoStores) : [];
    const targetShopifyStores = includeShopify ? this.resolveShopifyTargetStores(options.targetShopifyStores) : [];
    const allTargetStores = [
      ...targetMagentoStores,
      ...targetShopifyStores.map(s => `shopify:${s}`)
    ];

    const result = {
      success: true,
      sku,
      results: { magento: {}, shopify: {} },
      errors: [],
      warnings: []
    };

    // Extraction — throws if product not found (no notifications sent)
    const sourceProduct = await this.sourceService.getProductBySku(sku);
    if (!sourceProduct) {
      throw new Error(`Product not found in source: ${sku}`);
    }

    const productType = this.classifyProductType(sourceProduct);

    const brandLabel = await this.attributeService.translateBrandAttribute(sourceProduct);

    const categoryIds = (sourceProduct.extension_attributes?.category_links || []).map(l => l.category_id);
    const categoryTranslations = await this.attributeService.translateCategories(categoryIds);
    const categories = Object.entries(categoryTranslations).map(([id, name]) => ({ id, name }));

    // For configurable products, get first child SKU for Shopify lookup
    let firstChildSku = null;
    if (productType === 'configurable') {
      const childLinks = this.extractChildLinks(sourceProduct);
      if (childLinks.length === 0) {
        throw new ExtractionError(`Configurable product has no child links; cannot locate product in Shopify. SKU: ${sku}`);
      }
      firstChildSku = childLinks[0].sku || null;
    }

    const extractedData = {
      sourceProduct,
      productType,
      brandLabel,
      categories,
      firstChildSku
    };

    logger.info('Extraction complete, starting store updates', { sku, productType, brandLabel });

    // Start notification (after successful extraction)
    await this.notificationService.notifyProductUpdateStart(sku, allTargetStores);

    try {
      // Magento updates
      if (includeMagento) {
        for (const storeName of targetMagentoStores) {
          try {
            const storeResult = await this.updateMagentoStore(storeName, extractedData);
            result.results.magento[storeName] = storeResult;
            if (!storeResult.success) result.success = false;
            if (storeResult.warnings?.length) result.warnings.push(...storeResult.warnings.map(w => ({ store: storeName, ...w })));
          } catch (error) {
            result.results.magento[storeName] = { success: false, error: error.message };
            result.errors.push({ store: storeName, message: error.message });
            result.success = false;
            logger.error('Uncaught error updating Magento store', { storeName, sku, error: error.message });
            if (!config.errorHandling.continueOnError) break;
          }
        }
      }

      // Shopify updates
      if (includeShopify) {
        for (const storeName of targetShopifyStores) {
          try {
            const storeResult = await this.updateShopifyStore(storeName, extractedData);
            result.results.shopify[storeName] = storeResult;
            if (!storeResult.success) result.success = false;
            if (storeResult.warnings?.length) result.warnings.push(...storeResult.warnings.map(w => ({ store: storeName, ...w })));
          } catch (error) {
            result.results.shopify[storeName] = { success: false, error: error.message };
            result.errors.push({ store: storeName, message: error.message });
            result.success = false;
            logger.error('Uncaught error updating Shopify store', { storeName, sku, error: error.message });
            if (!config.errorHandling.continueOnError) break;
          }
        }
      }

      if (result.errors.length > 0) result.success = false;

      const duration = Date.now() - startTime;
      await this.notificationService.notifyProductUpdateEnd({
        sku, success: result.success, errors: result.errors, targetStores: allTargetStores, duration
      });

      return result;
    } catch (error) {
      result.success = false;
      result.errors.push({ phase: 'update', message: error.message });

      const duration = Date.now() - startTime;

      await this.notificationService.notifyProductUpdateEnd({
        sku, success: false, errors: result.errors, targetStores: allTargetStores, duration
      });

      return result;
    }
  }

  /**
   * Query all media IDs for a Shopify product.
   * @private
   */
  async _getShopifyProductMediaIds(shopifyService, productId) {
    const query = `
      query getProductMedia($id: ID!) {
        product(id: $id) {
          media(first: 100) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `;
    const result = await shopifyService.query(query, { id: productId });
    return (result.data.product?.media?.edges || []).map(e => e.node.id);
  }
}

module.exports = ProductUpdateService;
