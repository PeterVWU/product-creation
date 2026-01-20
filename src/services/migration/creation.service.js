const logger = require('../../config/logger');
const ImageService = require('../image.service');
const { CreationError } = require('../../utils/error-handler');
const config = require('../../config');
const constants = require('../../config/constants');

class CreationService {
  constructor(sourceService, targetService) {
    this.sourceService = sourceService;
    this.targetService = targetService;
    this.imageService = new ImageService(sourceService, targetService, {
      maxSizeMB: config.concurrency.maxImageSizeMB
    });
  }

  async createProducts(extractedData, preparedData, options = {}) {
    const startTime = Date.now();
    logger.info('Starting creation phase');

    const result = {
      success: false,
      parentSku: extractedData.parent.sku,
      createdChildren: [],
      errors: [],
      warnings: [],
      imagesUploaded: 0
    };

    try {
      result.createdChildren = await this.createSimpleProducts(
        extractedData,
        preparedData,
        options
      );

      const parentResult = await this.createConfigurableParent(
        extractedData,
        preparedData,
        options
      );

      result.parentProductId = parentResult.productId;

      await this.defineConfigurableOptions(
        extractedData,
        preparedData
      );

      await this.linkChildren(
        extractedData.parent.sku,
        result.createdChildren
      );

      const childImagesCount = result.createdChildren.reduce(
        (sum, child) => sum + (child.imagesUploaded || 0),
        0
      );
      result.imagesUploaded = childImagesCount + parentResult.imagesUploaded;

      result.success = true;

      const duration = Date.now() - startTime;
      logger.info('Creation phase completed', {
        duration: `${duration}ms`,
        childrenCreated: result.createdChildren.length,
        imagesUploaded: result.imagesUploaded
      });

      return result;
    } catch (error) {
      logger.error('Creation phase failed', { error: error.message });
      result.errors.push({
        phase: 'creation',
        message: error.message,
        details: error.details || error.stack
      });
      throw new CreationError(error.message, result);
    }
  }

  /**
   * Update products for a specific store scope (store-scoped attributes only)
   * Used for subsequent stores after the first store has done the full creation.
   * Only updates store-scoped attributes: name, price, status, visibility
   */
  async updateProductsForStore(extractedData, preparedData, options = {}) {
    const { parent, children } = extractedData;
    const startTime = Date.now();

    logger.info('Updating products for store scope', {
      parentSku: parent.sku,
      childCount: children.length
    });

    const result = {
      success: false,
      parentSku: parent.sku,
      updatedChildren: [],
      errors: [],
      warnings: []
    };

    const productStatus = options.productEnabled !== false
      ? constants.MAGENTO_API.STATUS.ENABLED
      : constants.MAGENTO_API.STATUS.DISABLED;

    try {
      // Update parent product store-scoped attributes
      await this.targetService.updateProduct(parent.sku, {
        sku: parent.sku,
        name: parent.name,
        price: parent.price,
        status: productStatus,
        visibility: constants.MAGENTO_API.VISIBILITY.CATALOG_SEARCH
      });

      logger.info('Parent product updated for store', { sku: parent.sku });

      // Update child products store-scoped attributes
      for (const child of children) {
        try {
          await this.targetService.updateProduct(child.sku, {
            sku: child.sku,
            name: child.name,
            price: child.price,
            status: productStatus,
            visibility: constants.MAGENTO_API.VISIBILITY.NOT_VISIBLE
          });
          result.updatedChildren.push({ sku: child.sku, success: true });
          logger.debug('Child product updated for store', { sku: child.sku });
        } catch (error) {
          logger.error('Failed to update child for store', { sku: child.sku, error: error.message });
          result.updatedChildren.push({ sku: child.sku, success: false, error: error.message });
          result.errors.push({
            phase: 'store-update',
            sku: child.sku,
            message: error.message
          });

          if (!config.errorHandling.continueOnError) {
            throw error;
          }
        }
      }

      result.success = true;
      const duration = Date.now() - startTime;
      logger.info('Store-scoped update completed', {
        parentSku: parent.sku,
        childrenUpdated: result.updatedChildren.filter(c => c.success).length,
        duration: `${duration}ms`
      });

      return result;
    } catch (error) {
      logger.error('Store-scoped update failed', {
        parentSku: parent.sku,
        error: error.message
      });
      result.errors.push({
        phase: 'store-update',
        message: error.message,
        details: error.stack
      });
      throw new CreationError(error.message, result);
    }
  }

