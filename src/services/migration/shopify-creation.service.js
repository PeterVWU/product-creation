const logger = require('../../config/logger');
const config = require('../../config');
const { CreationError } = require('../../utils/error-handler');

class ShopifyCreationService {
  constructor(sourceService, shopifyTargetService, categoryMappingService = null) {
    this.sourceService = sourceService;
    this.shopifyTargetService = shopifyTargetService;
    this.categoryMappingService = categoryMappingService;
  }

  async createProducts(extractedData, options = {}) {
    const startTime = Date.now();
    const { parent, children, translations, images } = extractedData;

    logger.info('Starting Shopify product creation', {
      parentSku: parent.sku,
      childCount: children.length,
      includeImages: options.includeImages
    });

    const result = {
      success: false,
      parentProductId: null,
      shopifyHandle: null,
      createdVariants: [],
      imagesUploaded: 0,
      warnings: [],
      errors: []
    };

    try {
      // Extract source category names from extracted data
      const sourceCategoryNames = (extractedData.categories || []).map(cat => cat.name);

      // Build product data
      const productData = this.buildShopifyProduct(parent, children, translations, options.productStatus, sourceCategoryNames);

      // Build product options from configurable attributes
      const productOptions = this.buildProductOptionsForSet(parent, translations);

      // Upload images first using the 3-step Shopify flow:
      // 1. fileCreate - upload from external URL to Shopify CDN
      // 2. Poll fileStatus until READY
      // 3. Reference file IDs in productSet
      let fileIds = [];
      let skuToFileIndex = {};

      if (options.includeImages && images) {
        const { inputs, skuToFileIndex: mapping } = this.buildImageInputs(images, parent, children);
        skuToFileIndex = mapping;

        if (inputs.length > 0) {
          logger.info('Uploading images to Shopify CDN', { count: inputs.length });
          fileIds = await this.shopifyTargetService.uploadAndWaitForFiles(inputs);
          logger.info('Images uploaded and ready', { count: fileIds.length });
        }
      }

      // Build variants with option values and file associations
      const variants = this.buildVariantsForSet(children, translations, fileIds, skuToFileIndex);

      logger.info('Built Shopify product data', {
        title: productData.title,
        optionCount: productOptions.length,
        variantCount: variants.length,
        fileCount: fileIds.length,
        variantsWithImages: variants.filter(v => v.file).length
      });

      // Create product with options, variants, and file IDs in one call using productSet
      const createdProduct = await this.shopifyTargetService.createProductWithVariants(
        productData,
        productOptions,
        variants,
        fileIds  // Pass Shopify file IDs (not external URLs)
      );

      result.parentProductId = createdProduct.id;
      result.shopifyHandle = createdProduct.handle;

      // Extract created variants info
      if (createdProduct.variants?.edges) {
        result.createdVariants = createdProduct.variants.edges.map(edge => ({
          id: edge.node.id,
          sku: edge.node.inventoryItem?.sku || '',
          title: edge.node.title,
          success: true
        }));
      }

      // Count images uploaded (filter out null entries from failed uploads)
      result.imagesUploaded = fileIds.filter(f => f !== null).length;

      logger.info('Shopify product created with variants', {
        productId: createdProduct.id,
        handle: createdProduct.handle,
        variantsCreated: result.createdVariants.length,
        imagesUploaded: result.imagesUploaded
      });

      // Publish the product to make it visible
      await this.shopifyTargetService.publishProduct(createdProduct.id);

      result.success = true;
      result.duration = Date.now() - startTime;

      logger.info('Shopify product creation completed', {
        productId: result.parentProductId,
        variantsCreated: result.createdVariants.length,
        imagesUploaded: result.imagesUploaded,
        duration: `${result.duration}ms`
      });

      return result;
    } catch (error) {
      logger.error('Shopify product creation failed', {
        parentSku: parent.sku,
        error: error.message
      });

      result.errors.push({
        phase: 'creation',
        message: error.message,
        details: error.details || error.stack
      });

      throw new CreationError(`Failed to create Shopify product: ${error.message}`, result);
    }
  }

