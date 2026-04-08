const logger = require('../../config/logger');
const config = require('../../config');
const SourceService = require('../magento/source.service');
const TargetService = require('../magento/target.service');
const ExtractionService = require('./extraction.service');
const PreparationService = require('./preparation.service');
const CreationService = require('./creation.service');
const CategoryMappingService = require('../category-mapping.service');
const NotificationService = require('../notification/notification.service');
const StandaloneExtractionService = require('./standalone-extraction.service');
const StandaloneMagentoCreationService = require('./standalone-magento-creation.service');
const { ExtractionError } = require('../../utils/error-handler');
const ContentGenerationService = require('../ai/content-generation.service');
const aiPromptRepo = require('../../database/repositories/ai-prompt.repository');

class OrchestratorService {
  constructor() {
    this.sourceService = new SourceService(
      config.source.baseUrl,
      config.source.token,
      config.api
    );

    this.categoryMappingService = new CategoryMappingService();
    this.extractionService = new ExtractionService(this.sourceService);
    this.standaloneExtractionService = new StandaloneExtractionService(this.sourceService);
    this.notificationService = new NotificationService();
    this.contentGenerationService = new ContentGenerationService();
  }

  /**
   * Get a TargetService instance for a named Magento store.
   * @param {string} storeName - The store name key from config.magentoStores (e.g., 'ejuices')
   * @returns {TargetService}
   */
  getTargetService(storeName) {
    return TargetService.getInstanceForStore(storeName);
  }

