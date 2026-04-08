const logger = require('../../config/logger');
const config = require('../../config');
const SourceService = require('../magento/source.service');
const ShopifyTargetService = require('../shopify/shopify-target.service');
const ExtractionService = require('./extraction.service');
const ShopifyCreationService = require('./shopify-creation.service');
const CategoryMappingService = require('../category-mapping.service');
const NotificationService = require('../notification/notification.service');
const StandaloneExtractionService = require('./standalone-extraction.service');
const ContentGenerationService = require('../ai/content-generation.service');
const aiPromptRepo = require('../../database/repositories/ai-prompt.repository');
const { ExtractionError } = require('../../utils/error-handler');

class ShopifyOrchestratorService {
  constructor() {
    // Source is always Magento
    this.sourceService = new SourceService(
      config.source.baseUrl,
      config.source.token,
      config.api
    );

    this.categoryMappingService = new CategoryMappingService();
    this.extractionService = new ExtractionService(this.sourceService);
    this.notificationService = new NotificationService();
    this.standaloneExtractionService = new StandaloneExtractionService(this.sourceService);
    this.contentGenerationService = new ContentGenerationService();

    // Store Shopify config for creating target services
    this.shopifyConfig = {
      apiVersion: config.shopify.apiVersion,
      defaultStore: config.shopify.defaultStore,
      stores: config.shopify.stores
    };
  }

  getShopifyTargetService(storeName) {
    // Use provided store name, or fall back to configured default
    const targetStore = storeName || this.shopifyConfig.defaultStore;

    if (targetStore && this.shopifyConfig.stores[targetStore]) {
      const storeConfig = this.shopifyConfig.stores[targetStore];
      return new ShopifyTargetService(
        storeConfig.url,
        storeConfig.token,
        { apiVersion: this.shopifyConfig.apiVersion, ...config.api }
      );
    }

    // List available stores in error message
    const available = Object.keys(this.shopifyConfig.stores);
    throw new Error(
      `Shopify store '${targetStore || 'default'}' not configured. ` +
      `Available stores: ${available.length ? available.join(', ') : 'none'}`
    );
  }

