'use strict';

const axios = require('axios');
const config = require('../../config');
const logger = require('../../config/logger');
const TargetService = require('../magento/target.service');
const shopifyRegistry = require('../shopify/shopify-store-registry.service');
const { imageContentHash } = require('../../utils/image-deduplication');

class DuplicateImageRepairService {
  constructor({
    httpClient = axios,
    magentoServiceFactory = store => TargetService.getInstanceForStore(store),
    shopifyServiceFactory = store => shopifyRegistry.getTargetService(store)
  } = {}) {
    this.httpClient = httpClient;
    this.magentoServiceFactory = magentoServiceFactory;
    this.shopifyServiceFactory = shopifyServiceFactory;
  }

  slugify(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w-]+/g, '')
      .replace(/--+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  async downloadHash(url) {
    const response = await this.httpClient.get(url, {
      responseType: 'arraybuffer',
      timeout: config.api.timeout
    });
    return imageContentHash(Buffer.from(response.data));
  }

  async analyzeMedia(media, referenceCounts = new Map()) {
    const hashed = await Promise.all((media || []).map(async item => {
      try {
        return { ...item, hash: await this.downloadHash(item.url), error: null };
      } catch (error) {
        return { ...item, hash: null, error: error.message };
      }
    }));

    const byHash = new Map();
    for (const item of hashed) {
      if (!item.hash) continue;
      if (!byHash.has(item.hash)) byHash.set(item.hash, []);
      byHash.get(item.hash).push(item);
    }

    const duplicateGroups = [];
    for (const items of byHash.values()) {
      if (items.length < 2) continue;
      const ranked = [...items].sort((left, right) => {
        const referenceDifference =
          (referenceCounts.get(right.id) || 0) - (referenceCounts.get(left.id) || 0);
        if (referenceDifference !== 0) return referenceDifference;
        const roleDifference = (right.types?.length || 0) - (left.types?.length || 0);
        if (roleDifference !== 0) return roleDifference;
        return (left.position || 0) - (right.position || 0);
      });
      duplicateGroups.push({
        canonicalId: ranked[0].id,
        duplicateIds: ranked.slice(1).map(item => item.id)
      });
    }

    return {
      mediaCount: hashed.length,
      uniqueContentCount: byHash.size,
      duplicateCopies: duplicateGroups.reduce((sum, group) => sum + group.duplicateIds.length, 0),
      duplicateGroups,
      hashErrors: hashed.filter(item => item.error).map(item => ({ id: item.id, error: item.error }))
    };
  }

  async getShopifyInventory(shopifyService, productId) {
    const query = `
      query getProductImageInventory($id: ID!) {
        product(id: $id) {
          id
          title
          handle
          media(first: 250) {
            nodes {
              ... on MediaImage {
                id
                alt
                image { url }
              }
            }
          }
          variants(first: 100) {
            nodes {
              id
              sku
              media(first: 10) { nodes { id } }
            }
          }
        }
      }
    `;
    const response = await shopifyService.query(query, { id: productId });
    const product = response.data.product;
    if (!product) return null;
    return {
      ...product,
      media: (product.media?.nodes || [])
        .filter(item => item?.id && item?.image?.url)
        .map(item => ({ id: item.id, url: item.image.url, alt: item.alt || '' })),
      variants: product.variants?.nodes || []
    };
  }

  async findShopifyProduct(shopifyService, sku, handle) {
    const byHandle = await shopifyService.getProductByHandle(handle || this.slugify(sku));
    if (byHandle) return byHandle;

    const candidates = await shopifyService.searchProductsByTitle(sku, 10);
    const normalizedSku = String(sku).toLowerCase().replace(/[^a-z0-9]+/g, '');
    return candidates.find(candidate =>
      String(candidate.title).toLowerCase().replace(/[^a-z0-9]+/g, '') === normalizedSku
    ) || null;
  }

  async repairShopifyStore(storeName, sku, { handle, dryRun }) {
    const shopifyService = await this.shopifyServiceFactory(storeName);
    const product = await this.findShopifyProduct(shopifyService, sku, handle);
    if (!product) {
      return { success: false, platform: 'shopify', store: storeName, error: 'Product not found' };
    }

    const inventory = await this.getShopifyInventory(shopifyService, product.id);
    if (!inventory) {
      return { success: false, platform: 'shopify', store: storeName, error: 'Product media not found' };
    }

    const referenceCounts = new Map();
    for (const variant of inventory.variants) {
      for (const media of variant.media?.nodes || []) {
        referenceCounts.set(media.id, (referenceCounts.get(media.id) || 0) + 1);
      }
    }
    const before = await this.analyzeMedia(inventory.media, referenceCounts);

    if (!dryRun && before.duplicateCopies > 0) {
      const duplicateToCanonical = new Map();
      for (const group of before.duplicateGroups) {
        for (const duplicateId of group.duplicateIds) {
          duplicateToCanonical.set(duplicateId, group.canonicalId);
        }
      }

      const variantMedia = [];
      for (const variant of inventory.variants) {
        const currentIds = new Set((variant.media?.nodes || []).map(media => media.id));
        const canonicalIds = new Set();
        for (const mediaId of currentIds) {
          const canonicalId = duplicateToCanonical.get(mediaId);
          if (canonicalId && !currentIds.has(canonicalId)) canonicalIds.add(canonicalId);
        }
        if (canonicalIds.size > 0) {
          variantMedia.push({ variantId: variant.id, mediaIds: [...canonicalIds] });
        }
      }

      if (variantMedia.length > 0) {
        await shopifyService.appendMediaToVariants(product.id, variantMedia);
      }
      await shopifyService.deleteAllProductMedia(
        product.id,
        before.duplicateGroups.flatMap(group => group.duplicateIds)
      );
    }

    const after = dryRun
      ? null
      : await this.analyzeMedia((await this.getShopifyInventory(shopifyService, product.id)).media);
    const success = before.hashErrors.length === 0 && (dryRun || after.duplicateCopies === 0);
    return {
      success,
      platform: 'shopify',
      store: storeName,
      productId: product.id,
      handle: inventory.handle,
      dryRun,
      before,
      after
    };
  }

  magentoMediaUrl(targetService, file) {
    const path = String(file || '').startsWith('/') ? file : `/${file}`;
    return new URL(`/media/catalog/product${path}`, `${targetService._baseUrl}/`).toString();
  }

  async repairMagentoStore(storeName, sku, { dryRun }) {
    const targetService = this.magentoServiceFactory(storeName);
    const product = await targetService.getProductBySku(sku);
    if (!product) {
      return { success: false, platform: 'magento', store: storeName, error: 'Product not found' };
    }

    const media = (product.media_gallery_entries || [])
      .filter(entry => entry?.id && entry?.file && !entry.disabled)
      .map(entry => ({
        id: entry.id,
        url: this.magentoMediaUrl(targetService, entry.file),
        file: entry.file,
        position: entry.position,
        types: entry.types || []
      }));
    const before = await this.analyzeMedia(media);
    const deletionErrors = [];

    if (!dryRun && before.duplicateCopies > 0) {
      for (const duplicateId of before.duplicateGroups.flatMap(group => group.duplicateIds)) {
        try {
          await targetService.delete(
            `/rest/V1/products/${encodeURIComponent(sku)}/media/${duplicateId}`
          );
        } catch (error) {
          deletionErrors.push({ id: duplicateId, error: error.message });
        }
      }
    }

    let after = null;
    if (!dryRun) {
      const verifiedProduct = await targetService.getProductBySku(sku);
      const verifiedMedia = (verifiedProduct?.media_gallery_entries || [])
        .filter(entry => entry?.id && entry?.file && !entry.disabled)
        .map(entry => ({
          id: entry.id,
          url: this.magentoMediaUrl(targetService, entry.file),
          file: entry.file,
          position: entry.position,
          types: entry.types || []
        }));
      after = await this.analyzeMedia(verifiedMedia);
    }

    const success = before.hashErrors.length === 0 && deletionErrors.length === 0 &&
      (dryRun || after.duplicateCopies === 0);
    return {
      success,
      platform: 'magento',
      store: storeName,
      sku,
      dryRun,
      before,
      after,
      deletionErrors
    };
  }

  async repair(sku, options = {}) {
    const dryRun = options.dryRun !== false;
    const results = { magento: {}, shopify: {} };

    for (const store of options.targetMagentoStores || []) {
      try {
        results.magento[store] = await this.repairMagentoStore(store, sku, { dryRun });
      } catch (error) {
        logger.error('Magento duplicate-image repair failed', { store, sku, error: error.message });
        results.magento[store] = { success: false, platform: 'magento', store, error: error.message };
      }
    }

    for (const store of options.targetShopifyStores || []) {
      try {
        results.shopify[store] = await this.repairShopifyStore(store, sku, {
          dryRun,
          handle: options.shopifyHandles?.[store]
        });
      } catch (error) {
        logger.error('Shopify duplicate-image repair failed', { store, sku, error: error.message });
        results.shopify[store] = { success: false, platform: 'shopify', store, error: error.message };
      }
    }

    const outcomes = [
      ...Object.values(results.magento),
      ...Object.values(results.shopify)
    ];
    return {
      success: outcomes.length > 0 && outcomes.every(result => result.success),
      sku,
      dryRun,
      results
    };
  }
}

module.exports = DuplicateImageRepairService;