  async migrateProduct(sku, options = {}) {
    const migrationStartTime = Date.now();

    const targetMagentoStores = options.targetMagentoStores;

    if (!targetMagentoStores || !Array.isArray(targetMagentoStores) || targetMagentoStores.length === 0) {
      throw new Error('options.targetMagentoStores is required and must be a non-empty array of Magento instance names');
    }

    logger.info('Starting product migration', { sku, options, targetMagentoStores });

    const migrationContext = {
      sku,
      success: false,
      targetMagentoStores,
      instanceResults: {},
      phases: {
        extraction: { success: false, duration: 0 },
      },
      summary: {
        totalDuration: 0,
        childrenMigrated: 0,
        errorsCount: 0,
        warningsCount: 0,
        instancesSucceeded: 0,
        instancesFailed: 0
      },
      warnings: [],
      errors: []
    };

    const migrationOptions = {
      includeImages: options.includeImages !== undefined
        ? options.includeImages
        : config.migration.includeImages,
      createMissingAttributes: options.createMissingAttributes !== undefined
        ? options.createMissingAttributes
        : config.migration.createMissingAttributes,
      overwriteExisting: options.overwriteExisting !== undefined
        ? options.overwriteExisting
        : config.migration.overwriteExisting,
      productEnabled: options.productEnabled !== undefined
        ? options.productEnabled
        : true
    };

    try {
      // TYPE PROBE — must happen before any extraction call
      // ExtractionService throws for non-configurable products
      const sourceProduct = await this.sourceService.getProductBySku(sku);
      const productType = this.classifyProductType(sourceProduct);

      if (productType === 'configurable') {
        // ---- EXISTING CONFIGURABLE PATH (unchanged) ----
        const extractedData = await this.executeExtractionPhase(sku, migrationContext);

        const mergedPrompts = await this._resolvePrompts(targetMagentoStores, options.storePrompts);

        const generatedContent = Object.keys(mergedPrompts).length > 0
          ? await this.executeAIGenerationPhase(extractedData, mergedPrompts, migrationContext)
          : {};

        const childSkus = extractedData.children.map(child => child.sku);
        await this.notificationService.notifyMigrationStart(sku, childSkus, targetMagentoStores);

        for (const storeName of targetMagentoStores) {
          try {
            const storeExtractedData = generatedContent[storeName]
              ? this.applyGeneratedContent(extractedData, generatedContent[storeName])
              : extractedData;

            const instanceResult = await this.migrateToInstance(
              storeName,
              storeExtractedData,
              migrationOptions,
              migrationContext
            );
            instanceResult.aiContentApplied = !!generatedContent[storeName];
            migrationContext.instanceResults[storeName] = instanceResult;
          } catch (error) {
            logger.error('Migration to instance failed', { sku, storeName, error: error.message });
            migrationContext.instanceResults[storeName] = {
              success: false,
              error: error.message,
              storeResults: {}
            };
            migrationContext.errors.push({
              phase: 'instance-migration',
              storeName,
              message: error.message,
              details: error.stack
            });
            if (!config.errorHandling.continueOnError) throw error;
          }
        }
      } else {
        // ---- STANDALONE SIMPLE PATH ----
        const extractedData = await this.executeStandaloneExtractionPhase(sku, sourceProduct, migrationContext);

        const mergedPrompts = await this._resolvePrompts(targetMagentoStores, options.storePrompts);

        const generatedContent = Object.keys(mergedPrompts).length > 0
          ? await this.executeAIGenerationPhase(extractedData, mergedPrompts, migrationContext)
          : {};

        const childSkus = extractedData.children.map(c => c.sku); // always []
        await this.notificationService.notifyMigrationStart(sku, childSkus, targetMagentoStores);

        for (const storeName of targetMagentoStores) {
          try {
            const storeExtractedData = generatedContent[storeName]
              ? this.applyGeneratedContent(extractedData, generatedContent[storeName])
              : extractedData;

            const instanceResult = await this.migrateStandaloneToInstance(
              sku,
              storeExtractedData,
              storeName,
              migrationOptions
            );
            instanceResult.aiContentApplied = !!generatedContent[storeName];
            migrationContext.instanceResults[storeName] = instanceResult;

            if (!instanceResult.success) {
              migrationContext.errors.push({
                phase: 'instance-migration',
                storeName,
                message: instanceResult.error || 'Standalone migration failed'
              });
              if (!config.errorHandling.continueOnError) break;
            }
          } catch (error) {
            logger.error('Standalone migration to instance failed', { sku, storeName, error: error.message });
            migrationContext.instanceResults[storeName] = {
              success: false,
              error: error.message,
              storeResults: {}
            };
            migrationContext.errors.push({
              phase: 'instance-migration',
              storeName,
              message: error.message,
              details: error.stack
            });
            if (!config.errorHandling.continueOnError) throw error;
          }
        }
      }

      // Compute summary (shared between configurable and standalone)
      const instanceNames = Object.keys(migrationContext.instanceResults);
      const succeeded = instanceNames.filter(n => migrationContext.instanceResults[n].success);
      const failed = instanceNames.filter(n => !migrationContext.instanceResults[n].success);

      migrationContext.summary.instancesSucceeded = succeeded.length;
      migrationContext.summary.instancesFailed = failed.length;
      migrationContext.success = failed.length === 0 && succeeded.length > 0;
      migrationContext.summary.totalDuration = Date.now() - migrationStartTime;
      migrationContext.summary.errorsCount = migrationContext.errors.length;
      migrationContext.summary.warningsCount = migrationContext.warnings.length;

      let totalChildrenMigrated = 0;
      for (const result of Object.values(migrationContext.instanceResults)) {
        if (result.childrenCreated) totalChildrenMigrated += result.childrenCreated;
      }
      migrationContext.summary.childrenMigrated = totalChildrenMigrated;

      logger.info('Product migration completed', {
        sku,
        success: migrationContext.success,
        duration: `${migrationContext.summary.totalDuration}ms`,
        instancesSucceeded: migrationContext.summary.instancesSucceeded,
        instancesFailed: migrationContext.summary.instancesFailed
      });

      await this.notificationService.notifyMigrationEnd(migrationContext);

      return migrationContext;
    } catch (error) {
      migrationContext.success = false;
      migrationContext.summary.totalDuration = Date.now() - migrationStartTime;
      migrationContext.summary.errorsCount = migrationContext.errors.length;
      migrationContext.summary.warningsCount = migrationContext.warnings.length;

      migrationContext.errors.push({
        phase: 'orchestration',
        message: error.message,
        details: error.stack
      });

      logger.error('Product migration failed', {
        sku,
        error: error.message,
        duration: `${migrationContext.summary.totalDuration}ms`
      });

      await this.notificationService.notifyMigrationEnd(migrationContext);

      return migrationContext;
    }
  }