  /**
   * Sync only missing variants to an existing Shopify product.
   * Creates new variants for children that don't exist on the target product.
   */
  async syncMissingVariants(extractedData, existingProductId, existingVariantSkus, options = {}) {
    const startTime = Date.now();
    const { parent, children, translations, images } = extractedData;

    logger.info('Syncing missing Shopify variants', {
      parentSku: parent.sku,
      existingProductId,
      sourceChildren: children.length,
      existingVariants: existingVariantSkus.length
    });

    // Filter to only new variants
    const newChildren = children.filter(c => !existingVariantSkus.includes(c.sku));
    const skippedChildren = children.filter(c => existingVariantSkus.includes(c.sku));

    const result = {
      success: false,
      mode: 'variant-sync',
      variantsCreated: 0,
      variantsSkipped: skippedChildren.length,
      imagesUploaded: 0,
      createdVariants: [],
      skippedVariants: skippedChildren.map(c => ({ sku: c.sku, reason: 'already_exists' })),
      errors: [],
      warnings: []
    };

    if (newChildren.length === 0) {
      logger.info('No new variants to sync', { parentSku: parent.sku });
      result.success = true;
      return result;
    }

    try {
      // Build image inputs for new variants only (external URLs with SKU mapping)
      let imageInputs = [];

      if (options.includeImages && images) {
        // Filter images to only include new children
        const filteredImages = {
          parent: [], // Don't re-upload parent images
          children: Object.fromEntries(
            Object.entries(images.children || {})
              .filter(([sku]) => !existingVariantSkus.includes(sku))
          )
        };

        const { inputs } = this.buildImageInputs(filteredImages, parent, newChildren);
        imageInputs = inputs;
      }

      // Fetch existing product to get its options
      const existingProduct = await this.shopifyTargetService.getProductById(existingProductId);
      const existingOptionNames = (existingProduct?.options || []).map(o => o.name);

      // Build a map of option name -> existing values for value matching
      const existingOptionValues = {};
      for (const option of (existingProduct?.options || [])) {
        existingOptionValues[option.name] = option.values || [];
      }

      logger.info('Existing Shopify product options', {
        productId: existingProductId,
        options: existingOptionNames,
        optionValues: existingOptionValues
      });

      // Build variant data for new children, filtering to only existing options
      // and matching values to existing ones
      const variants = this.buildVariantsForSet(
        newChildren,
        translations,
        [],
        {},
        existingOptionNames,
        existingOptionValues  // Pass existing values for matching
      );

      logger.info('Creating new variants in Shopify', {
        productId: existingProductId,
        variantCount: variants.length
      });

      // Create new variants using productVariantsBulkCreate
      const createdVariants = await this.shopifyTargetService.createProductVariants(
        existingProductId,
        variants
      );

      result.createdVariants = createdVariants.map(v => ({
        id: v.id,
        sku: v.inventoryItem?.sku || v.sku,
        success: true
      }));
      result.variantsCreated = result.createdVariants.length;

      // Associate images with variants using two-step process:
      // 1. Create media on the product using productCreateMedia
      // 2. Append media to variants using productVariantAppendMedia
      if (imageInputs.length > 0 && createdVariants.length > 0) {
        logger.info('Creating product media for new variants', { count: imageInputs.length });

        // Step 1: Create media on the product (returns media IDs with SKU mapping)
        const productMedia = await this.shopifyTargetService.createProductMedia(
          existingProductId,
          imageInputs
        );

        result.imagesUploaded = productMedia.length;

        // Step 2: Build variant-media associations and append
        const variantMedia = [];

        for (const media of productMedia) {
          if (media.sku) {
            const createdVariant = createdVariants.find(v =>
              v.sku === media.sku || v.inventoryItem?.sku === media.sku
            );

            if (createdVariant) {
              variantMedia.push({
                variantId: createdVariant.id,
                mediaIds: [media.id]
              });
            }
          }
        }

        if (variantMedia.length > 0) {
          await this.shopifyTargetService.appendMediaToVariants(existingProductId, variantMedia);
          logger.info('Associated images with variants', { count: variantMedia.length });
        }
      }

      result.success = true;

      const duration = Date.now() - startTime;
      logger.info('Shopify variant sync completed', {
        parentSku: parent.sku,
        variantsCreated: result.variantsCreated,
        variantsSkipped: result.variantsSkipped,
        imagesUploaded: result.imagesUploaded,
        duration: `${duration}ms`
      });

      return result;
    } catch (error) {
      logger.error('Shopify variant sync failed', {
        parentSku: parent.sku,
        error: error.message
      });

      result.errors.push({
        phase: 'variant-sync',
        message: error.message,
        details: error.details || error.stack
      });

      throw new CreationError(`Failed to sync Shopify variants: ${error.message}`, result);
    }
  }

