const logger = require('../../config/logger');
const config = require('../../config');
const SourceService = require('../magento/source.service');
const TargetService = require('../magento/target.service');
const ExtractionService = require('./extraction.service');
const PreparationService = require('./preparation.service');
const CreationService = require('./creation.service');
const GoogleChatService = require('../notification/google-chat.service');
const { validateStoreCodes, normalizeStoreCodes, mergeStoreResults } = require('../../utils/store-scope-helpers');

class OrchestratorService {
  constructor() {
    this.sourceService = new SourceService(
      config.source.baseUrl,
      config.source.token,
      config.api
    );

    this.targetService = new TargetService(
      config.target.baseUrl,
      config.target.token,
      config.api
    );

    // Store target config for creating scoped services
    this.targetConfig = {
      baseUrl: config.target.baseUrl,
      token: config.target.token,
      apiConfig: config.api,
      defaultStoreCodes: config.target.storeCodes
    };

    this.extractionService = new ExtractionService(this.sourceService);
    this.preparationService = new PreparationService(this.targetService);
    this.creationService = new CreationService(this.sourceService, this.targetService);
    this.googleChatService = new GoogleChatService();
  }

  async migrateProduct(sku, options = {}) {
    const migrationStartTime = Date.now();

    // Determine target stores from options or config defaults
    const targetStores = this.resolveTargetStores(options.targetStores);

    logger.info('Starting product migration', { sku, options, targetStores });

    const migrationContext = {
      sku,
      success: false,
      targetStores: targetStores.length > 0 ? targetStores : undefined,
      storeResults: {},
      phases: {
        extraction: { success: false, duration: 0 },
        preparation: { success: false, duration: 0 },
        creation: { success: false, duration: 0 }
      },
      summary: {
        totalDuration: 0,
        childrenMigrated: 0,
        errorsCount: 0,
        warningsCount: 0,
        storesSucceeded: 0,
        storesFailed: 0
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
        : config.migration.overwriteExisting
    };

    try {
      const extractedData = await this.executeExtractionPhase(sku, migrationContext);

      const childSkus = extractedData.children.map(child => child.sku);
      await this.googleChatService.notifyMigrationStart(sku, childSkus);

      const preparedData = await this.executePreparationPhase(extractedData, migrationContext);

      // Use multi-store creation if target stores are specified
      if (targetStores.length > 0) {
        const multiStoreResult = await this.executeMultiStoreCreationPhase(
          extractedData,
          preparedData,
          migrationOptions,
          targetStores,
          migrationContext
        );

        migrationContext.productId = multiStoreResult.parentProductId;
        migrationContext.storeResults = multiStoreResult.storeResults;

        const storeSummary = mergeStoreResults(multiStoreResult.storeResults);
        migrationContext.summary.storesSucceeded = storeSummary.storesSucceeded;
        migrationContext.summary.storesFailed = storeSummary.storesFailed;
        migrationContext.success = storeSummary.allSucceeded;
      } else {
        // Backward compatible: single store creation using default endpoint
        const creationResult = await this.executeCreationPhase(extractedData, preparedData, migrationOptions, migrationContext);
        migrationContext.productId = creationResult.parentProductId;
        migrationContext.success = true;
      }

      migrationContext.summary.totalDuration = Date.now() - migrationStartTime;
      migrationContext.summary.childrenMigrated = migrationContext.phases.creation.childrenCreated || 0;
      migrationContext.summary.errorsCount = migrationContext.errors.length;
      migrationContext.summary.warningsCount = migrationContext.warnings.length;

      logger.info('Product migration completed', {
        sku,
        success: migrationContext.success,
        duration: `${migrationContext.summary.totalDuration}ms`,
        childrenMigrated: migrationContext.summary.childrenMigrated,
        storesSucceeded: migrationContext.summary.storesSucceeded,
        storesFailed: migrationContext.summary.storesFailed
      });

      await this.googleChatService.notifyMigrationEnd(migrationContext);

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

      await this.googleChatService.notifyMigrationEnd(migrationContext);

      return migrationContext;
    }
  }

  resolveTargetStores(optionStores) {
    // Runtime option takes precedence over config default
    if (optionStores && Array.isArray(optionStores) && optionStores.length > 0) {
      const validation = validateStoreCodes(optionStores);
      if (!validation.valid) {
        logger.warn('Invalid store codes provided, using empty list', { errors: validation.errors });
        return [];
      }
      return normalizeStoreCodes(optionStores);
    }

    // Fall back to config default
    return normalizeStoreCodes(this.targetConfig.defaultStoreCodes);
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

  async executePreparationPhase(extractedData, context) {
    const phaseStartTime = Date.now();

    try {
      logger.info('Executing preparation phase');

      const preparedData = await this.preparationService.prepareTarget(extractedData);

      context.phases.preparation.success = true;
      context.phases.preparation.duration = Date.now() - phaseStartTime;

      const attributeMapping = preparedData.attributeMapping || {};
      context.phases.preparation.attributesProcessed = Object.keys(attributeMapping).length;

      let optionsCreated = 0;
      Object.values(attributeMapping).forEach(attr => {
        if (attr.options) {
          optionsCreated += Object.keys(attr.options).length;
        }
      });
      context.phases.preparation.optionsCreated = optionsCreated;

      if (preparedData.warnings && preparedData.warnings.length > 0) {
        context.warnings.push(...preparedData.warnings);
      }

      logger.info('Preparation phase successful', {
        duration: `${context.phases.preparation.duration}ms`,
        attributesProcessed: context.phases.preparation.attributesProcessed
      });

      return preparedData;
    } catch (error) {
      context.phases.preparation.success = false;
      context.phases.preparation.duration = Date.now() - phaseStartTime;

      context.errors.push({
        phase: 'preparation',
        message: error.message,
        details: error.stack
      });

      logger.error('Preparation phase failed', {
        error: error.message,
        duration: `${context.phases.preparation.duration}ms`
      });

      throw error;
    }
  }

  async executeCreationPhase(extractedData, preparedData, options, context) {
    const phaseStartTime = Date.now();

    try {
      logger.info('Executing creation phase', { options });

      const creationResult = await this.creationService.createProducts(
        extractedData,
        preparedData,
        options
      );

      context.phases.creation.success = creationResult.success;
      context.phases.creation.duration = Date.now() - phaseStartTime;
      context.phases.creation.childrenCreated = creationResult.createdChildren.filter(
        c => c.success
      ).length;
      context.phases.creation.childrenFailed = creationResult.createdChildren.filter(
        c => !c.success
      ).length;
      context.phases.creation.imagesUploaded = creationResult.imagesUploaded || 0;

      if (creationResult.warnings && creationResult.warnings.length > 0) {
        context.warnings.push(...creationResult.warnings);
      }

      if (creationResult.errors && creationResult.errors.length > 0) {
        context.errors.push(...creationResult.errors);
      }

      logger.info('Creation phase successful', {
        duration: `${context.phases.creation.duration}ms`,
        childrenCreated: context.phases.creation.childrenCreated,
        imagesUploaded: context.phases.creation.imagesUploaded
      });

      return creationResult;
    } catch (error) {
      context.phases.creation.success = false;
      context.phases.creation.duration = Date.now() - phaseStartTime;

      context.errors.push({
        phase: 'creation',
        message: error.message,
        details: error.details || error.stack
      });

      logger.error('Creation phase failed', {
        error: error.message,
        duration: `${context.phases.creation.duration}ms`
      });

      throw error;
    }
  }

  async executeMultiStoreCreationPhase(extractedData, preparedData, options, targetStores, context) {
    const phaseStartTime = Date.now();
    const storeResults = {};
    let parentProductId = null;
    let isFirstStore = true;

    logger.info('Executing multi-store creation phase', {
      sku: extractedData.parent.sku,
      targetStores
    });

    // Fetch store-to-website mapping and collect unique website IDs
    const storeWebsiteMapping = await this.targetService.getStoreWebsiteMapping();
    const websiteIds = [...new Set(
      targetStores.map(store => storeWebsiteMapping[store]).filter(Boolean)
    )];

    logger.info('Resolved website IDs for target stores', {
      targetStores,
      websiteIds,
      storeWebsiteMapping
    });

    for (const storeCode of targetStores) {
      if (isFirstStore) {
        // First store: Use GLOBAL endpoint (non-scoped) with all website_ids
        // This ensures products are assigned to all target websites at creation time
        logger.info('Creating product globally with website assignment (full creation)', {
          sku: extractedData.parent.sku,
          storeCode,
          websiteIds
        });

        try {
          // Use non-scoped (global) creation service for first store
          const creationResult = await this.creationService.createProducts(
            extractedData,
            preparedData,
            { ...options, websiteIds }
          );

          parentProductId = creationResult.parentProductId;

          storeResults[storeCode] = {
            success: true,
            productId: creationResult.parentProductId,
            childrenCreated: creationResult.createdChildren.filter(c => c.success).length,
            imagesUploaded: creationResult.imagesUploaded || 0,
            mode: 'full-creation'
          };

          // Update context with creation phase info
          context.phases.creation.childrenCreated = storeResults[storeCode].childrenCreated;
          context.phases.creation.imagesUploaded = storeResults[storeCode].imagesUploaded;

          if (creationResult.warnings && creationResult.warnings.length > 0) {
            context.warnings.push(...creationResult.warnings.map(w => ({ ...w, storeCode })));
          }

          logger.info('First store creation successful', { sku: extractedData.parent.sku, storeCode });
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
          // because the global resources (products, options, links) weren't created
          if (!config.errorHandling.continueOnError) {
            throw error;
          }
          // If continueOnError is true, try next store as first store
          // (isFirstStore remains true)
        }
      } else {
        // Subsequent stores: Only update store-scoped attributes
        // Create scoped services for this store
        const scopedTargetService = this.targetService.createScopedInstance(storeCode);
        const scopedCreationService = new CreationService(this.sourceService, scopedTargetService);

        logger.info('Updating product for subsequent store (attributes only)', {
          sku: extractedData.parent.sku,
          storeCode
        });

        try {
          const updateResult = await scopedCreationService.updateProductsForStore(
            extractedData,
            preparedData
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

          logger.info('Store update successful', { sku: extractedData.parent.sku, storeCode });
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

    context.phases.creation.success = Object.values(storeResults).some(r => r.success);
    context.phases.creation.duration = Date.now() - phaseStartTime;

    logger.info('Multi-store creation phase completed', {
      sku: extractedData.parent.sku,
      duration: `${context.phases.creation.duration}ms`,
      storeResults: Object.keys(storeResults).map(s => ({
        store: s,
        success: storeResults[s].success,
        mode: storeResults[s].mode
      }))
    });

    return {
      parentProductId,
      storeResults
    };
  }

  async testConnections() {
    logger.info('Testing Magento connections');

    const sourceConnection = await this.sourceService.testConnection();
    const targetConnection = await this.targetService.testConnection();

    return {
      source: sourceConnection,
      target: targetConnection
    };
  }
}

module.exports = OrchestratorService;
