const logger = require('../../config/logger');
const pLimit = require('p-limit');
const AttributeService = require('../attribute.service');
const { ExtractionError } = require('../../utils/error-handler');

class ExtractionService {
  constructor(sourceService) {
    this.sourceService = sourceService;
    this.attributeService = new AttributeService(sourceService);
    this.limit = pLimit(5);
  }

  async extractProduct(sku) {
    const startTime = Date.now();
    logger.info('Starting extraction phase', { sku });

    try {
      const parent = await this.sourceService.getProductBySku(sku);

      if (!parent) {
        throw new ExtractionError(`Product not found: ${sku}`);
      }

      if (parent.type_id !== 'configurable') {
        throw new ExtractionError(`Product ${sku} is not a configurable product. Type: ${parent.type_id}`);
      }

      const childLinks = this.extractChildLinks(parent);
      logger.info('Found child product links', { parentSku: sku, childCount: childLinks.length });

      const childSkus = await this.resolveChildSkus(childLinks);
      logger.info('Resolved child SKUs', { parentSku: sku, skuCount: childSkus.length });

      const children = await this.fetchChildProducts(childSkus);

      const translations = await this.translateAllIds(parent, children);

      const images = this.extractImages(parent, children);

      const duration = Date.now() - startTime;
      logger.info('Extraction phase completed', {
        sku,
        duration: `${duration}ms`,
        childrenFound: children.length
      });

      return {
        parent,
        children,
        childLinks,
        translations,
        images,
        metadata: {
          duration,
          childrenFound: children.length,
          extractedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      logger.error('Extraction phase failed', { sku, error: error.message });
      throw error;
    }
  }

  extractChildLinks(parent) {
    const links = [];

    if (parent.extension_attributes?.configurable_product_link_data) {
      logger.debug('Found configurable_product_link_data, parsing child SKUs');

      for (const dataStr of parent.extension_attributes.configurable_product_link_data) {
        try {
          const data = JSON.parse(dataStr);
          if (data.simple_product_sku) {
            links.push({
              sku: data.simple_product_sku,
              id: data.simple_product_id,
              name: data.product_name,
              attributes: data.simple_product_attribute || []
            });
          }
        } catch (error) {
          logger.warn('Failed to parse configurable_product_link_data', { error: error.message });
        }
      }

      return links;
    }

    if (parent.extension_attributes?.configurable_product_links) {
      return parent.extension_attributes.configurable_product_links.map(link => {
        return typeof link === 'object' ? link.sku || link.id || link : link;
      });
    }

    return links;
  }

  async resolveChildSkus(childLinks) {
    if (!childLinks || childLinks.length === 0) {
      return [];
    }

    const skus = [];
    const idsToConvert = [];

    for (const link of childLinks) {
      if (typeof link === 'object' && link.sku) {
        skus.push(link.sku);
        logger.debug('Extracted SKU from link data', { sku: link.sku, id: link.id });
      } else if (typeof link === 'number' || /^\d+$/.test(link)) {
        idsToConvert.push(parseInt(link, 10));
      } else {
        skus.push(link);
      }
    }

    if (idsToConvert.length > 0) {
      logger.info('Converting product IDs to SKUs', { count: idsToConvert.length });
      const convertedSkus = await this.sourceService.convertProductIdsToSkus(idsToConvert);
      skus.push(...convertedSkus);
    }

    return skus;
  }

  async fetchChildProducts(childSkus) {
    logger.info('Fetching child products', { count: childSkus.length });

    const children = [];
    const promises = childSkus.map(sku =>
      this.limit(async () => {
        try {
          const product = await this.sourceService.getProductBySku(sku);
          if (product) {
            children.push(product);
          }
        } catch (error) {
          logger.warn('Failed to fetch child product', { sku, error: error.message });
        }
      })
    );

    await Promise.all(promises);
    return children;
  }

  async translateAllIds(parent, children) {
    logger.info('Translating IDs to names');

    const translations = {
      attributeSet: null,
      attributes: {},
      attributeValues: {},
      categories: {},
      customAttributes: {}
    };

    translations.attributeSet = await this.attributeService.translateAttributeSet(
      parent.attribute_set_id
    );

    const configurableTranslations = await this.attributeService.translateConfigurableOptions(parent, children);
    translations.attributes = configurableTranslations.attributes;
    translations.attributeValues = configurableTranslations.attributeValues;

    if (parent.custom_attributes) {
      translations.customAttributes = await this.attributeService.translateCustomAttributes(parent);
    }

    translations.brandLabel = await this.attributeService.translateBrandAttribute(parent);

    const categoryIds = parent.extension_attributes?.category_links?.map(link => link.category_id) || [];
    if (categoryIds.length > 0) {
      translations.categories = await this.attributeService.translateCategories(categoryIds);
    }

    return translations;
  }

  extractImages(parent, children) {
    const images = {
      parent: [],
      children: {}
    };

    if (parent.media_gallery_entries && parent.media_gallery_entries.length > 0) {
      images.parent = parent.media_gallery_entries
        .filter(entry => !entry.disabled)
        .map(entry => ({
          file: entry.file,
          label: entry.label,
          position: entry.position,
          types: entry.types || [],
          disabled: false
        }));
    }

    for (const child of children) {
      if (child.media_gallery_entries && child.media_gallery_entries.length > 0) {
        images.children[child.sku] = child.media_gallery_entries
          .filter(entry => !entry.disabled)
          .map(entry => ({
            file: entry.file,
            label: entry.label,
            position: entry.position,
            types: entry.types || [],
            disabled: false
          }));
      }
    }

    return images;
  }
}

module.exports = ExtractionService;