  /**
   * Sync only missing variants to an existing configurable product.
   * Creates new simple products for children that don't exist on the target,
   * then links them to the existing parent.
   */
  async syncMissingVariants(extractedData, preparedData, existingChildSkus, options = {}) {
    const startTime = Date.now();
    const parentSku = extractedData.parent.sku;

    logger.info('Syncing missing variants', {
      parentSku,
      sourceChildren: extractedData.children.length,
      existingChildren: existingChildSkus.length
    });

    // Filter children to only new ones
    const newChildren = extractedData.children.filter(c => !existingChildSkus.includes(c.sku));
    const skippedChildren = extractedData.children.filter(c => existingChildSkus.includes(c.sku));

    const result = {
      success: false,
      mode: 'variant-sync',
      parentSku,
      childrenCreated: 0,
      childrenSkipped: skippedChildren.length,
      createdChildren: [],
      skippedChildren: skippedChildren.map(c => ({ sku: c.sku, reason: 'already_exists' })),
      imagesUploaded: 0,
      errors: [],
      warnings: []
    };

    if (newChildren.length === 0) {
      logger.info('No new variants to sync', { parentSku });
      result.success = true;
      return result;
    }

    try {
      // Create filtered data objects for the new children only
      const filteredExtractedData = {
        ...extractedData,
        children: newChildren,
        childLinks: extractedData.childLinks?.filter(link =>
          typeof link === 'object'
            ? !existingChildSkus.includes(link.sku)
            : !existingChildSkus.includes(link)
        ),
        images: {
          parent: [], // Don't re-upload parent images
          children: Object.fromEntries(
            Object.entries(extractedData.images?.children || {})
              .filter(([sku]) => !existingChildSkus.includes(sku))
          )
        }
      };

      const filteredPreparedData = {
        ...preparedData,
        children: preparedData.children?.filter(c => !existingChildSkus.includes(c.sku))
      };

      // Create only new simple products
      const childResults = await this.createSimpleProducts(
        filteredExtractedData,
        filteredPreparedData,
        options
      );

      result.createdChildren = childResults;
      result.childrenCreated = childResults.filter(c => c.success).length;
      result.imagesUploaded = childResults.reduce((sum, c) => sum + (c.imagesUploaded || 0), 0);

      // Link new children to existing parent
      await this.linkChildren(parentSku, childResults);

      result.success = true;

      const duration = Date.now() - startTime;
      logger.info('Variant sync completed', {
        parentSku,
        childrenCreated: result.childrenCreated,
        childrenSkipped: result.childrenSkipped,
        imagesUploaded: result.imagesUploaded,
        duration: `${duration}ms`
      });

      return result;
    } catch (error) {
      logger.error('Variant sync failed', { parentSku, error: error.message });
      result.errors.push({
        phase: 'variant-sync',
        message: error.message,
        details: error.details || error.stack
      });
      throw new CreationError(error.message, result);
    }
  }

  async createSimpleProducts(extractedData, preparedData, options) {
    logger.info('Creating simple products', { count: extractedData.children.length });

    const createdProducts = [];

    for (const child of extractedData.children) {
      try {
        const linkData = extractedData.childLinks?.find(link =>
          typeof link === 'object' && link.sku === child.sku
        );

        const productData = this.buildSimpleProductData(
          child,
          preparedData,
          linkData,
          options
        );

        logger.info('Creating simple product', { sku: productData.sku });

        const createdProduct = await this.targetService.createProduct(productData);

        let imagesUploaded = 0;
        if (options.includeImages && extractedData.images.children[child.sku]) {
          const imageResults = await this.imageService.migrateProductImages(
            child.sku,
            extractedData.images.children[child.sku]
          );
          imagesUploaded = imageResults.success.length;
        }

        createdProducts.push({
          sku: child.sku,
          success: true,
          imagesUploaded
        });

        logger.info('Simple product created successfully', { sku: child.sku });
      } catch (error) {
        logger.error('Failed to create simple product', {
          sku: child.sku,
          error: error.message
        });

        createdProducts.push({
          sku: child.sku,
          success: false,
          error: error.message
        });

        if (!config.errorHandling.continueOnError) {
          throw error;
        }
      }
    }

    return createdProducts;
  }