  /**
   * Determine product type from a source product object.
   * @throws {ExtractionError} for unsupported or ambiguous types
   * @returns {'configurable'|'standalone-simple'}
   */
  classifyProductType(product) {
    if (!product || !product.type_id) {
      throw new ExtractionError(`Product type could not be determined for SKU: ${product?.sku}`);
    }

    if (product.type_id === 'configurable') {
      return 'configurable';
    }

    if (product.type_id === 'simple') {
      if (product.visibility === 1) {
        throw new ExtractionError(
          `Product ${product.sku} is a configurable variant (visibility=1). Migrate its parent configurable instead.`
        );
      }
      return 'standalone-simple';
    }

    throw new ExtractionError(`Unsupported product type: ${product.type_id} for SKU: ${product.sku}`);
  }

  /**
   * Migrate a product to a single Magento instance.
   * Handles preparation, store view discovery, and creation/variant-sync for all
   * store views within that instance.
   *
   * @param {string} storeName - The instance name key from config.magentoStores
   * @param {Object} extractedData - Data extracted from source (shared across instances)
   * @param {Object} options - Migration options
   * @param {Object} context - The top-level migrationContext for logging/errors
   * @returns {Object} Instance result
   */
  async migrateToInstance(storeName, extractedData, options, context) {
    const sku = extractedData.parent.sku;

    logger.info('Migrating product to instance', { sku, storeName });

    const targetService = this.getTargetService(storeName);
    const preparationService = new PreparationService(targetService, this.categoryMappingService);
    const creationService = new CreationService(this.sourceService, targetService);

    // Run preparation phase for this instance
    const preparedData = await preparationService.prepareTarget(extractedData);

    // Discover store views within this instance
    const storeWebsiteMapping = await targetService.getStoreWebsiteMapping();
    const storeViews = Object.keys(storeWebsiteMapping);
    const websiteIds = [...new Set(Object.values(storeWebsiteMapping).filter(Boolean))];

    logger.info('Discovered store views for instance', {
      storeName,
      storeViews,
      websiteIds
    });

    // Check if product already exists on this instance
    const existingParent = await targetService.getProductBySku(sku);
    const isConfigurable = extractedData.parent.type_id === 'configurable' && extractedData.children.length > 0;

    if (existingParent && isConfigurable) {
      // Parent exists - check for missing variants
      const existingChildren = await targetService.getConfigurableChildren(sku);
      const existingChildSkus = existingChildren.map(c => c.sku);
      const missingChildren = extractedData.children.filter(c => !existingChildSkus.includes(c.sku));

      logger.info('Auto-detected existing product on instance', {
        sku,
        storeName,
        existingVariants: existingChildSkus.length,
        sourceVariants: extractedData.children.length,
        missingVariants: missingChildren.length
      });

      if (missingChildren.length === 0) {
        logger.info('All variants already exist on instance, skipping', { sku, storeName });
        return {
          success: true,
          mode: 'no-action',
          message: 'All variants already exist on target instance',
          productId: existingParent.id,
          childrenCreated: 0,
          storeResults: {}
        };
      }

      // Sync missing variants across all store views in this instance
      const syncResult = await this.executeInstanceMultiStoreVariantSync(
        targetService,
        creationService,
        extractedData,
        preparedData,
        existingChildSkus,
        options,
        storeViews,
        websiteIds,
        context
      );

      return {
        success: Object.values(syncResult.storeResults).some(r => r.success),
        mode: 'variant-sync',
        productId: existingParent.id,
        childrenCreated: syncResult.childrenCreated || 0,
        storeResults: syncResult.storeResults
      };
    }

    // Product doesn't exist - perform full creation across all store views
    const creationResult = await this.executeInstanceMultiStoreCreation(
      targetService,
      creationService,
      extractedData,
      preparedData,
      options,
      storeViews,
      websiteIds,
      context
    );

    return {
      success: Object.values(creationResult.storeResults).some(r => r.success),
      mode: 'full-creation',
      productId: creationResult.parentProductId,
      childrenCreated: creationResult.childrenCreated || 0,
      storeResults: creationResult.storeResults
    };
  }

