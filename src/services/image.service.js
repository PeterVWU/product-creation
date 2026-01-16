const logger = require('../config/logger');
const sharp = require('sharp');
const { ImageProcessingError } = require('../utils/error-handler');

class ImageService {
  constructor(sourceService, targetService, config = {}) {
    this.sourceService = sourceService;
    this.targetService = targetService;
    this.maxSizeMB = config.maxSizeMB || 10;
  }

  async downloadImage(imageUrl) {
    logger.debug('Downloading image', { url: imageUrl });

    try {
      const { buffer, contentType } = await this.sourceService.downloadImage(imageUrl);
      return { buffer, contentType };
    } catch (error) {
      logger.error('Failed to download image', { url: imageUrl, error: error.message });
      throw new ImageProcessingError(`Failed to download image: ${error.message}`);
    }
  }

  convertToBase64(buffer) {
    try {
      return buffer.toString('base64');
    } catch (error) {
      logger.error('Failed to convert image to base64', { error: error.message });
      throw new ImageProcessingError(`Failed to convert to base64: ${error.message}`);
    }
  }

  async optimizeImage(buffer) {
    try {
      const sizeInMB = buffer.length / (1024 * 1024);

      // Always convert to JPEG for consistency, but only resize if > maxSize
      if (sizeInMB <= this.maxSizeMB) {
        // Convert to JPEG without resizing
        const converted = await sharp(buffer)
          .jpeg({ quality: 90 })
          .toBuffer();
        return converted;
      }

      logger.info('Optimizing image', { originalSizeMB: sizeInMB.toFixed(2) });

      const optimized = await sharp(buffer)
        .resize(2048, 2048, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .jpeg({ quality: 85 })
        .toBuffer();

      const newSizeInMB = optimized.length / (1024 * 1024);
      logger.info('Image optimized', {
        originalSizeMB: sizeInMB.toFixed(2),
        newSizeMB: newSizeInMB.toFixed(2)
      });

      return optimized;
    } catch (error) {
      logger.warn('Failed to optimize image, using original', { error: error.message });
      // If optimization fails, still try to convert to JPEG
      try {
        return await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
      } catch (convertError) {
        logger.error('Failed to convert image to JPEG', { error: convertError.message });
        return buffer;
      }
    }
  }

  async uploadToProduct(sku, imageData, metadata = {}) {
    logger.info('Uploading image to product', { sku });

    try {
      let buffer = imageData.buffer;

      buffer = await this.optimizeImage(buffer);

      const base64Image = this.convertToBase64(buffer);

      // After optimization, all images are JPEG format
      const uploadMetadata = {
        label: metadata.label || 'Product Image',
        position: metadata.position || 1,
        types: metadata.types || ['image'],
        contentType: 'image/jpeg',  // Always JPEG after Sharp optimization
        fileName: metadata.fileName || `${sku}-image.jpg`
      };

      const result = await this.targetService.uploadProductImage(
        sku,
        base64Image,
        uploadMetadata
      );

      logger.info('Image uploaded successfully', { sku, imageId: result });
      return result;
    } catch (error) {
      logger.error('Failed to upload image', { sku, error: error.message });
      throw new ImageProcessingError(`Failed to upload image: ${error.message}`);
    }
  }

  async migrateProductImages(sku, imageEntries) {
    logger.info('Starting image migration', {
      sku,
      totalImages: imageEntries.length
    });

    const results = {
      success: [],
      failed: []
    };

    for (const [index, entry] of imageEntries.entries()) {
      try {
        logger.debug('Downloading image', { sku, file: entry.file });
        const imageData = await this.downloadImage(entry.file);

        const metadata = {
          label: entry.label || 'Product Image',
          position: entry.position || index + 1,
          types: entry.types || ['image'],
          fileName: entry.file.split('/').pop()
        };

        logger.debug('Uploading image', { sku, file: entry.file, position: metadata.position });
        const result = await this.uploadToProduct(sku, imageData, metadata);

        results.success.push({
          file: entry.file,
          imageId: result
        });

        logger.info('Image uploaded successfully', {
          sku,
          file: entry.file,
          imageId: result
        });
      } catch (error) {
        logger.error('Image migration failed', {
          sku,
          file: entry.file,
          error: error.message,
          stack: error.stack
        });

        results.failed.push({
          file: entry.file,
          error: error.message
        });
      }
    }

    logger.info('Image migration completed', {
      sku,
      success: results.success.length,
      failed: results.failed.length
    });

    return results;
  }
}

module.exports = ImageService;