  buildSimpleProductData(sourceProduct, preparedData, linkData, options = {}) {
    const customAttributes = [];

    if (linkData && linkData.attributes) {
      for (const attr of linkData.attributes) {
        const attributeCode = attr.label.toLowerCase();
        const mappedAttr = preparedData.attributeMapping[attributeCode];

        if (mappedAttr && mappedAttr.options) {
          const targetValue = mappedAttr.options[attr.value];

          if (targetValue) {
            customAttributes.push({
              attribute_code: attributeCode,
              value: targetValue
            });
            logger.debug('Mapped configurable attribute from link data', {
              sku: sourceProduct.sku,
              attribute: attributeCode,
              sourceValue: attr.value,
              targetValue
            });
          }
        }
      }
    }

    if (sourceProduct.custom_attributes) {
      for (const attr of sourceProduct.custom_attributes) {
        const alreadyMapped = customAttributes.find(ca => ca.attribute_code === attr.attribute_code);
        if (alreadyMapped) {
          continue;
        }

        const mappedAttr = preparedData.attributeMapping[attr.attribute_code];

        if (mappedAttr && mappedAttr.options) {
          const optionLabel = this.findOptionLabel(attr.value, attr.attribute_code, sourceProduct);
          const targetValue = mappedAttr.options[optionLabel];

          if (targetValue) {
            customAttributes.push({
              attribute_code: attr.attribute_code,
              value: targetValue
            });
          }
        } else {
          customAttributes.push({
            attribute_code: attr.attribute_code,
            value: attr.value
          });
        }
      }
    }

    const productData = {
      sku: sourceProduct.sku,
      name: sourceProduct.name,
      attribute_set_id: preparedData.attributeSet?.id || 4,
      price: sourceProduct.price,
      status: options.productEnabled !== false
        ? constants.MAGENTO_API.STATUS.ENABLED
        : constants.MAGENTO_API.STATUS.DISABLED,
      visibility: constants.MAGENTO_API.VISIBILITY.NOT_VISIBLE,
      type_id: constants.MAGENTO_API.PRODUCT_TYPES.SIMPLE,
      weight: sourceProduct.weight || 0,
      custom_attributes: customAttributes
    };

    // Add website_ids if provided (for multi-store website assignment)
    if (options.websiteIds && options.websiteIds.length > 0) {
      productData.website_ids = options.websiteIds;
    }

    return productData;
  }

  async createConfigurableParent(extractedData, preparedData, options) {
    const parent = extractedData.parent;
    logger.info('Creating configurable parent product', { sku: parent.sku });

    try {
      const customAttributes = [];

      if (parent.custom_attributes) {
        for (const attr of parent.custom_attributes) {
          customAttributes.push({
            attribute_code: attr.attribute_code,
            value: attr.value
          });
        }
      }

      const productData = {
        sku: parent.sku,
        name: parent.name,
        attribute_set_id: preparedData.attributeSet?.id || 4,
        price: parent.price,
        status: options.productEnabled !== false
          ? constants.MAGENTO_API.STATUS.ENABLED
          : constants.MAGENTO_API.STATUS.DISABLED,
        visibility: constants.MAGENTO_API.VISIBILITY.CATALOG_SEARCH,
        type_id: constants.MAGENTO_API.PRODUCT_TYPES.CONFIGURABLE,
        weight: parent.weight || 0,
        custom_attributes: customAttributes
      };

      // Add website_ids if provided (for multi-store website assignment)
      if (options.websiteIds && options.websiteIds.length > 0) {
        productData.website_ids = options.websiteIds;
      }

      const createdProduct = await this.targetService.createProduct(productData);

      let imagesUploaded = 0;
      if (options.includeImages && extractedData.images.parent.length > 0) {
        const parentImageResults = await this.imageService.migrateProductImages(
          parent.sku,
          extractedData.images.parent
        );
        imagesUploaded = parentImageResults.success.length;
        logger.info('Parent images uploaded', {
          sku: parent.sku,
          uploaded: imagesUploaded,
          failed: parentImageResults.failed.length
        });
      }

      logger.info('Configurable parent created successfully', { sku: parent.sku, productId: createdProduct.id });
      return {
        productId: createdProduct.id,
        imagesUploaded
      };
    } catch (error) {
      logger.error('Failed to create configurable parent', {
        sku: parent.sku,
        error: error.message
      });
      throw error;
    }
  }