  /**
   * Create a product across all store views within ONE Magento instance.
   * The first store view gets full creation with global endpoint + websiteIds.
   * Subsequent store views get store-scoped attribute updates only.
   */
  async executeInstanceMultiStoreCreation(
    targetService,
    creationService,
    extractedData,
    preparedData,
    options,
    storeViews,
    websiteIds,
    context
  ) {
    const storeResults = {};
    let parentProductId = null;
    let isFirstStore = true;
    let childrenCreated = 0;

    logger.info('Executing instance multi-store creation', {
      sku: extractedData.parent.sku,
      storeViews,
      websiteIds
    });

    for (const storeCode of storeViews) {
      if (isFirstStore) {
        // First store view: Use GLOBAL endpoint with all website_ids
        logger.info('Creating product globally with website assignment (full creation)', {
          sku: extractedData.parent.sku,
          storeCode,
          websiteIds
        });

        try {
          const creationResult = await creationService.createProducts(
            extractedData,
            preparedData,
            { ...options, websiteIds }
          );

          parentProductId = creationResult.parentProductId;
          childrenCreated = creationResult.createdChildren.filter(c => c.success).length;

          storeResults[storeCode] = {
            success: true,
            productId: creationResult.parentProductId,
            childrenCreated,
            imagesUploaded: creationResult.imagesUploaded || 0,
            mode: 'full-creation'
          };

          if (creationResult.warnings && creationResult.warnings.length > 0) {
            context.warnings.push(...creationResult.warnings.map(w => ({ ...w, storeCode })));
          }

          logger.info('First store creation successful', {
            sku: extractedData.parent.sku,
            storeCode
          });
          isFirstStore = false;
        } catch (error) {
          logger.error('First store creation failed', {
            sku: extractedData.parent.sku,
            storeCode,
            error: error.message
          });

          storeResults[storeCode] = {
            success: false,
            error: error.message,
            mode: 'full-creation'
          };

          context.errors.push({
            phase: 'creation',
            storeCode,
            message: error.message,
            details: error.details || error.stack
          });

          // If first store fails, we can't proceed with other stores
          if (!config.errorHandling.continueOnError) {
            throw error;
          }
          // If continueOnError is true, try next store as first store
          // (isFirstStore remains true)
        }
      } else {
        // Subsequent stores: Only update store-scoped attributes
        const scopedTargetService = targetService.createScopedInstance(storeCode);
        const scopedCreationService = new CreationService(this.sourceService, scopedTargetService);

        logger.info('Updating product for subsequent store (attributes only)', {
          sku: extractedData.parent.sku,
          storeCode
        });

        try {
          const updateResult = await scopedCreationService.updateProductsForStore(
            extractedData,
            preparedData,
            options
          );

          storeResults[storeCode] = {
            success: true,
            productId: parentProductId,
            childrenUpdated: updateResult.updatedChildren.filter(c => c.success).length,
            mode: 'store-update'
          };

          if (updateResult.warnings && updateResult.warnings.length > 0) {
            context.warnings.push(...updateResult.warnings.map(w => ({ ...w, storeCode })));
          }

          logger.info('Store update successful', {
            sku: extractedData.parent.sku,
            storeCode
          });
        } catch (error) {
          logger.error('Store update failed', {
            sku: extractedData.parent.sku,
            storeCode,
            error: error.message
          });

          storeResults[storeCode] = {
            success: false,
            error: error.message,
            mode: 'store-update'
          };

          context.errors.push({
            phase: 'store-update',
            storeCode,
            message: error.message,
            details: error.details || error.stack
          });

          if (!config.errorHandling.continueOnError) {
            throw error;
          }
        }
      }
    }

    logger.info('Instance multi-store creation completed', {
      sku: extractedData.parent.sku,
      storeResults: Object.keys(storeResults).map(s => ({
        store: s,
        success: storeResults[s].success,
        mode: storeResults[s].mode
      }))
    });

    return {
      parentProductId,
      childrenCreated,
      storeResults
    };
  }