  buildShopifyProduct(magentoParent, children, translations, status = 'DRAFT', sourceCategoryNames = []) {
    const handle = this.slugify(magentoParent.sku);

    // Extract description from custom attributes
    const description = this.extractCustomAttribute(magentoParent, 'description') ||
                        this.extractCustomAttribute(magentoParent, 'short_description') || '';

    // Extract vendor (brand label) and tags (meta_keywords) from translations
    const vendor = translations.brandLabel || '';
    const metaKeywords = this.extractCustomAttribute(magentoParent, 'meta_keyword') || '';
    const tags = metaKeywords
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0);

    // Determine productType: first try category mapping, then fall back to product_type attribute
    let productType = null;
    if (this.categoryMappingService && sourceCategoryNames.length > 0) {
      productType = this.categoryMappingService.getShopifyProductType(sourceCategoryNames);
      if (productType) {
        logger.debug('Using category mapping for productType', {
          sourceCategories: sourceCategoryNames,
          productType
        });
      }
    }

    if (!productType) {
      productType = this.extractCustomAttribute(magentoParent, 'product_type') || 'Default';
    }

    // Note: Product options are NOT set here - they are created automatically
    // when variants with optionValues are added via productVariantsBulkCreate

    const productInput = {
      title: magentoParent.name,
      handle: handle,
      descriptionHtml: description,
      status: status,
      productType: productType,
      vendor: vendor,
      tags: tags
    };

    logger.debug('Built Shopify product input', {
      title: productInput.title,
      handle: productInput.handle,
      productType: productInput.productType
    });

