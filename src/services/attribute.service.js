const logger = require('../config/logger');
const pLimit = require('p-limit');

class AttributeService {
  constructor(sourceService) {
    this.sourceService = sourceService;
    this.limit = pLimit(5);
  }

  async translateAttributeSet(attributeSetId) {
    if (!attributeSetId) return null;

    try {
      const attributeSet = await this.sourceService.getAttributeSetById(attributeSetId);
      return attributeSet ? {
        id: attributeSet.attribute_set_id,
        name: attributeSet.attribute_set_name
      } : null;
    } catch (error) {
      logger.warn('Failed to translate attribute set', { id: attributeSetId, error: error.message });
      return null;
    }
  }

  async translateConfigurableOptions(product) {
    const translations = {
      attributes: {},
      attributeValues: {}
    };

    if (!product.extension_attributes?.configurable_product_options) {
      return translations;
    }

    const options = product.extension_attributes.configurable_product_options;

    for (const option of options) {
      try {
        const attribute = await this.sourceService.getAttributeByCode(option.attribute_id);

        if (attribute) {
          translations.attributes[option.attribute_id] = attribute.attribute_code;

          if (option.values && option.values.length > 0) {
            const attributeOptions = await this.sourceService.getAttributeOptions(attribute.attribute_code);

            for (const value of option.values) {
              // Skip if value_index is null/undefined
              if (value.value_index == null) {
                logger.debug('Skipping option value with null value_index', {
                  attributeId: option.attribute_id,
                  attributeCode: attribute.attribute_code
                });
                continue;
              }

              const optionData = attributeOptions.find(
                opt => opt.value === value.value_index.toString()
              );

              if (optionData && optionData.label) {
                const key = `${option.attribute_id}_${value.value_index}`;
                translations.attributeValues[key] = {
                  attributeCode: attribute.attribute_code,
                  label: optionData.label,
                  value: value.value_index
                };
              }
            }
          }
        }
      } catch (error) {
        logger.warn('Failed to translate configurable option', {
          attributeId: option.attribute_id,
          error: error.message
        });
      }
    }

    return translations;
  }

  async translateCustomAttributes(product) {
    const translations = {};

    if (!product.custom_attributes) return translations;

    for (const attr of product.custom_attributes) {
      translations[attr.attribute_code] = attr.value;
    }

    return translations;
  }

  async translateCategories(categoryIds) {
    if (!categoryIds || categoryIds.length === 0) return {};

    const translations = {};
    const promises = categoryIds.map(id =>
      this.limit(async () => {
        try {
          const category = await this.sourceService.getCategoryById(id);
          if (category) {
            translations[id] = category.name;
          }
        } catch (error) {
          logger.warn('Failed to translate category', { id, error: error.message });
        }
      })
    );

    await Promise.all(promises);
    return translations;
  }

  extractConfigurableAttributeCodes(product) {
    const codes = new Set();

    if (product.extension_attributes?.configurable_product_options) {
      for (const option of product.extension_attributes.configurable_product_options) {
        if (this.sourceService.translations?.attributes[option.attribute_id]) {
          codes.add(this.sourceService.translations.attributes[option.attribute_id]);
        }
      }
    }

    return Array.from(codes);
  }

  normalizeAttributeValue(value) {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  }
}

module.exports = AttributeService;
