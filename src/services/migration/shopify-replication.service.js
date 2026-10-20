const { createHash } = require('crypto');
const registry = require('../shopify/shopify-store-registry.service');
const mappings = require('../../database/repositories/shopify-product-mapping.repository');
const ShopifyProductSource = require('../shopify/shopify-product-source.service');
const ShopifyReplicationTarget = require('../shopify/shopify-replication-target.service');
const NotificationService = require('../notification/notification.service');
const { ValidationError } = require('../../utils/error-handler');

const optionKey = variant => JSON.stringify([...variant.selectedOptions]
  .sort((a, b) => a.name.localeCompare(b.name)).map(option => [option.name, option.value]));

function rewriteDescription(html, storefront) {
  const destination = new URL(storefront);
  if (!['https:', 'http:'].includes(destination.protocol)) throw new Error('Invalid destination storefront URL');
  // Match URL hosts, not arbitrary text, email addresses, or lookalike domains.
  return (html || '').replace(/(https?:\/\/|\/\/)(?:www\.)?vapordna\.com(?::\d+)?(?=[/?#\s"'<>)]|$)/gi,
    prefix => `${prefix.startsWith('//') ? '//' : destination.protocol + '//'}${destination.host}`);
}

class ShopifyReplicationService {
  constructor(dependencies = {}) {
    this.registry = dependencies.registry || registry;
    this.mappings = dependencies.mappings || mappings;
    this.notifications = dependencies.notifications || new NotificationService();
    this.sourceFor = dependencies.sourceFor || (client => new ShopifyProductSource(client));
    this.targetFor = dependencies.targetFor || (client => new ShopifyReplicationTarget(client));
  }

  async run(sourceProductId, options = {}, operation = 'create') {
    if (!['create', 'content', 'prices'].includes(operation)) throw new ValidationError('Unsupported operation');
    const numericId = String(sourceProductId || '');
    if (!/^(?:gid:\/\/shopify\/Product\/)?[1-9]\d*$/.test(numericId)) throw new ValidationError('A valid sourceProductId is required');
    const id = numericId.startsWith('gid:') ? numericId : `gid://shopify/Product/${numericId}`;
    const targets = options.targetShopifyStores;
    if (!Array.isArray(targets) || !targets.length || targets.some(store => typeof store !== 'string' || !store.trim())) {
      throw new ValidationError('Explicit targetShopifyStores are required');
    }
    if (options.productStatus && !['DRAFT', 'ACTIVE', 'ARCHIVED'].includes(options.productStatus)) throw new ValidationError('Invalid productStatus');
    const stores = [...new Set(targets.map(store => store.toLowerCase().trim()))];
    const sourceClient = await this.registry.getTargetService('vapordna');
    const source = this.sourceFor(sourceClient);
    const sourceShop = await source.shop();
    const product = await source.product(id);
    if (!product) throw Object.assign(new Error('Source product not found in VaporDNA'), { statusCode: 404 });
    this.validateSource(product);

    const start = Date.now();
    const result = {
      success: true, sourceStore: 'vapordna', sourceProductId: id, operation,
      sku: id, variantCount: product.variants.length, targetStores: stores, results: {}, errors: [], warnings: [],
      summary: { totalDuration: 0, variantsMigrated: 0, imagesUploaded: 0, storesSucceeded: 0 }
    };
    await this.notifyStart(operation, result, product);
    for (const store of stores) {
      try {
        const client = await this.registry.getTargetService(store);
        const reader = this.sourceFor(client);
        const shop = await reader.shop();
        if (shop.id === sourceShop.id) throw new Error('Source and destination must be different Shopify stores');
        const key = { source_shop: sourceShop.myshopifyDomain, source_product_id: id, target_shop: shop.myshopifyDomain };
        const handle = `migration-${createHash('sha256').update(`${key.source_shop}:${id}`).digest('hex').slice(0, 32)}`;
        const outcome = await this.mappings.withMapping(key, handle, async (mapping, save) => {
          try {
            return await this.replicate(product, shop, client, reader, mapping, save, options, operation);
          } catch (error) {
            // Commit successful checkpoints even when later work fails remotely.
            return { success: false, productId: mapping.target_product_id, error: error.message };
          }
        });
        result.results[store] = outcome;
        if (!outcome.success) throw new Error(outcome.error);
        result.summary.storesSucceeded++;
        result.summary.variantsMigrated += outcome.variantsCreated || 0;
        result.summary.imagesUploaded += outcome.imagesUploaded || 0;
        result.warnings.push(...(outcome.warnings || []).map(message => ({ store, message })));
      } catch (error) {
        result.success = false;
        result.results[store] = { ...result.results[store], success: false, error: error.message };
        result.errors.push({ store, message: error.message });
      }
    }
    result.summary.totalDuration = Date.now() - start;
    result.summary.errorsCount = result.errors.length;
    result.summary.warningsCount = result.warnings.length;
    await this.notifyEnd(operation, result);
    return result;
  }

  validateSource(product) {
    if (!product.variants.length) throw new ValidationError('Source product has no variants');
    const skus = product.variants.map(variant => variant.sku);
    if (skus.some(sku => !sku?.trim()) || new Set(skus).size !== skus.length) {
      throw new ValidationError('Source variants must have non-empty, unique SKUs');
    }
    const combinations = product.variants.map(optionKey);
    if (new Set(combinations).size !== combinations.length) throw new ValidationError('Source has duplicate variant options');
  }

  fields(product, shop) {
    return {
      title: product.title, descriptionHtml: rewriteDescription(product.descriptionHtml, shop.primaryDomain.url),
      vendor: product.vendor || '', productType: product.productType || '', tags: product.tags || [],
      seo: { title: product.seo?.title || '', description: product.seo?.description || '' }
    };
  }

  async replicate(product, shop, client, reader, mapping, save, options, operation) {
    const writer = this.targetFor(client);
    const fields = operation === 'prices' ? null : this.fields(product, shop);
    const warnings = [];
    let targetId = mapping.target_product_id;
    if (!targetId) {
      // A deterministic handle recovers a successful create whose response/checkpoint was lost.
      targetId = await reader.byHandle(mapping.creation_handle);
      if (targetId) await save({ target_product_id: targetId, created_by_migration: true });
      else {
        const matches = await reader.bySkus(product.variants.map(variant => variant.sku));
        const ids = [...new Set(matches.map(variant => variant.product.id))];
        if (ids.length > 1 || new Set(matches.map(variant => variant.sku)).size !== matches.length) {
          throw new Error('Ambiguous SKU matches in destination store');
        }
        targetId = ids[0];
        if (targetId) await save({ target_product_id: targetId });
        else if (operation !== 'create') throw new Error('Product not found in destination; migrate it first');
        else {
          targetId = await writer.createShell(product, mapping.creation_handle, fields, options.productStatus || 'DRAFT');
          await save({ target_product_id: targetId, created_by_migration: true });
        }
      }
    }
    let target = await reader.product(targetId);
    if (!target) throw new Error('Mapped destination product no longer exists');
    const initializing = mapping.created_by_migration && !mapping.initialized;
    const variantMap = { ...mapping.variants };
    this.matchVariants(product, target, variantMap, initializing);
    await save({ variants: variantMap });

    if (operation === 'prices') {
      const updates = [];
      for (const variant of product.variants) {
        if (!variantMap[variant.id]) throw new Error(`Variant ${variant.sku} is missing; run migration to add it first`);
        updates.push({ id: variantMap[variant.id], price: variant.price, compareAtPrice: variant.compareAtPrice });
      }
      await writer.variants(targetId, updates);
      return { success: true, productId: targetId, variantsUpdated: updates.length, warnings };
    }

    const missing = product.variants.filter(variant => !variantMap[variant.id]);
    let imagesUploaded = 0;
    const imageMap = { ...mapping.images };
    const additiveImages = operation === 'create' && !initializing;
    const writeImages = options.includeImages !== false && (initializing || operation === 'content' || missing.length > 0);
    const missingImageIds = new Set(missing.flatMap(variant => variant.media.nodes.map(media => media.id)));
    const selectedImages = additiveImages ? product.images.filter(image => missingImageIds.has(image.id)) : product.images;
    if (writeImages) {
      for (const image of selectedImages) {
        const cached = imageMap[image.id];
        if (!cached || cached.url !== image.image.url) {
          imageMap[image.id] = { ...await writer.upload(image), url: image.image.url };
          imagesUploaded++;
          await save({ images: imageMap });
        }
      }
      const detach = [];
      for (const variant of additiveImages ? [] : product.variants) {
        const current = target.variants.find(item => item.id === variantMap[variant.id]);
        const expected = imageMap[variant.media.nodes[0]?.id]?.id;
        const obsolete = (current?.media?.nodes || []).filter(media => media.id !== expected).map(media => media.id);
        if (obsolete.length) detach.push({ variantId: current.id, mediaIds: obsolete });
      }
      await writer.detachMedia(targetId, detach);
      // Uploads have all succeeded before replacing the product image list.
      const files = selectedImages.map(image => ({ ...imageMap[image.id], alt: image.alt || '' }));
      if (additiveImages) files.unshift(...target.images.map(image => ({ id: image.id, alt: image.alt || '' })));
      const uniqueFiles = [...new Map(files.map(file => [file.id, file])).values()];
      await writer.files(targetId, uniqueFiles);
    }

    if (operation === 'content' || initializing) await writer.content(targetId, fields);
    if (missing.length) {
      const sourceOptions = product.options.map(option => option.name).sort();
      const targetOptions = target.options.map(option => option.name).sort();
      if (JSON.stringify(sourceOptions) !== JSON.stringify(targetOptions)) {
        throw new Error('Destination option names differ from source; reconcile option structure before adding variants');
      }
      await writer.variants(targetId, missing.map(variant => this.variantInput(variant, imageMap, writeImages)), true);
      target = await reader.product(targetId);
      this.matchVariants(product, target, variantMap, false);
      await save({ variants: variantMap });
    }
    const updates = [];
    for (const variant of product.variants) {
      const id = variantMap[variant.id];
      if (!id) throw new Error(`Failed to map variant ${variant.sku}`);
      if (initializing) updates.push({ id, ...this.variantInput(variant, imageMap, writeImages) });
      else if (operation === 'content') {
        const update = { id, inventoryItem: { sku: variant.sku } };
        const mediaId = imageMap[variant.media.nodes[0]?.id]?.id;
        if (writeImages && mediaId) update.mediaId = mediaId;
        updates.push(update);
      }
    }
    await writer.variants(targetId, updates);
    if (initializing && product.handle) {
      const owner = await reader.byHandle(product.handle);
      if (owner && owner !== targetId) throw new Error('Source handle already belongs to another destination product');
      await writer.content(targetId, { handle: product.handle });
    }
    await save({ initialized: true });
    if (operation === 'create' && mapping.created_by_migration) {
      const publication = await client.publishProduct(targetId);
      if (!publication) warnings.push('No Online Store publication was available');
    }
    return { success: true, productId: targetId, mode: initializing ? 'created' : operation === 'create' ? 'variant-sync' : 'updated',
      variantsCreated: missing.length + (initializing ? target.variants.length - missing.length : 0), imagesUploaded, warnings };
  }

  matchVariants(source, target, map, initializing) {
    const used = new Set();
    for (const variant of source.variants) {
      let found;
      if (map[variant.id]) {
        found = target.variants.find(item => item.id === map[variant.id]);
      }
      if (!found) {
        // A fully paginated destination read proves the old ID is gone. Reconcile
        // by exact SKU, or let explicit migration add the missing variant again.
        delete map[variant.id];
        const matches = target.variants.filter(item => item.sku === variant.sku);
        if (matches.length > 1) throw new Error(`Ambiguous destination SKU: ${variant.sku}`);
        found = matches[0];
        if (!found && initializing) found = target.variants.find(item => !item.sku && optionKey(item) === optionKey(variant));
      }
      if (found) {
        if (used.has(found.id)) throw new Error(`Multiple source variants match destination ${found.id}`);
        used.add(found.id);
        map[variant.id] = found.id;
      } else if (target.variants.some(item => optionKey(item) === optionKey(variant))) {
        throw new Error(`Destination option combination conflicts with SKU ${variant.sku}`);
      }
    }
  }

  variantInput(variant, images, includeImages) {
    const input = {
      price: variant.price, compareAtPrice: variant.compareAtPrice,
      barcode: variant.barcode, taxable: variant.taxable, inventoryPolicy: variant.inventoryPolicy,
      inventoryItem: { sku: variant.sku, tracked: true },
      optionValues: variant.selectedOptions.map(option => ({ optionName: option.name, name: option.value }))
    };
    const weight = variant.inventoryItem?.measurement?.weight;
    if (weight) input.inventoryItem.measurement = { weight };
    const mediaId = images[variant.media.nodes[0]?.id]?.id;
    if (includeImages && mediaId) input.mediaId = mediaId;
    return input;
  }

  async notifyStart(operation, result, product) {
    if (operation === 'create') await this.notifications.notifyMigrationStart(result.sku, product.variants.map(v => v.sku), result.targetStores);
    else if (operation === 'content') await this.notifications.notifyProductUpdateStart(result.sku, result.targetStores);
    else await this.notifications.notifyPriceSyncStart(result.sku, product.variants.length, result.targetStores);
  }

  async notifyEnd(operation, result) {
    if (operation === 'create') await this.notifications.notifyMigrationEnd(result);
    else if (operation === 'content') await this.notifications.notifyProductUpdateEnd({ ...result, duration: result.summary.totalDuration });
    else await this.notifications.notifyPriceSyncEnd({ ...result, duration: result.summary.totalDuration,
      results: { magento: {}, shopify: result.results } });
  }
}
module.exports = ShopifyReplicationService;
module.exports.rewriteDescription = rewriteDescription;
