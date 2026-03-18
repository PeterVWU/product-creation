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
}

module.exports = ProductUpdateService;