    return productInput;
  }

  buildProductOptionsForSet(magentoParent, translations) {
    const options = [];

    // Get configurable options from parent
    const configurableOptions = magentoParent.extension_attributes?.configurable_product_options || [];

    for (const option of configurableOptions.slice(0, 3)) { // Shopify limits to 3 options
      const attributeCode = translations.attributes?.[option.attribute_id] || `attribute_${option.attribute_id}`;

      // Collect all unique values for this option
      const values = [];
      for (const v of (option.values || [])) {
        const compositeKey = `${option.attribute_id}_${v.value_index}`;
        const valueData = translations.attributeValues?.[compositeKey];
        if (valueData && valueData.label) {
          values.push({ name: valueData.label });
        }
      }

      if (values.length > 0) {
        options.push({
          name: this.formatOptionName(attributeCode),
          values: values
        });
      }
    }

    logger.debug('Built product options for productSet', {
      optionCount: options.length,
      options: options.map(o => ({ name: o.name, valueCount: o.values.length }))
    });

    return options;
  }

  buildVariantsForSet(children, translations, fileIds = [], skuToFileIndex = {}, allowedOptionNames = null, existingOptionValues = null) {
    const variants = [];
    const skippedVariants = [];

    // Build reverse lookup: attribute_code -> attribute_id
    const codeToId = {};
    for (const [attrId, attrCode] of Object.entries(translations.attributes || {})) {
      codeToId[attrCode] = attrId;
    }

    // Count expected options (how many configurable attributes we have)
    const expectedOptionCount = Object.keys(translations.attributes || {}).length;

    for (const child of children.slice(0, 100)) { // Shopify limits to 100 variants
      const optionValues = [];

      // Extract option values from child's custom attributes
      if (child.custom_attributes) {
        for (const attr of child.custom_attributes) {
          const attributeId = codeToId[attr.attribute_code];

          if (attributeId) {
            const compositeKey = `${attributeId}_${attr.value}`;
            const valueData = translations.attributeValues?.[compositeKey];

            if (valueData && valueData.label) {
              const optionName = this.formatOptionName(attr.attribute_code);
              let valueName = valueData.label;

              // Match to existing target values if available
              if (existingOptionValues && existingOptionValues[optionName]) {
                valueName = this.matchOptionValueToExisting(
                  optionName,
                  valueData.label,
                  existingOptionValues[optionName]
                );
              }

              optionValues.push({
                optionName: optionName,
                name: valueName
              });
            }
          }
        }
      }

      // Only include variants that have option values (limit to 3)
      let limitedOptionValues = optionValues.slice(0, 3);

      // If allowedOptionNames is provided (variant sync mode), filter to only those options
      if (allowedOptionNames) {
        const allowedSet = new Set(allowedOptionNames.map(n => n.toLowerCase()));
        limitedOptionValues = limitedOptionValues.filter(ov =>
          allowedSet.has(ov.optionName.toLowerCase())
        );
      }

      // In variant sync mode, require only the number of options that exist on the target product
      // Otherwise, use the expected option count from source
      const requiredOptions = allowedOptionNames
        ? allowedOptionNames.length
        : Math.min(expectedOptionCount, 3); // Shopify max is 3

      // Skip variants that don't have all required option values
      if (limitedOptionValues.length < requiredOptions) {
        logger.warn('Skipping variant with incomplete options', {
          sku: child.sku,
          optionCount: limitedOptionValues.length,
          requiredOptions,
          options: limitedOptionValues.map(o => `${o.optionName}: ${o.name}`)
        });
        skippedVariants.push(child.sku);
        continue;
      }

      const variant = {
        price: String(child.price || 0),
        optionValues: limitedOptionValues,
        inventoryItem: {
          sku: child.sku,
          tracked: true
        }
      };

      // Add weight if available
      if (child.weight) {
        variant.inventoryItem.measurement = {
          weight: {
            value: child.weight,
            unit: 'KILOGRAMS'
          }
        };
      }

      // Associate file with variant if available
      const fileIndex = skuToFileIndex[child.sku];
      if (fileIndex !== undefined && fileIds[fileIndex]) {
        variant.file = { id: fileIds[fileIndex].id };
        logger.debug('Associated file with variant', {
          sku: child.sku,
          fileId: fileIds[fileIndex].id
        });
      }

      variants.push(variant);
    }

    logger.debug('Built variants for productSet', {
      variantCount: variants.length,
      skippedCount: skippedVariants.length,
      variantsWithFiles: variants.filter(v => v.file).length
    });

    if (skippedVariants.length > 0) {
      logger.warn('Some variants were skipped due to incomplete options', {
        skippedSkus: skippedVariants
      });
    }

    return variants;
  }

  async createVariants(productId, children, translations, defaultVariantId) {
    logger.info('Creating Shopify variants', {
      productId,
      childCount: children.length
    });

    const result = {
      created: [],
      errors: []
    };

    // Build variants from Magento children
    const variants = children.map(child => this.buildShopifyVariant(child, translations));

    // Shopify allows max 100 variants per product
    if (variants.length > 100) {
      logger.warn('Variant count exceeds Shopify limit of 100', { count: variants.length });
      result.errors.push(`Only first 100 variants will be created (${variants.length} found)`);
      variants.splice(100);
    }

    try {
      // Create all variants in one bulk operation
      // The REMOVE_STANDALONE_VARIANT strategy handles removing the default variant
      const createdVariants = await this.shopifyTargetService.createProductVariants(productId, variants);

      result.created = createdVariants.map(v => ({
        id: v.id,
        sku: v.inventoryItem?.sku || v.sku,
        success: true
      }));

      logger.info('Shopify variants created', { count: result.created.length });
    } catch (error) {
      logger.error('Failed to create variants', { error: error.message });
      result.errors.push(error.message);
    }

    return result;
  }

  buildShopifyVariant(magentoChild, translations) {
    // Build option values from configurable attributes
    const optionValues = this.extractVariantOptionValues(magentoChild, translations);

    const variant = {
      price: String(magentoChild.price || 0),
      inventoryItem: {
        sku: magentoChild.sku,
        tracked: true
      },
      inventoryPolicy: 'CONTINUE'
    };

    // Add weight if available (in inventoryItem.measurement)
    if (magentoChild.weight) {
      variant.inventoryItem.measurement = {
        weight: {
          value: magentoChild.weight,
          unit: 'KILOGRAMS'
        }
      };
    }

    // Add option values if this variant has configurable options
    if (optionValues.length > 0) {
      variant.optionValues = optionValues;
    }

    return variant;
  }

  extractVariantOptionValues(child, translations) {
    const optionValues = [];

    // Build reverse lookup: attribute_code -> attribute_id
    const codeToId = {};
    for (const [attrId, attrCode] of Object.entries(translations.attributes || {})) {
      codeToId[attrCode] = attrId;
    }

    // Look through custom attributes for configurable options
    if (child.custom_attributes) {
      for (const attr of child.custom_attributes) {
        const attributeId = codeToId[attr.attribute_code];

        if (attributeId) {
          // Build composite key: "attribute_id_value"
          const compositeKey = `${attributeId}_${attr.value}`;
          const valueData = translations.attributeValues?.[compositeKey];

          if (valueData && valueData.label) {
            optionValues.push({
              optionName: this.formatOptionName(attr.attribute_code),
              name: valueData.label
            });
          }
        }
      }
    }

    // Limit to 3 options (Shopify max)
    return optionValues.slice(0, 3);
  }

  /**
   * @deprecated Use buildFilesInput and pass files to createProductWithVariants instead.
   * The separate image upload via productCreateMedia is deprecated by Shopify.
   */
  async uploadImages(productId, images, parent) {
    logger.warn('uploadImages is deprecated - use buildFilesInput with createProductWithVariants instead');
    const result = {
      uploaded: 0,
      errors: []
    };

    // Collect all images (parent and children)
    const allImages = [];

    // Add parent images
    if (images.parent && images.parent.length > 0) {
      for (const img of images.parent) {
        const imageUrl = this.buildMagentoImageUrl(img.file, parent);
        if (imageUrl) {
          allImages.push({
            url: imageUrl,
            alt: img.label || parent.name,
            position: img.position
          });
        }
      }
    }

    if (allImages.length === 0) {
      logger.info('No images to upload');
      return result;
    }

    // Sort by position
    allImages.sort((a, b) => (a.position || 0) - (b.position || 0));

    try {
      const uploadedMedia = await this.shopifyTargetService.uploadProductImages(productId, allImages);
      result.uploaded = uploadedMedia?.length || 0;

      logger.info('Images uploaded to Shopify', { count: result.uploaded });
    } catch (error) {
      logger.error('Failed to upload images', { error: error.message });
      result.errors.push(error.message);
    }

    return result;
  }

  buildMagentoImageUrl(file, parent) {
    if (!file) return null;

    // If it's already a full URL, return it
    if (file.startsWith('http://') || file.startsWith('https://')) {
      return file;
    }

    // Build URL from Magento source base URL
    const baseUrl = config.source.baseUrl.replace(/\/$/, '');
    return `${baseUrl}/media/catalog/product${file}`;
  }

  /**
   * Build image inputs for the Shopify upload flow.
   * Returns {url, alt, sku} objects to be passed to uploadAndWaitForFiles,
   * plus a mapping from child SKU to file index for variant association.
   * @param {Object} images - Images object from extracted data
   * @param {Object} parent - Parent product data (for alt text fallback)
   * @param {Array} children - Child products array
   * @returns {Object} { inputs: Array of {url, alt, sku}, skuToFileIndex: Object }
   */
  buildImageInputs(images, parent, children) {
    const inputs = [];
    const skuToFileIndex = {}; // Maps child SKU to file index

    // Add parent images first
    if (images.parent && images.parent.length > 0) {
      const sortedImages = [...images.parent].sort((a, b) => (a.position || 0) - (b.position || 0));

      for (const img of sortedImages) {
        const imageUrl = this.buildMagentoImageUrl(img.file, parent);
        if (imageUrl) {
          inputs.push({
            url: imageUrl,
            alt: img.label || parent.name,
            sku: null  // Parent image, not variant-specific
          });
        }
      }
    }

    // Add child/variant images
    if (images.children) {
      for (const [childSku, childImages] of Object.entries(images.children)) {
        if (childImages && childImages.length > 0) {
          // Use first image for each variant
          const img = childImages[0];
          const imageUrl = this.buildMagentoImageUrl(img.file, parent);
          if (imageUrl) {
            skuToFileIndex[childSku] = inputs.length; // Track index before adding
            inputs.push({
              url: imageUrl,
              alt: img.label || childSku,
              sku: childSku  // Track which variant this belongs to
            });
          }
        }
      }
    }

    logger.debug('Built image inputs for upload', {
      count: inputs.length,
      parentImages: images.parent?.length || 0,
      childSkusWithImages: Object.keys(skuToFileIndex).length
    });

    return { inputs, skuToFileIndex };
  }

  extractCustomAttribute(product, attributeCode) {
    if (!product.custom_attributes) return null;

    const attr = product.custom_attributes.find(a => a.attribute_code === attributeCode);
    return attr?.value || null;
  }

  slugify(text) {
    return text
      .toString()
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
  }

  formatOptionName(name) {
    // Capitalize first letter of each word
    return name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Normalize a "unit per pack" value for comparison.
   * Converts "5 pack", "5-pack", "5 Pack", "5-Pack" all to "5-pack" for matching.
   * @param {string} value - The value to normalize
   * @returns {string} Normalized value in lowercase with hyphen format
   */
  normalizeUnitPerPackValue(value) {
    if (typeof value !== 'string') return value;
    // Normalize: lowercase, replace spaces with hyphens, collapse multiple hyphens
    return value
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-');
  }

  /**
   * Match a source option value to an existing target option value.
   * For "Unit Per Pack" option, uses normalization to handle "5 pack" vs "5-pack" differences.
   * @param {string} optionName - The option name (e.g., "Unit Per Pack")
   * @param {string} sourceValue - The value from source (e.g., "5 pack")
   * @param {Array<string>} existingValues - Existing values on target (e.g., ["5-pack", "10-pack"])
   * @returns {string} The matched existing value, or the original source value if no match
   */
  matchOptionValueToExisting(optionName, sourceValue, existingValues) {
    if (!existingValues || existingValues.length === 0) {
      return sourceValue;
    }

    // Check for exact match first
    if (existingValues.includes(sourceValue)) {
      return sourceValue;
    }

    // For "Unit Per Pack" option, use normalized matching
    if (optionName.toLowerCase() === 'unit per pack') {
      const normalizedSource = this.normalizeUnitPerPackValue(sourceValue);

      for (const existingValue of existingValues) {
        const normalizedExisting = this.normalizeUnitPerPackValue(existingValue);
        if (normalizedSource === normalizedExisting) {
          return existingValue; // Return the existing target value
        }
      }
    }

    // No match found, return original
    return sourceValue;
  }
}

module.exports = ShopifyCreationService;