  /**
   * Sync missing variants across all store views within ONE Magento instance.
   * Same pattern as executeInstanceMultiStoreCreation but for variant sync.
   */
  async executeInstanceMultiStoreVariantSync(
    targetService,
    creationService,
    extractedData,
    preparedData,
    existingChildSkus,
    options,
    storeViews,
    websiteIds,
    context
  ) {
    const storeResults = {};
    let isFirstStore = true;
    let childrenCreated = 0;

    logger.info('Executing instance multi-store variant sync', {
      sku: extractedData.parent.sku,
      storeViews,
      existingChildren: existingChildSkus.length
    });

    for (const storeCode of storeViews) {
      if (isFirstStore) {
        // First store view: Use GLOBAL endpoint with all website_ids
        logger.info('Syncing missing variants globally with website assignment', {
          sku: extractedData.parent.sku,
          storeCode,
          websiteIds
        });

        try {
          const syncResult = await creationService.syncMissingVariants(
            extractedData,
            preparedData,
            existingChildSkus,
            { ...options, websiteIds }
          );

          childrenCreated = syncResult.childrenCreated;

          storeResults[storeCode] = {
            success: true,
            childrenCreated: syncResult.childrenCreated,
            childrenSkipped: syncResult.childrenSkipped,
            imagesUploaded: syncResult.imagesUploaded || 0,
            mode: 'variant-sync'
          };

          if (syncResult.warnings && syncResult.warnings.length > 0) {
            context.warnings.push(...syncResult.warnings.map(w => ({ ...w, storeCode })));
          }

          logger.info('First store variant sync successful', {
            sku: extractedData.parent.sku,
            storeCode,
            childrenCreated: syncResult.childrenCreated
          });
          isFirstStore = false;
        } catch (error) {
          logger.error('First store variant sync failed', {
            sku: extractedData.parent.sku,
            storeCode,
            error: error.message
          });

          storeResults[storeCode] = {
            success: false,
            error: error.message,
            mode: 'variant-sync'
          };

          context.errors.push({
            phase: 'variant-sync',
            storeCode,
            message: error.message,
            details: error.details || error.stack
          });

          if (!config.errorHandling.continueOnError) {
            throw error;
          }
        }
      } else {
        // Subsequent stores: Only update store-scoped attributes for newly created children
        const scopedTargetService = targetService.createScopedInstance(storeCode);
        const scopedCreationService = new CreationService(this.sourceService, scopedTargetService);

        // Filter to only include newly created children (not the existing ones)
        const newChildren = extractedData.children.filter(c => !existingChildSkus.includes(c.sku));
        const filteredExtractedData = {
          ...extractedData,
          children: newChildren
        };

        logger.info('Updating newly created variants for subsequent store', {
          sku: extractedData.parent.sku,
          storeCode,
          newChildrenCount: newChildren.length
        });

        try {
          const updateResult = await scopedCreationService.updateProductsForStore(
            filteredExtractedData,
            preparedData,
            options
          );

          storeResults[storeCode] = {
            success: true,
            childrenUpdated: updateResult.updatedChildren.filter(c => c.success).length,
            mode: 'store-update'
          };

          if (updateResult.warnings && updateResult.warnings.length > 0) {
            context.warnings.push(...updateResult.warnings.map(w => ({ ...w, storeCode })));
          }

          logger.info('Store update successful', {
            sku: extractedData.parent.sku,
            storeCode
          });
        } catch (error) {
          logger.error('Store update failed', {
            sku: extractedData.parent.sku,
            storeCode,
            error: error.message
          });

          storeResults[storeCode] = {
            success: false,
            error: error.message,
            mode: 'store-update'
          };

          context.errors.push({
            phase: 'store-update',
            storeCode,
            message: error.message,
            details: error.details || error.stack
          });

          if (!config.errorHandling.continueOnError) {
            throw error;
          }
        }
      }
    }

    logger.info('Instance multi-store variant sync completed', {
      sku: extractedData.parent.sku,
      storeResults: Object.keys(storeResults).map(s => ({
        store: s,
        success: storeResults[s].success,
        mode: storeResults[s].mode
      }))
    });

    return {
      childrenCreated,
      storeResults
    };
  }

