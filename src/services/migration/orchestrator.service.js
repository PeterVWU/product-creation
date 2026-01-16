const logger = require('../../config/logger');
const config = require('../../config');
const SourceService = require('../magento/source.service');
const TargetService = require('../magento/target.service');
const ExtractionService = require('./extraction.service');
const PreparationService = require('./preparation.service');
const CreationService = require('./creation.service');

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

    this.extractionService = new ExtractionService(this.sourceService);
    this.preparationService = new PreparationService(this.targetService);
    this.creationService = new CreationService(this.sourceService, this.targetService);
  }

  async migrateProduct(sku, options = {}) {
    const migrationStartTime = Date.now();

    logger.info('Starting product migration', { sku, options });

    const migrationContext = {
      sku,
      success: false,
      phases: {
        extraction: { success: false, duration: 0 },
        preparation: { success: false, duration: 0 },
        creation: { success: false, duration: 0 }
      },
      summary: {
        totalDuration: 0,
        childrenMigrated: 0,
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
      createMissingAttributes: options.createMissingAttributes !== undefined
        ? options.createMissingAttributes
        : config.migration.createMissingAttributes,
      overwriteExisting: options.overwriteExisting !== undefined
        ? options.overwriteExisting
        : config.migration.overwriteExisting
    };

    try {
      const extractedData = await this.executeExtractionPhase(sku, migrationContext);

      const preparedData = await this.executePreparationPhase(extractedData, migrationContext);

      await this.executeCreationPhase(extractedData, preparedData, migrationOptions, migrationContext);

      migrationContext.success = true;

      migrationContext.summary.totalDuration = Date.now() - migrationStartTime;
      migrationContext.summary.childrenMigrated = migrationContext.phases.creation.childrenCreated || 0;
      migrationContext.summary.errorsCount = migrationContext.errors.length;
      migrationContext.summary.warningsCount = migrationContext.warnings.length;

      logger.info('Product migration completed successfully', {
        sku,
        duration: `${migrationContext.summary.totalDuration}ms`,
        childrenMigrated: migrationContext.summary.childrenMigrated
      });

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
