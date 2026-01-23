const logger = require('../../config/logger');
const config = require('../../config');
const SourceService = require('../magento/source.service');
const ShopifyTargetService = require('../shopify/shopify-target.service');
const ExtractionService = require('./extraction.service');
const ShopifyCreationService = require('./shopify-creation.service');
const CategoryMappingService = require('../category-mapping.service');
const GoogleChatService = require('../notification/google-chat.service');

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
    this.googleChatService = new GoogleChatService();

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
      shopifyProductId: null,
      shopifyProductUrl: null,
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
      productStatus: options.productStatus || 'DRAFT'
    };

    try {
      // Phase 1: Extract from Magento (reuse existing extraction service)
      const extractedData = await this.executeExtractionPhase(sku, migrationContext);

      const childSkus = extractedData.children.map(child => child.sku);
      await this.googleChatService.notifyMigrationStart(sku, childSkus, [shopifyStore]);

      // Phase 2: Create in Shopify (no preparation phase needed)
      const shopifyTargetService = this.getShopifyTargetService(options.shopifyStore);
      const creationService = new ShopifyCreationService(this.sourceService, shopifyTargetService, this.categoryMappingService);

      // Auto-detect if product already exists on Shopify by searching for child variant SKUs
      const hasChildren = extractedData.children && extractedData.children.length > 0;
      let existingProduct = null;

      if (hasChildren) {
        const childSkus = extractedData.children.map(c => c.sku);
        const existingVariants = await shopifyTargetService.getVariantsBySkus(childSkus);

        if (existingVariants.length > 0) {
          // Found existing variants - extract product info
          const productId = existingVariants[0].product.id;
          existingProduct = {
            productId,
            variants: existingVariants.map(v => ({
              id: v.id,
              sku: v.sku,
              price: v.price
            }))
          };

          logger.info('Found existing Shopify product by variant SKUs', {
            sku: extractedData.parent.sku,
            productId,
            matchedVariants: existingVariants.length
          });
        }
      }

      if (existingProduct && hasChildren) {
        // Product exists - check for missing variants
        const existingSkus = existingProduct.variants.map(v => v.sku).filter(Boolean);
        const missingChildren = extractedData.children.filter(c => !existingSkus.includes(c.sku));

        logger.info('Auto-detected existing Shopify product', {
          sku,
          productId: existingProduct.productId,
          existingVariants: existingSkus.length,
          sourceVariants: extractedData.children.length,
          missingVariants: missingChildren.length
        });

        if (missingChildren.length === 0) {
          // All variants exist - return early with no-action mode
          migrationContext.success = true;
          migrationContext.shopifyProductId = existingProduct.productId;
          migrationContext.shopifyProductUrl = shopifyTargetService.buildAdminUrl(existingProduct.productId);
          migrationContext.phases.creation.success = true;
          migrationContext.phases.creation.mode = 'no-action';
          migrationContext.summary.totalDuration = Date.now() - migrationStartTime;
          migrationContext.summary.message = 'All variants already exist on Shopify';

          logger.info('All variants already exist on Shopify, skipping migration', { sku, productId: existingProduct.productId });
          await this.googleChatService.notifyMigrationEnd(migrationContext);
          return migrationContext;
        }

        // Sync missing variants only
        const syncResult = await this.executeVariantSyncPhase(
          extractedData,
          creationService,
          existingProduct.productId,
          existingSkus,
          migrationOptions,
          migrationContext
        );

        migrationContext.shopifyProductId = existingProduct.productId;
        migrationContext.shopifyProductUrl = shopifyTargetService.buildAdminUrl(existingProduct.productId);
        migrationContext.success = syncResult.success;

        migrationContext.summary.totalDuration = Date.now() - migrationStartTime;
        migrationContext.summary.variantsMigrated = syncResult.variantsCreated || 0;
        migrationContext.summary.imagesUploaded = syncResult.imagesUploaded || 0;
        migrationContext.summary.errorsCount = migrationContext.errors.length;
        migrationContext.summary.warningsCount = migrationContext.warnings.length;

        logger.info('Shopify variant sync completed', {
          sku,
          success: migrationContext.success,
          duration: `${migrationContext.summary.totalDuration}ms`,
          variantsMigrated: migrationContext.summary.variantsMigrated
        });

        await this.googleChatService.notifyMigrationEnd(migrationContext);
        return migrationContext;
      }

      // Product doesn't exist or has no children - perform full migration
      const creationResult = await this.executeCreationPhase(
        extractedData,
        shopifyTargetService,
        migrationOptions,
        migrationContext
      );

      migrationContext.shopifyProductId = creationResult.parentProductId;
      migrationContext.shopifyProductUrl = shopifyTargetService.buildAdminUrl(creationResult.parentProductId);
      migrationContext.success = true;

      migrationContext.summary.totalDuration = Date.now() - migrationStartTime;
      migrationContext.summary.variantsMigrated = creationResult.createdVariants?.length || 0;
      migrationContext.summary.imagesUploaded = creationResult.imagesUploaded || 0;
      migrationContext.summary.errorsCount = migrationContext.errors.length;
      migrationContext.summary.warningsCount = migrationContext.warnings.length;

      logger.info('Magento to Shopify migration completed', {
        sku,
        shopifyProductId: migrationContext.shopifyProductId,
        duration: `${migrationContext.summary.totalDuration}ms`,
        variantsMigrated: migrationContext.summary.variantsMigrated
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

      logger.error('Magento to Shopify migration failed', {
        sku,
        error: error.message,
        duration: `${migrationContext.summary.totalDuration}ms`
      });

      await this.googleChatService.notifyMigrationEnd(migrationContext);

      return migrationContext;
    }
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

  async executeCreationPhase(extractedData, shopifyTargetService, options, context) {
    const phaseStartTime = Date.now();

    try {
      logger.info('Executing Shopify creation phase', { options });

      const creationService = new ShopifyCreationService(this.sourceService, shopifyTargetService, this.categoryMappingService);
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