  async executeExtractionPhase(sku, context) {
    const phaseStartTime = Date.now();

    try {
      logger.info('Executing extraction phase', { sku });

      const extractedData = await this.extractionService.extractProduct(sku);

      context.phases.extraction.success = true;
      context.phases.extraction.duration = Date.now() - phaseStartTime;
      context.phases.extraction.childrenFound = extractedData.children.length;

      logger.info('Extraction phase successful', {
        sku,
        duration: `${context.phases.extraction.duration}ms`,
        childrenFound: extractedData.children.length
      });

      return extractedData;
    } catch (error) {
      context.phases.extraction.success = false;
      context.phases.extraction.duration = Date.now() - phaseStartTime;

      context.errors.push({
        phase: 'extraction',
        message: error.message,
        details: error.stack
      });

      logger.error('Extraction phase failed', {
        sku,
        error: error.message,
        duration: `${context.phases.extraction.duration}ms`
      });

      throw error;
    }
  }

  async executeStandaloneExtractionPhase(sku, sourceProduct, context) {
    const phaseStartTime = Date.now();

    try {
      logger.info('Executing standalone extraction phase', { sku });

      const extractedData = await this.standaloneExtractionService.extractProduct(sku, sourceProduct);

      context.phases.extraction.success = true;
      context.phases.extraction.duration = Date.now() - phaseStartTime;
      context.phases.extraction.childrenFound = 0; // always 0 for standalone

      logger.info('Standalone extraction phase successful', {
        sku,
        duration: `${context.phases.extraction.duration}ms`
      });

      return extractedData;
    } catch (error) {
      context.phases.extraction.success = false;
      context.phases.extraction.duration = Date.now() - phaseStartTime;

      context.errors.push({
        phase: 'extraction',
        message: error.message,
        details: error.stack
      });

      logger.error('Standalone extraction phase failed', {
        sku,
        error: error.message,
        duration: `${context.phases.extraction.duration}ms`
      });

      throw error;
    }
  }

  /**
   * Migrate a standalone simple product to a single Magento instance.
   */
  async migrateStandaloneToInstance(sku, extractedData, storeName, migrationOptions) {
    logger.info('Migrating standalone product to instance', { sku, storeName });

    const targetService = this.getTargetService(storeName);
    const preparationService = new PreparationService(targetService, this.categoryMappingService);
    const creationService = new StandaloneMagentoCreationService(this.sourceService, targetService);

    // Derive website IDs — same pattern as migrateToInstance
    const storeWebsiteMapping = await targetService.getStoreWebsiteMapping();
    const storeViews = Object.keys(storeWebsiteMapping);
    const websiteIds = [...new Set(Object.values(storeWebsiteMapping).filter(Boolean))];

    logger.info('Discovered store views for standalone migration', { storeName, storeViews, websiteIds });

    // Existence check — fail if product already exists (update not yet supported)
    const existingProduct = await targetService.getProductBySku(sku);
    if (existingProduct && !migrationOptions.overwriteExisting) {
      logger.warn('Standalone product already exists on target, skipping', { sku, storeName });
      return {
        success: false,
        mode: 'error',
        error: `Product ${sku} already exists on target ${storeName}.`,
        storeResults: {}
      };
    }

    // Prepare target (reuse existing prepareTarget — compatible with standalone data)
    const preparedData = await preparationService.prepareTarget(extractedData);

    // Create product across all store views
    const creationResult = await creationService.createProduct(
      extractedData,
      preparedData,
      storeViews,
      websiteIds,
      migrationOptions
    );

    return {
      success: Object.values(creationResult.storeResults).some(r => r.success),
      mode: 'standalone-creation',
      productId: creationResult.parentProductId,
      childrenCreated: 0,
      storeResults: creationResult.storeResults
    };
  }