  async migrateProduct(sku, options = {}) {
    const migrationStartTime = Date.now();
    const shopifyStore = options.shopifyStore || 'default';

    logger.info('Starting Magento to Shopify migration', { sku, shopifyStore, options });

    const migrationContext = {
      sku,
      success: false,
      targetPlatform: 'shopify',
      shopifyStore,
      targetStores: [shopifyStore],
      shopifyProductId: null,
      shopifyProductUrl: null,
      shopifyHandle: null,
      phases: {
        extraction: { success: false, duration: 0 },
        creation: { success: false, duration: 0 }
      },
      summary: {
        totalDuration: 0,
        variantsMigrated: 0,
        imagesUploaded: 0,
        errorsCount: 0,
        warningsCount: 0
      },
      warnings: [],
      errors: []
    };

    const migrationOptions = {
      includeImages: options.includeImages !== undefined
        ? options.includeImages
        : config.migration.includeImages,
      productStatus: options.productStatus || 'DRAFT',
      shopifyStore: options.shopifyStore
    };

    try {
      // TYPE PROBE — must happen before any extraction call
      const sourceProduct = await this.sourceService.getProductBySku(sku);
      const productType = this.classifyProductType(sourceProduct);

      if (productType === 'configurable') {
        // ---- EXISTING CONFIGURABLE PATH ----
        const extractedData = await this.executeExtractionPhase(sku, migrationContext);

        // AI content generation (DB prompts + request prompts)
        const mergedPrompts = await this._resolvePrompts([shopifyStore], options.storePrompts);
        const generatedContent = Object.keys(mergedPrompts).length > 0
          ? await this._executeAIGenerationPhase(extractedData, mergedPrompts, migrationContext)
          : {};

        if (generatedContent[shopifyStore]) {
          this._applyGeneratedContent(extractedData, generatedContent[shopifyStore]);
        }

        const childSkus = extractedData.children.map(child => child.sku);
        await this.notificationService.notifyMigrationStart(sku, childSkus, [shopifyStore]);

        const shopifyTargetService = this.getShopifyTargetService(options.shopifyStore);
        const creationService = new ShopifyCreationService(this.sourceService, shopifyTargetService, this.categoryMappingService, options.shopifyStore);

        const hasChildren = extractedData.children && extractedData.children.length > 0;
        let existingProduct = null;

        if (hasChildren) {
          const childSkusForCheck = extractedData.children.map(c => c.sku);
          const existingVariants = await shopifyTargetService.getVariantsBySkus(childSkusForCheck);
          if (existingVariants.length > 0) {
            const productId = existingVariants[0].product.id;
            existingProduct = {
              productId,
              variants: existingVariants.map(v => ({ id: v.id, sku: v.sku, price: v.price }))
            };
          }
        }

        if (existingProduct && hasChildren) {
          const existingSkus = existingProduct.variants.map(v => v.sku).filter(Boolean);
          const missingChildren = extractedData.children.filter(c => !existingSkus.includes(c.sku));

          if (missingChildren.length === 0) {
            migrationContext.success = true;
            migrationContext.shopifyProductId = existingProduct.productId;
            migrationContext.shopifyProductUrl = shopifyTargetService.buildAdminUrl(existingProduct.productId);
            migrationContext.summary.variantsMigrated = 0;
            migrationContext.phases.creation.success = true;
            migrationContext.phases.creation.mode = 'no-action';
            migrationContext.summary.totalDuration = Date.now() - migrationStartTime;
            migrationContext.summary.message = 'All variants already exist on Shopify';
            await this.notificationService.notifyMigrationEnd(migrationContext);
            return migrationContext;
          }

          const syncResult = await this.executeVariantSyncPhase(
            extractedData, creationService, existingProduct.productId, existingSkus, migrationOptions, migrationContext
          );

          migrationContext.shopifyProductId = existingProduct.productId;
          migrationContext.shopifyProductUrl = shopifyTargetService.buildAdminUrl(existingProduct.productId);
          migrationContext.success = syncResult.success;
          migrationContext.summary.totalDuration = Date.now() - migrationStartTime;
          migrationContext.summary.variantsMigrated = syncResult.variantsCreated || 0;
          migrationContext.summary.childrenMigrated = syncResult.variantsCreated || 0;
          migrationContext.summary.imagesUploaded = syncResult.imagesUploaded || 0;
          migrationContext.summary.errorsCount = migrationContext.errors.length;
          migrationContext.summary.warningsCount = migrationContext.warnings.length;

          await this.notificationService.notifyMigrationEnd(migrationContext);
          return migrationContext;
        }

        const creationResult = await this.executeCreationPhase(extractedData, shopifyTargetService, migrationOptions, migrationContext);

        migrationContext.shopifyProductId = creationResult.parentProductId;
        migrationContext.shopifyHandle = creationResult.shopifyHandle;
        migrationContext.shopifyProductUrl = creationResult.shopifyHandle
          ? shopifyTargetService.buildStorefrontUrl(creationResult.shopifyHandle)
          : shopifyTargetService.buildAdminUrl(creationResult.parentProductId);
        migrationContext.success = true;
        migrationContext.summary.totalDuration = Date.now() - migrationStartTime;
        migrationContext.summary.variantsMigrated = creationResult.createdVariants?.length || 0;
        migrationContext.summary.childrenMigrated = creationResult.createdVariants?.length || 0;
        migrationContext.summary.imagesUploaded = creationResult.imagesUploaded || 0;
        migrationContext.summary.errorsCount = migrationContext.errors.length;
        migrationContext.summary.warningsCount = migrationContext.warnings.length;

        await this.notificationService.notifyMigrationEnd(migrationContext);
        return migrationContext;

      } else {
        // ---- STANDALONE SIMPLE PATH ----
        const extractedData = await this.executeStandaloneExtractionPhase(sku, sourceProduct, migrationContext);

        // AI content generation (DB prompts + request prompts)
        const mergedPrompts = await this._resolvePrompts([shopifyStore], options.storePrompts);
        const generatedContent = Object.keys(mergedPrompts).length > 0
          ? await this._executeAIGenerationPhase(extractedData, mergedPrompts, migrationContext)
          : {};

        if (generatedContent[shopifyStore]) {
          this._applyGeneratedContent(extractedData, generatedContent[shopifyStore]);
        }

        await this.notificationService.notifyMigrationStart(sku, [], [shopifyStore]);

        const storeResult = await this.migrateStandaloneToStore(sku, extractedData, shopifyStore, migrationOptions, migrationContext, migrationStartTime);

        await this.notificationService.notifyMigrationEnd(migrationContext);
        return migrationContext;
      }

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

      logger.error('Magento to Shopify migration failed', {
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
      logger.info('Executing standalone Shopify extraction phase', { sku });

      const extractedData = await this.standaloneExtractionService.extractProduct(sku, sourceProduct);

      context.phases.extraction.success = true;
      context.phases.extraction.duration = Date.now() - phaseStartTime;
      context.phases.extraction.childrenFound = 0;

      logger.info('Standalone extraction phase successful', {
        sku,
        duration: `${context.phases.extraction.duration}ms`
      });

      return extractedData;
    } catch (error) {
      context.phases.extraction.success = false;
      context.phases.extraction.duration = Date.now() - phaseStartTime;

      context.errors.push({ phase: 'extraction', message: error.message, details: error.stack });

      logger.error('Standalone extraction phase failed', { sku, error: error.message });

      throw error;
    }
  }

  async executeCreationPhase(extractedData, shopifyTargetService, options, context) {
    const phaseStartTime = Date.now();

    try {
      logger.info('Executing Shopify creation phase', { options });

      const creationService = new ShopifyCreationService(this.sourceService, shopifyTargetService, this.categoryMappingService, options.shopifyStore);
      const creationResult = await creationService.createProducts(extractedData, options);

      context.phases.creation.success = creationResult.success;
      context.phases.creation.duration = Date.now() - phaseStartTime;
      context.phases.creation.variantsCreated = creationResult.createdVariants?.length || 0;
      context.phases.creation.imagesUploaded = creationResult.imagesUploaded || 0;

      if (creationResult.warnings && creationResult.warnings.length > 0) {
        context.warnings.push(...creationResult.warnings);
      }

      if (creationResult.errors && creationResult.errors.length > 0) {
        context.errors.push(...creationResult.errors);
      }

      logger.info('Shopify creation phase successful', {
        duration: `${context.phases.creation.duration}ms`,
        variantsCreated: context.phases.creation.variantsCreated,
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

      logger.error('Shopify creation phase failed', {
        error: error.message,
        duration: `${context.phases.creation.duration}ms`
      });

      throw error;
    }
  }

  async executeVariantSyncPhase(extractedData, creationService, existingProductId, existingSkus, options, context) {
    const phaseStartTime = Date.now();

    try {
      logger.info('Executing Shopify variant sync phase', {
        parentSku: extractedData.parent.sku,
        existingProductId,
        existingVariants: existingSkus.length
      });

      const syncResult = await creationService.syncMissingVariants(
        extractedData,
        existingProductId,
        existingSkus,
        options
      );

      context.phases.creation.success = syncResult.success;
      context.phases.creation.mode = 'variant-sync';
      context.phases.creation.duration = Date.now() - phaseStartTime;
      context.phases.creation.variantsCreated = syncResult.variantsCreated;
      context.phases.creation.variantsSkipped = syncResult.variantsSkipped;
      context.phases.creation.imagesUploaded = syncResult.imagesUploaded || 0;

      if (syncResult.warnings && syncResult.warnings.length > 0) {
        context.warnings.push(...syncResult.warnings);
      }

      if (syncResult.errors && syncResult.errors.length > 0) {
        context.errors.push(...syncResult.errors);
      }

      logger.info('Shopify variant sync phase successful', {
        duration: `${context.phases.creation.duration}ms`,
        variantsCreated: context.phases.creation.variantsCreated,
        variantsSkipped: context.phases.creation.variantsSkipped
      });

      return syncResult;
    } catch (error) {
      context.phases.creation.success = false;
      context.phases.creation.mode = 'variant-sync';
      context.phases.creation.duration = Date.now() - phaseStartTime;

      context.errors.push({
        phase: 'variant-sync',
        message: error.message,
        details: error.details || error.stack
      });

      logger.error('Shopify variant sync phase failed', {
        error: error.message,
        duration: `${context.phases.creation.duration}ms`
      });

      throw error;
    }
  }

  /**
   * Migrate a standalone simple product to a single Shopify store.
   */
  async migrateStandaloneToStore(sku, extractedData, shopifyStore, migrationOptions, migrationContext, migrationStartTime) {
    const phaseStartTime = Date.now();

    const shopifyTargetService = this.getShopifyTargetService(shopifyStore);
    const creationService = new ShopifyCreationService(
      this.sourceService,
      shopifyTargetService,
      this.categoryMappingService,
      shopifyStore
    );

    // Existence check using variant SKU lookup
    const existingVariants = await shopifyTargetService.getVariantsBySkus([sku]);
    if (existingVariants.length > 0) {
      logger.warn('Standalone product already exists on Shopify, skipping', { sku, shopifyStore });

      migrationContext.success = false;
      migrationContext.summary.totalDuration = Date.now() - migrationStartTime;
      migrationContext.summary.errorsCount = migrationContext.errors.length + 1;
      migrationContext.summary.warningsCount = migrationContext.warnings.length;

      migrationContext.errors.push({
        phase: 'creation',
        shopifyStore,
        message: `Product ${sku} already exists on Shopify ${shopifyStore}.`
      });

      return { success: false };
    }

    try {
      const creationResult = await creationService.createStandaloneProduct(extractedData, shopifyStore);

      migrationContext.shopifyProductId = creationResult.parentProductId;
      migrationContext.shopifyHandle = creationResult.shopifyHandle;
      migrationContext.shopifyProductUrl = creationResult.shopifyHandle
        ? shopifyTargetService.buildStorefrontUrl(creationResult.shopifyHandle)
        : shopifyTargetService.buildAdminUrl(creationResult.parentProductId);
      migrationContext.success = true;

      migrationContext.phases.creation.success = true;
      migrationContext.phases.creation.duration = Date.now() - phaseStartTime;
      migrationContext.phases.creation.variantsCreated = creationResult.createdVariants.length;
      migrationContext.phases.creation.imagesUploaded = creationResult.imagesUploaded || 0;

      migrationContext.summary.totalDuration = Date.now() - migrationStartTime;
      migrationContext.summary.variantsMigrated = creationResult.createdVariants.length;
      migrationContext.summary.childrenMigrated = creationResult.createdVariants.length;
      migrationContext.summary.imagesUploaded = creationResult.imagesUploaded || 0;
      migrationContext.summary.errorsCount = migrationContext.errors.length;
      migrationContext.summary.warningsCount = migrationContext.warnings.length;

      logger.info('Standalone Shopify product migration completed', {
        sku,
        shopifyStore,
        productId: migrationContext.shopifyProductId
      });

      return { success: true };
    } catch (error) {
      migrationContext.phases.creation.success = false;
      migrationContext.phases.creation.duration = Date.now() - phaseStartTime;
      migrationContext.success = false;
      migrationContext.summary.totalDuration = Date.now() - migrationStartTime;
      migrationContext.errors.push({ phase: 'creation', shopifyStore, message: error.message, details: error.stack });

      throw error;
    }
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

  async _executeAIGenerationPhase(extractedData, storePrompts, context) {
    const phaseStartTime = Date.now();

    try {
      logger.info('Executing AI content generation phase', { sku: extractedData.parent.sku });

      const generatedContent = await this.contentGenerationService.generateForStores(extractedData, storePrompts);

      context.phases.aiGeneration = {
        success: true,
        duration: Date.now() - phaseStartTime,
        storesGenerated: Object.keys(generatedContent).length
      };

      logger.info('AI content generation phase completed', {
        sku: extractedData.parent.sku,
        storesGenerated: Object.keys(generatedContent).length,
        duration: `${context.phases.aiGeneration.duration}ms`
      });

      return generatedContent;
    } catch (error) {
      context.phases.aiGeneration = {
        success: false,
        duration: Date.now() - phaseStartTime
      };

      logger.error('AI content generation phase failed', {
        sku: extractedData.parent.sku,
        error: error.message,
        duration: `${context.phases.aiGeneration.duration}ms`
      });

      throw error;
    }
  }

  _applyGeneratedContent(extractedData, content) {
    if (content.title) {
      extractedData.parent.name = content.title;
    }
    if (content.description) {
      const descAttr = (extractedData.parent.custom_attributes || [])
        .find(a => a.attribute_code === 'description');
      if (descAttr) {
        descAttr.value = content.description;
      } else {
        extractedData.parent.custom_attributes = extractedData.parent.custom_attributes || [];
        extractedData.parent.custom_attributes.push({
          attribute_code: 'description',
          value: content.description
        });
      }
    }
  }

  async testShopifyConnection(storeName) {
    logger.info('Testing Shopify connection', { storeName });

    try {
      const shopifyTargetService = this.getShopifyTargetService(storeName);
      return await shopifyTargetService.testConnection();
    } catch (error) {
      return {
        connected: false,
        error: error.message
      };
    }
  }

  async testConnections(shopifyStore) {
    logger.info('Testing all connections');

    const sourceConnection = await this.sourceService.testConnection();
    const shopifyConnection = await this.testShopifyConnection(shopifyStore);

    return {
      source: sourceConnection,
      shopify: shopifyConnection
    };
  }
}

module.exports = ShopifyOrchestratorService;