  async defineConfigurableOptions(extractedData, preparedData) {
    const parent = extractedData.parent;
    logger.info('Defining configurable options', { sku: parent.sku });

    try {
      const configurableOptions = this.buildConfigurableOptions(
        extractedData,
        preparedData
      );

      if (configurableOptions.length === 0) {
        logger.warn('No configurable options to define', { sku: parent.sku });
        return;
      }

      await this.targetService.createConfigurableOptions(
        parent.sku,
        configurableOptions
      );

      logger.info('Configurable options defined successfully', {
        sku: parent.sku,
        optionsCount: configurableOptions.length
      });
    } catch (error) {
      logger.error('Failed to define configurable options', {
        sku: parent.sku,
        error: error.message
      });
      throw error;
    }
  }

  buildConfigurableOptions(extractedData, preparedData) {
    const options = [];

    if (!extractedData.parent.extension_attributes?.configurable_product_options) {
      return options;
    }

    const sourceOptions = extractedData.parent.extension_attributes.configurable_product_options;

    for (const sourceOption of sourceOptions) {
      const attributeCode = extractedData.translations.attributes[sourceOption.attribute_id];

      if (!attributeCode) {
        logger.warn('Attribute code not found for option', { attributeId: sourceOption.attribute_id });
        continue;
      }

      const targetAttribute = preparedData.attributeMapping[attributeCode];

      if (!targetAttribute) {
        logger.warn('Target attribute not found', { attributeCode });
        continue;
      }

      const values = [];

      if (sourceOption.values) {
        for (const value of sourceOption.values) {
          const key = `${sourceOption.attribute_id}_${value.value_index}`;
          const valueData = extractedData.translations.attributeValues[key];

          if (valueData) {
            const targetValue = targetAttribute.options[valueData.label];

            if (targetValue) {
              values.push({
                value_index: parseInt(targetValue, 10)
              });
            }
          }
        }
      }

      if (values.length > 0) {
        options.push({
          attribute_id: targetAttribute.id.toString(),
          label: sourceOption.label || attributeCode,
          position: sourceOption.position || 0,
          is_use_default: true,
          values
        });
      }
    }

    return options;
  }

  async linkChildren(parentSku, createdChildren) {
    logger.info('Linking children to parent', {
      parentSku,
      childrenCount: createdChildren.length
    });

    const successfulChildren = createdChildren.filter(child => child.success);

    for (const child of successfulChildren) {
      try {
        await this.targetService.linkChildProduct(parentSku, child.sku);
        logger.info('Child linked successfully', { parentSku, childSku: child.sku });
      } catch (error) {
        logger.error('Failed to link child', {
          parentSku,
          childSku: child.sku,
          error: error.message
        });

        if (!config.errorHandling.continueOnError) {
          throw error;
        }
      }
    }

    logger.info('Children linking completed', {
      parentSku,
      linked: successfulChildren.length
    });
  }

  findOptionLabel(value, attributeCode, product) {
    if (!product.custom_attributes) return value;

    const attr = product.custom_attributes.find(a => a.attribute_code === attributeCode);

    if (attr && attr.value) {
      return attr.value.toString();
    }

    return value.toString();
  }
}

module.exports = CreationService;