  /**
   * Create a copy of extractedData with AI-generated title and description
   * applied to the parent. Does not mutate the original.
   */
  applyGeneratedContent(extractedData, content) {
    const clonedCustomAttributes = (extractedData.parent.custom_attributes || [])
      .map(attr => ({ ...attr }));

    const descAttr = clonedCustomAttributes.find(a => a.attribute_code === 'description');
    if (descAttr) {
      descAttr.value = content.description;
    } else {
      clonedCustomAttributes.push({
        attribute_code: 'description',
        value: content.description
      });
    }

    return {
      ...extractedData,
      parent: {
        ...extractedData.parent,
        name: content.title,
        custom_attributes: clonedCustomAttributes
      }
    };
  }

  async _resolvePrompts(targetStores, requestStorePrompts) {
    const requestPrompts = requestStorePrompts || {};
    const dbPrompts = {};

    for (const storeName of targetStores) {
      if (!requestPrompts[storeName]) {
        const dbPrompt = await aiPromptRepo.findActiveByStore(storeName);
        if (dbPrompt && dbPrompt.prompt_text) {
          dbPrompts[storeName] = { prompt: dbPrompt.prompt_text };
        }
      }
    }

    return { ...dbPrompts, ...requestPrompts };
  }

  async executeAIGenerationPhase(extractedData, storePrompts, context) {
    const phaseStartTime = Date.now();

    try {
      logger.info('Executing AI content generation phase', { sku: extractedData.parent.sku });

      const generatedContent = await this.contentGenerationService.generateForStores(
        extractedData,
        storePrompts
      );

      const storesGenerated = Object.keys(generatedContent).length;

      context.phases.aiGeneration = {
        success: true,
        duration: Date.now() - phaseStartTime,
        storesGenerated
      };

      logger.info('AI content generation phase completed', {
        sku: extractedData.parent.sku,
        storesGenerated,
        duration: `${context.phases.aiGeneration.duration}ms`
      });

      return generatedContent;
    } catch (error) {
      context.phases.aiGeneration = {
        success: false,
        duration: Date.now() - phaseStartTime,
        storesGenerated: 0
      };

      context.errors.push({
        phase: 'ai-generation',
        message: error.message,
        details: error.stack
      });

      logger.error('AI content generation phase failed', {
        sku: extractedData.parent.sku,
        error: error.message,
        duration: `${context.phases.aiGeneration.duration}ms`
      });

      throw error;
    }
  }

  async testConnections() {
    logger.info('Testing Magento connections');

    const sourceConnection = await this.sourceService.testConnection();

    const targets = {};
    const storeNames = Object.keys(config.magentoStores);

    for (const storeName of storeNames) {
      try {
        const targetService = this.getTargetService(storeName);
        targets[storeName] = await targetService.testConnection();
      } catch (error) {
        logger.error('Failed to test connection for store', {
          storeName,
          error: error.message
        });
        targets[storeName] = {
          success: false,
          error: error.message
        };
      }
    }

    return {
      source: sourceConnection,
      targets
    };
  }
}

module.exports = OrchestratorService;
