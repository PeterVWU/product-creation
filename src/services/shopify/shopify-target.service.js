const ShopifyClient = require('./shopify.client');
const logger = require('../../config/logger');

class ShopifyTargetService extends ShopifyClient {
  constructor(shopDomain, accessToken, config = {}) {
    super(shopDomain, accessToken, config);
  }

  async createProduct(productData) {
    logger.info('Creating product in Shopify', { title: productData.title });

    const mutation = `
      mutation productCreate($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            title
            handle
            status
            variants(first: 10) {
              edges {
                node {
                  id
                  sku
                  price
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: productData
    };

    const result = await this.query(mutation, variables);
    return result.data.productCreate.product;
  }

  async createProductWithVariants(productData, options, variants, files = []) {
    logger.info('Creating product with variants in Shopify', {
      title: productData.title,
      optionCount: options.length,
      variantCount: variants.length,
      fileCount: files.length
    });

    const mutation = `
      mutation productSet($input: ProductSetInput!) {
        productSet(input: $input) {
          product {
            id
            title
            handle
            status
            options {
              id
              name
              values
            }
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  price
                  inventoryItem {
                    id
                    sku
                  }
                  selectedOptions {
                    name
                    value
                  }
                }
              }
            }
            media(first: 20) {
              edges {
                node {
                  ... on MediaImage {
                    id
                    image {
                      url
                    }
                  }
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const input = {
      title: productData.title,
      handle: productData.handle,
      descriptionHtml: productData.descriptionHtml,
      productType: productData.productType,
      status: productData.status || 'DRAFT',
      vendor: productData.vendor || '',
      tags: productData.tags || [],
      productOptions: options,
      variants: variants
    };

    // Include files if provided (files should be pre-uploaded file IDs from uploadAndWaitForFiles)
    // The files array may contain null entries for failed uploads - filter them out
    const validFiles = files.filter(f => f !== null);
    if (validFiles.length > 0) {
      input.files = validFiles.map(f => ({
        id: f.id,  // Use the Shopify file ID, not external URL
        alt: f.alt || ''
      }));
      logger.debug('Including files in productSet input', {
        fileCount: validFiles.length,
        fileIds: validFiles.map(f => f.id)
      });
    }

    const variables = { input };

    const result = await this.query(mutation, variables);
    return result.data.productSet.product;
  }

  async createProductVariants(productId, variants) {
    logger.info('Creating product variants in Shopify', {
      productId,
      variantCount: variants.length
    });

    const mutation = `
      mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
        productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
          productVariants {
            id
            sku
            title
            price
            inventoryItem {
              id
              sku
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      productId,
      variants,
      strategy: 'REMOVE_STANDALONE_VARIANT'
    };

    const result = await this.query(mutation, variables);
    return result.data.productVariantsBulkCreate.productVariants;
  }

  /**
   * Create media on a product from external URLs.
   * Use this for variant sync to add images to an existing product.
   * @param {string} productId - The Shopify product ID
   * @param {Array} images - Array of {url, alt, sku} objects
   * @returns {Array} Array of {id, sku} objects with product media IDs
   */
  async createProductMedia(productId, images) {
    logger.info('Creating product media from external URLs', {
      productId,
      imageCount: images.length
    });

    const mutation = `
      mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media {
            ... on MediaImage {
              id
              alt
              image {
                url
              }
            }
          }
          mediaUserErrors {
            field
            message
          }
        }
      }
    `;

    const mediaInputs = images.map(image => ({
      originalSource: image.url,
      alt: image.alt || '',
      mediaContentType: 'IMAGE'
    }));

    const variables = {
      productId,
      media: mediaInputs
    };

    const result = await this.query(mutation, variables);

    if (result.data.productCreateMedia.mediaUserErrors?.length > 0) {
      const errors = result.data.productCreateMedia.mediaUserErrors;
      logger.error('Failed to create product media', { errors });
      throw new Error(`Media creation failed: ${errors.map(e => e.message).join(', ')}`);
    }

    // Map media IDs back to SKUs based on order
    const createdMedia = result.data.productCreateMedia.media || [];
    const mediaWithSkus = createdMedia.map((media, index) => ({
      id: media.id,
      sku: images[index]?.sku || null
    }));

    logger.info('Product media created', {
      productId,
      mediaCount: mediaWithSkus.length
    });

    // Wait for all media to be ready before returning
    const readyMedia = [];
    for (const media of mediaWithSkus) {
      try {
        await this.waitForMediaReady(media.id);
        readyMedia.push(media);
      } catch (error) {
        logger.error('Media failed to become ready', { mediaId: media.id, error: error.message });
      }
    }

    logger.info('Product media ready', {
      productId,
      readyCount: readyMedia.length,
      totalCount: mediaWithSkus.length
    });

    return readyMedia;
  }

  /**
   * Wait for product media to be ready.
   * @param {string} mediaId - The media ID to wait for
   * @param {number} maxAttempts - Maximum polling attempts (default 30)
   * @param {number} delayMs - Delay between attempts in ms (default 1000)
   * @returns {Object} The media object when ready
   */
  async waitForMediaReady(mediaId, maxAttempts = 30, delayMs = 1000) {
    logger.debug('Waiting for media to be ready', { mediaId });

    const query = `
      query checkMediaStatus($id: ID!) {
        node(id: $id) {
          ... on MediaImage {
            id
            status
            image {
              url
            }
          }
        }
      }
    `;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.query(query, { id: mediaId });
      const media = result.data.node;

      if (!media) {
        throw new Error(`Media not found: ${mediaId}`);
      }

      logger.debug('Media status check', { mediaId, status: media.status, attempt: attempt + 1 });

      if (media.status === 'READY') {
        logger.info('Media is ready', { mediaId });
        return media;
      }

      if (media.status === 'FAILED') {
        throw new Error(`Media processing failed for ${mediaId}`);
      }

      // Still PROCESSING or UPLOADED - wait and retry
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    throw new Error(`Timeout waiting for media ${mediaId} to be ready after ${maxAttempts} attempts`);
  }

  /**
   * Append media to variants using productVariantAppendMedia mutation.
   * This is used when syncing missing variants, since productVariantsBulkCreate
   * does not support the 'file' field for image association.
   * @param {string} productId - The Shopify product ID
   * @param {Array} variantMedia - Array of {variantId, mediaIds} objects
   * @returns {Array} The updated product variants
   */
  async appendMediaToVariants(productId, variantMedia) {
    logger.info('Appending media to variants', { productId, variantCount: variantMedia.length });

    const mutation = `
      mutation productVariantAppendMedia($productId: ID!, $variantMedia: [ProductVariantAppendMediaInput!]!) {
        productVariantAppendMedia(productId: $productId, variantMedia: $variantMedia) {
          product { id }
          productVariants { id }
          userErrors { field message }
        }
      }
    `;

    const result = await this.query(mutation, { productId, variantMedia });

    if (result.data.productVariantAppendMedia.userErrors?.length > 0) {
      const errors = result.data.productVariantAppendMedia.userErrors;
      logger.error('Failed to append media to variants', { errors });
      throw new Error(`Media append failed: ${errors.map(e => e.message).join(', ')}`);
    }

    return result.data.productVariantAppendMedia.productVariants;
  }

  /**
   * Create a file in Shopify from an external URL.
   * Step 1 of the 3-step image upload process.
   * @param {string} imageUrl - External URL of the image
   * @param {string} alt - Alt text for the image
   * @returns {Object} Created file with id and fileStatus
   */
  async createFile(imageUrl, alt = '') {
    logger.info('Creating file in Shopify from external URL', { imageUrl });

    const mutation = `
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
            alt
            ... on MediaImage {
              image {
                url
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      files: [{
        originalSource: imageUrl,
        alt: alt,
        contentType: 'IMAGE'
      }]
    };

    const result = await this.query(mutation, variables);

    if (result.data.fileCreate.userErrors?.length > 0) {
      const error = result.data.fileCreate.userErrors[0];
      logger.error('File creation failed', { field: error.field, message: error.message });
      throw new Error(`File creation failed: ${error.message}`);
    }

    const file = result.data.fileCreate.files[0];
    logger.debug('File created', { fileId: file.id, status: file.fileStatus });
    return file;
  }

  /**
   * Poll for file status until it becomes READY.
   * Step 2 of the 3-step image upload process.
   * @param {string} fileId - The Shopify file ID (gid://shopify/MediaImage/...)
   * @param {number} maxAttempts - Maximum polling attempts (default 30)
   * @param {number} delayMs - Delay between attempts in ms (default 1000)
   * @returns {Object} The file object when ready
   */
  async waitForFileReady(fileId, maxAttempts = 30, delayMs = 1000) {
    logger.debug('Waiting for file to be ready', { fileId });

    const query = `
      query checkFileStatus($id: ID!) {
        node(id: $id) {
          ... on MediaImage {
            id
            fileStatus
            image {
              url
            }
          }
          ... on GenericFile {
            id
            fileStatus
          }
        }
      }
    `;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.query(query, { id: fileId });
      const file = result.data.node;

      if (!file) {
        throw new Error(`File not found: ${fileId}`);
      }

      logger.debug('File status check', { fileId, status: file.fileStatus, attempt: attempt + 1 });

      if (file.fileStatus === 'READY') {
        logger.info('File is ready', { fileId });
        return file;
      }

      if (file.fileStatus === 'FAILED') {
        throw new Error(`File processing failed for ${fileId}`);
      }

      // Still PROCESSING or UPLOADED - wait and retry
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    throw new Error(`Timeout waiting for file ${fileId} to be ready after ${maxAttempts} attempts`);
  }

  /**
   * Upload images from external URLs and wait for them to be ready.
   * Combines steps 1-2 of the 3-step image upload process.
   * @param {Array} images - Array of {url, alt, sku} objects
   * @returns {Array} Array of {id, alt, sku} objects with Shopify file IDs (null entries for failed uploads to preserve indices)
   */
  async uploadAndWaitForFiles(images) {
    logger.info('Uploading images to Shopify CDN', { count: images.length });

    const fileIds = [];

    for (const image of images) {
      try {
        // Step 1: Create file from external URL
        const file = await this.createFile(image.url, image.alt);
        logger.info('File created in Shopify', { fileId: file.id, status: file.fileStatus, sku: image.sku });

        // Step 2: Wait for file to be ready
        await this.waitForFileReady(file.id);
        logger.info('File ready', { fileId: file.id });

        fileIds.push({
          id: file.id,
          alt: image.alt,
          sku: image.sku  // Preserve SKU for variant association
        });
      } catch (error) {
        logger.error('Failed to upload image', { url: image.url, sku: image.sku, error: error.message });
        // Push null to preserve indices for SKU-to-file mapping
        fileIds.push(null);
      }
    }

    const successCount = fileIds.filter(f => f !== null).length;
    logger.info('Image upload complete', { uploaded: successCount, total: images.length });
    return fileIds;
  }

  /**
   * @deprecated Use createProductWithVariants with files parameter instead.
   * The productCreateMedia mutation is deprecated by Shopify.
   * Images should be included in the productSet mutation via the files field.
   */
  async uploadProductImages(productId, images) {
    logger.warn('uploadProductImages is deprecated - use files parameter in createProductWithVariants instead');
    logger.info('Uploading product images to Shopify', {
      productId,
      imageCount: images.length
    });

    const mutation = `
      mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media {
            ... on MediaImage {
              id
              image {
                url
              }
            }
          }
          mediaUserErrors {
            field
            message
          }
        }
      }
    `;

    const mediaInputs = images.map(image => ({
      originalSource: image.url,
      alt: image.alt || '',
      mediaContentType: 'IMAGE'
    }));

    const variables = {
      productId,
      media: mediaInputs
    };

    const result = await this.query(mutation, variables);
    return result.data.productCreateMedia.media;
  }

  async getProductByHandle(handle) {
    logger.debug('Checking if product exists in Shopify', { handle });

    const query = `
      query getProductByHandle($handle: String!) {
        productByHandle(handle: $handle) {
          id
          title
          handle
          status
          variants(first: 100) {
            edges {
              node {
                id
                sku
                price
              }
            }
          }
        }
      }
    `;

    try {
      const result = await this.query(query, { handle });
      const product = result.data.productByHandle;

      // Log response for debugging
      logger.info('Shopify getProductByHandle response', {
        handle,
        found: !!product,
        productId: product?.id || null,
        variantCount: product?.variants?.edges?.length || 0
      });

      return product;
    } catch (error) {
      logger.debug('Product not found by handle', { handle });
      return null;
    }
  }

  async getProductVariants(handle) {
    logger.debug('Fetching product variants', { handle });

    const product = await this.getProductByHandle(handle);
    if (!product) return null;

    const variantData = {
      productId: product.id,
      variants: product.variants?.edges?.map(e => ({
        id: e.node.id,
        sku: e.node.sku,
        price: e.node.price
      })) || []
    };

    // Log retrieved variants for debugging
    logger.debug('Product variants retrieved', {
      handle,
      productId: variantData.productId,
      variantCount: variantData.variants.length,
      variantSkus: variantData.variants.map(v => v.sku)
    });

    return variantData;
  }

  /**
   * Fetch variants by SKUs using the productVariants query.
   * @param {Array<string>} skus - Array of SKUs to search for
   * @returns {Array} Array of variant objects with id, sku, price, and product info
   */
  async getVariantsBySkus(skus) {
    logger.info('Fetching variants by SKUs', { count: skus.length, skus });

    // Build query string: "sku:SKU1 OR sku:SKU2 OR sku:SKU3"
    const queryString = skus.map(sku => `sku:${sku}`).join(' OR ');

    const query = `
      query findVariantsBySkus($query: String!) {
        productVariants(first: 100, query: $query) {
          edges {
            node {
              id
              sku
              price
              product {
                id
                title
              }
            }
          }
        }
      }
    `;

    try {
      const result = await this.query(query, { query: queryString });
      const variants = result.data.productVariants?.edges?.map(e => e.node) || [];

      logger.info('Variants found by SKUs', {
        requestedCount: skus.length,
        foundCount: variants.length,
        foundSkus: variants.map(v => v.sku)
      });

      return variants;
    } catch (error) {
      logger.error('Failed to fetch variants by SKUs', { error: error.message });
      return [];
    }
  }

  /**
   * Update variant prices in bulk using productVariantsBulkUpdate mutation.
   * @param {string} productId - The Shopify product ID (gid://shopify/Product/...)
   * @param {Array} variantPrices - Array of { id: "gid://shopify/ProductVariant/123", price: "99.99" }
   * @returns {Object} Result containing updated variants and any errors
   */
  async updateVariantPrices(productId, variantPrices) {
    logger.info('Updating variant prices in Shopify', {
      productId,
      variantCount: variantPrices.length
    });

    const mutation = `
      mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
            id
            price
            sku
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variants = variantPrices.map(v => ({
      id: v.id,
      price: String(v.price)
    }));

    const variables = {
      productId,
      variants
    };

    const result = await this.query(mutation, variables);

    if (result.data.productVariantsBulkUpdate.userErrors?.length > 0) {
      const errors = result.data.productVariantsBulkUpdate.userErrors;
      logger.error('Failed to update variant prices', { productId, errors });
      throw new Error(`Variant price update failed: ${errors.map(e => e.message).join(', ')}`);
    }

    const updatedVariants = result.data.productVariantsBulkUpdate.productVariants || [];
    logger.info('Variant prices updated', {
      productId,
      updatedCount: updatedVariants.length
    });

    return {
      productVariants: updatedVariants,
      updatedCount: updatedVariants.length
    };
  }

  async publishProduct(productId) {
    logger.info('Publishing product in Shopify', { productId });

    // First, get the online store publication
    const publicationQuery = `
      query {
        publications(first: 10) {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    `;

    const pubResult = await this.query(publicationQuery);
    const onlineStore = pubResult.data.publications.edges.find(
      edge => edge.node.name === 'Online Store'
    );

    if (!onlineStore) {
      logger.warn('Online Store publication not found, product may not be visible');
      return null;
    }

    const mutation = `
      mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          publishable {
            ... on Product {
              id
              publishedAt
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      id: productId,
      input: [{ publicationId: onlineStore.node.id }]
    };

    const result = await this.query(mutation, variables);
    return result.data.publishablePublish.publishable;
  }

  async updateProductStatus(productId, status) {
    logger.info('Updating product status in Shopify', { productId, status });

    const mutation = `
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            status
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: {
        id: productId,
        status: status
      }
    };

    const result = await this.query(mutation, variables);
    return result.data.productUpdate.product;
  }

  async deleteDefaultVariant(productId, variantId) {
    logger.debug('Deleting default variant', { productId, variantId });

    const mutation = `
      mutation productVariantDelete($id: ID!) {
        productVariantDelete(id: $id) {
          deletedProductVariantId
          userErrors {
            field
            message
          }
        }
      }
    `;

    try {
      const result = await this.query(mutation, { id: variantId });
      return result.data.productVariantDelete.deletedProductVariantId;
    } catch (error) {
      logger.warn('Failed to delete default variant', { variantId, error: error.message });
      return null;
    }
  }

  async getProductById(productId) {
    logger.debug('Fetching product by ID', { productId });

    const query = `
      query getProduct($id: ID!) {
        product(id: $id) {
          id
          title
          handle
          status
          options {
            id
            name
            values
          }
          variants(first: 100) {
            edges {
              node {
                id
                sku
                title
                price
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
        }
      }
    `;

    const result = await this.query(query, { id: productId });
    return result.data.product;
  }

  extractProductIdFromGid(gid) {
    const match = gid.match(/gid:\/\/shopify\/Product\/(\d+)/);
    return match ? match[1] : null;
  }

  buildAdminUrl(productGid) {
    const numericId = this.extractProductIdFromGid(productGid);
    return `https://${this.shopDomain}/admin/products/${numericId}`;
  }

  async deleteProduct(productId) {
    logger.info('Deleting product from Shopify', { productId });

    const mutation = `
      mutation productDelete($input: ProductDeleteInput!) {
        productDelete(input: $input) {
          deletedProductId
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variables = {
      input: { id: productId }
    };

    const result = await this.query(mutation, variables);

    if (result.data.productDelete.userErrors?.length > 0) {
      const error = result.data.productDelete.userErrors[0];
      throw new Error(`Failed to delete product: ${error.message}`);
    }

    logger.info('Product deleted', { deletedProductId: result.data.productDelete.deletedProductId });
    return result.data.productDelete.deletedProductId;
  }

  async deleteProductByHandle(handle) {
    logger.info('Deleting product by handle', { handle });

    const product = await this.getProductByHandle(handle);
    if (!product) {
      logger.info('Product not found, nothing to delete', { handle });
      return null;
    }

    return this.deleteProduct(product.id);
  }
}

module.exports = ShopifyTargetService;
