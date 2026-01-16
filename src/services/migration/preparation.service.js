const logger = require('../../config/logger');
const { PreparationError } = require('../../utils/error-handler');

class PreparationService {
  constructor(targetService) {
    this.targetService = targetService;
  }

  async prepareTarget(extractedData) {
    const startTime = Date.now();
    logger.info('Starting preparation phase');

    const result = {
      attributeSet: null,
      attributeMapping: {},
      categoryMapping: {},
      customAttributeMapping: {},
      errors: [],
      warnings: []
    };

    try {
      result.attributeSet = await this.prepareAttributeSet(
        extractedData.translations.attributeSet
      );

      result.attributeMapping = await this.prepareAttributes(
        extractedData.translations.attributeValues
      );

      result.customAttributeMapping = extractedData.translations.customAttributes;

      const duration = Date.now() - startTime;
      logger.info('Preparation phase completed', {
        duration: `${duration}ms`,
        attributesProcessed: Object.keys(result.attributeMapping).length
      });

      return result;
    } catch (error) {
      logger.error('Preparation phase failed', { error: error.message });
      throw new PreparationError(error.message, { errors: result.errors });
    }
  }

  async prepareAttributeSet(sourceAttributeSet) {
    if (!sourceAttributeSet) {
      logger.warn('No attribute set found in source');
      return null;
    }

    logger.info('Preparing attribute set', { name: sourceAttributeSet.name });

    try {
      const targetAttributeSet = await this.targetService.getAttributeSetByName(
        sourceAttributeSet.name
      );

      if (targetAttributeSet) {
        logger.info('Attribute set found in target', {
          name: targetAttributeSet.attribute_set_name,
          id: targetAttributeSet.attribute_set_id
        });

        return {
          id: targetAttributeSet.attribute_set_id,
          name: targetAttributeSet.attribute_set_name
        };
      } else {
        logger.warn('Attribute set not found in target', { name: sourceAttributeSet.name });
        return {
          id: 4,
          name: 'Default'
        };
      }
    } catch (error) {
      logger.error('Failed to prepare attribute set', { error: error.message });
      return {
        id: 4,
        name: 'Default'
      };
    }
  }

  async prepareAttributes(attributeValues) {
    logger.info('Preparing attributes and options', {
      count: Object.keys(attributeValues).length
    });

    const attributeMapping = {};

    const attributeGroups = this.groupByAttribute(attributeValues);

    for (const [attributeCode, values] of Object.entries(attributeGroups)) {
      try {
        const targetAttribute = await this.targetService.getAttributeByCode(attributeCode);

        if (!targetAttribute) {
          logger.warn('Attribute not found in target', { attributeCode });
          continue;
        }

        attributeMapping[attributeCode] = {
          id: targetAttribute.attribute_id,
          code: attributeCode,
          options: {}
        };

        for (const valueData of values) {
          try {
            const targetOption = await this.targetService.ensureAttributeOptionExists(
              attributeCode,
              valueData.label
            );

            if (targetOption) {
              attributeMapping[attributeCode].options[valueData.label] = targetOption.value;
              logger.debug('Attribute option mapped', {
                attributeCode,
                label: valueData.label,
                targetValue: targetOption.value
              });
            }
          } catch (error) {
            logger.warn('Failed to create/find attribute option', {
              attributeCode,
              label: valueData.label,
              error: error.message
            });
          }
        }
      } catch (error) {
        logger.warn('Failed to prepare attribute', { attributeCode, error: error.message });
      }
    }

    return attributeMapping;
  }

  groupByAttribute(attributeValues) {
    const groups = {};

    for (const [key, valueData] of Object.entries(attributeValues)) {
      const attributeCode = valueData.attributeCode;

      if (!groups[attributeCode]) {
        groups[attributeCode] = [];
      }

      groups[attributeCode].push(valueData);
    }

    return groups;
  }
}

module.exports = PreparationService;
