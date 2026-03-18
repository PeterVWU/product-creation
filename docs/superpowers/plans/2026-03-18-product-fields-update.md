# Product Fields Update Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/v1/sync/product-fields` to push name, brand, categories, images, description, and SEO fields from source Magento to all configured Magento and Shopify target stores.

**Architecture:** A new `ProductUpdateService` in `src/services/sync/` mirrors the `PriceSyncService` pattern: extract once from source, fan out to Magento targets (global fields via `/rest/all/`, store-view fields via scoped instances) and Shopify stores. Magento target and Shopify target services each gain a `deleteAllProductMedia` method; Shopify gains `updateProductFields`.

**Tech Stack:** Node.js, Express, Jest, Magento REST API, Shopify GraphQL Admin API

**Spec:** `docs/superpowers/specs/2026-03-18-product-fields-update-design.md`

---

## Chunk 1: Magento target — deleteAllProductMedia + Google Chat notifications

### Task 1: Add `deleteAllProductMedia` to Magento TargetService

**Files:**
- Modify: `src/services/magento/target.service.js`
- Modify: `tests/services/magento/target.service.test.js`

- [ ] **Step 1: Write the failing test**

Add to `tests/services/magento/target.service.test.js` after the existing `updateProductPrice` describe block:

```js
  describe('deleteAllProductMedia', () => {
    let deleteSpy;

    beforeEach(() => {
      deleteSpy = jest.spyOn(service, 'delete').mockResolvedValue({});
    });

    it('deletes each media entry by id', async () => {
      const entries = [
        { id: 1, file: '/a.jpg' },
        { id: 2, file: '/b.jpg' }
      ];
      await service.deleteAllProductMedia('TEST-SKU', entries);
      expect(deleteSpy).toHaveBeenCalledTimes(2);
      expect(deleteSpy).toHaveBeenCalledWith('/rest/V1/products/TEST-SKU/media/1');
      expect(deleteSpy).toHaveBeenCalledWith('/rest/V1/products/TEST-SKU/media/2');
    });

    it('does nothing when entries array is empty', async () => {
      await service.deleteAllProductMedia('TEST-SKU', []);
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('does nothing when entries is null', async () => {
      await service.deleteAllProductMedia('TEST-SKU', null);
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('continues and logs when one deletion fails', async () => {
      const entries = [
        { id: 1, file: '/a.jpg' },
        { id: 2, file: '/b.jpg' }
      ];
      deleteSpy.mockRejectedValueOnce(new Error('network error'));
      // Should not throw
      await expect(service.deleteAllProductMedia('TEST-SKU', entries)).resolves.not.toThrow();
      // Both deletions attempted
      expect(deleteSpy).toHaveBeenCalledTimes(2);
    });

    it('URL-encodes SKUs with special characters', async () => {
      const entries = [{ id: 5, file: '/x.jpg' }];
      await service.deleteAllProductMedia('SKU/001', entries);
      expect(deleteSpy).toHaveBeenCalledWith('/rest/V1/products/SKU%2F001/media/5');
    });
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd /home/vwu/development/playground/product-creation
npx jest tests/services/magento/target.service.test.js -t "deleteAllProductMedia" 2>&1 | tail -20
```

Expected: FAIL — `service.deleteAllProductMedia is not a function`

- [ ] **Step 3: Implement `deleteAllProductMedia` in TargetService**

Add after `uploadProductImage` method in `src/services/magento/target.service.js`:

```js
  /**
   * Delete all media entries for a product. Best-effort — individual failures are logged and skipped.
   * @param {string} sku - Product SKU
   * @param {Array} mediaEntries - Array of media entry objects with at least an `id` field
   */
  async deleteAllProductMedia(sku, mediaEntries) {
    if (!mediaEntries || mediaEntries.length === 0) return;

    logger.info('Deleting all product media', { sku, count: mediaEntries.length });

    for (const entry of mediaEntries) {
      try {
        await this.delete(`/rest/V1/products/${encodeURIComponent(sku)}/media/${entry.id}`);
        logger.debug('Deleted media entry', { sku, entryId: entry.id });
      } catch (error) {
        logger.warn('Failed to delete media entry, skipping', {
          sku,
          entryId: entry.id,
          error: error.message
        });
      }
    }

    logger.info('Product media deletion complete', { sku });
  }
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx jest tests/services/magento/target.service.test.js 2>&1 | tail -15
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/magento/target.service.js tests/services/magento/target.service.test.js
git commit -m "feat: add deleteAllProductMedia to Magento TargetService"
```

---

### Task 2: Add Google Chat notification methods

**Files:**
- Modify: `src/services/notification/google-chat.service.js`

No unit tests needed for notification card shape — Google Chat integration is tested via the existing send-message pattern (notifications are best-effort fire-and-forget; logic is trivial card building).

- [ ] **Step 1: Add `notifyProductUpdateStart` and `notifyProductUpdateEnd`**

Add after `notifyPriceSyncEnd` in `src/services/notification/google-chat.service.js`:

```js
  async notifyProductUpdateStart(sku, targetStores = []) {
    const widgets = [
      {
        decoratedText: {
          text: `<b>SKU:</b> ${sku}`
        }
      }
    ];

    if (targetStores.length > 0) {
      widgets.push({
        decoratedText: {
          text: `<b>Target Stores:</b> ${targetStores.join(', ')}`
        }
      });
    }

    const card = {
      cardsV2: [{
        cardId: 'product-update-start',
        card: {
          sections: [{
            header: '✏️ Product Fields Update Started',
            widgets
          }]
        }
      }]
    };

    await this.sendMessage(card);
  }

  async notifyProductUpdateEnd({ sku, success, errors = [], targetStores = [], duration }) {
    const statusText = success ? 'Completed Successfully' : 'Failed';
    const sectionHeader = success ? '✅ Product Fields Update Completed' : '❌ Product Fields Update Failed';

    const widgets = [
      {
        decoratedText: {
          text: `<b>SKU:</b> ${sku}`
        }
      },
      {
        decoratedText: {
          text: `<b>Status:</b> ${statusText}`
        }
      },
      {
        decoratedText: {
          text: `<b>Duration:</b> ${duration}ms`
        }
      }
    ];

    if (!success && errors && errors.length > 0) {
      const errorMessage = errors[errors.length - 1].message;
      widgets.push({
        decoratedText: {
          text: `<b>Error:</b> ${errorMessage}`
        }
      });
    }

    if (targetStores.length > 0) {
      widgets.push({
        decoratedText: {
          text: `<b>Target Stores:</b> ${targetStores.join(', ')}`
        }
      });
    }

    const card = {
      cardsV2: [{
        cardId: 'product-update-end',
        card: {
          sections: [{
            header: sectionHeader,
            widgets
          }]
        }
      }]
    };

    await this.sendMessage(card);
  }
```

- [ ] **Step 2: Run existing tests to confirm nothing broke**

```bash
npx jest 2>&1 | tail -15
```

Expected: all existing tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/services/notification/google-chat.service.js
git commit -m "feat: add product update start/end notifications to GoogleChatService"
```

---

## Chunk 2: Shopify target — updateProductFields + deleteAllProductMedia

### Task 3: Add `deleteAllProductMedia` to ShopifyTargetService

**Files:**
- Modify: `src/services/shopify/shopify-target.service.js`
- Modify: `tests/services/shopify/shopify-target.service.test.js`

First, read the existing test file to understand mock setup:

```bash
head -60 tests/services/shopify/shopify-target.service.test.js
```

- [ ] **Step 1: Write the failing test**

The existing test file mocks `service.query`. Add a new `describe` block for `deleteAllProductMedia`:

```js
  describe('deleteAllProductMedia', () => {
    it('calls productDeleteMedia mutation with all media IDs', async () => {
      service.query = jest.fn().mockResolvedValue({
        data: {
          productDeleteMedia: {
            deletedMediaIds: ['gid://shopify/MediaImage/1', 'gid://shopify/MediaImage/2'],
            mediaUserErrors: []
          }
        }
      });

      await service.deleteAllProductMedia(
        'gid://shopify/Product/123',
        ['gid://shopify/MediaImage/1', 'gid://shopify/MediaImage/2']
      );

      expect(service.query).toHaveBeenCalledWith(
        expect.stringContaining('productDeleteMedia'),
        {
          productId: 'gid://shopify/Product/123',
          mediaIds: ['gid://shopify/MediaImage/1', 'gid://shopify/MediaImage/2']
        }
      );
    });

    it('does nothing when mediaIds is empty', async () => {
      service.query = jest.fn();
      await service.deleteAllProductMedia('gid://shopify/Product/123', []);
      expect(service.query).not.toHaveBeenCalled();
    });

    it('throws when mutation returns userErrors', async () => {
      service.query = jest.fn().mockResolvedValue({
        data: {
          productDeleteMedia: {
            deletedMediaIds: [],
            mediaUserErrors: [{ field: 'mediaIds', message: 'invalid id' }]
          }
        }
      });

      await expect(
        service.deleteAllProductMedia('gid://shopify/Product/123', ['gid://shopify/MediaImage/1'])
      ).rejects.toThrow('invalid id');
    });
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx jest tests/services/shopify/shopify-target.service.test.js --testNamePattern="deleteAllProductMedia" 2>&1 | tail -15
```

Expected: FAIL — `service.deleteAllProductMedia is not a function`

- [ ] **Step 3: Implement `deleteAllProductMedia` in ShopifyTargetService**

Add before `deleteProduct` method in `src/services/shopify/shopify-target.service.js`:

```js
  /**
   * Delete all media from a Shopify product by media ID list.
   * Throws if the mutation returns userErrors.
   * @param {string} productId - Shopify product GID
   * @param {string[]} mediaIds - Array of media GIDs to delete
   */
  async deleteAllProductMedia(productId, mediaIds) {
    if (!mediaIds || mediaIds.length === 0) return;

    logger.info('Deleting all product media', { productId, count: mediaIds.length });

    const mutation = `
      mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
          deletedMediaIds
          mediaUserErrors {
            field
            message
          }
        }
      }
    `;

    const result = await this.query(mutation, { productId, mediaIds });

    const errors = result.data.productDeleteMedia.mediaUserErrors;
    if (errors && errors.length > 0) {
      throw new Error(`Media deletion failed: ${errors.map(e => e.message).join(', ')}`);
    }

    logger.info('Product media deleted', {
      productId,
      deletedCount: result.data.productDeleteMedia.deletedMediaIds?.length || 0
    });
  }
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx jest tests/services/shopify/shopify-target.service.test.js 2>&1 | tail -15
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/shopify/shopify-target.service.js tests/services/shopify/shopify-target.service.test.js
git commit -m "feat: add deleteAllProductMedia to ShopifyTargetService"
```

---

### Task 4: Add `updateProductFields` to ShopifyTargetService

**Files:**
- Modify: `src/services/shopify/shopify-target.service.js`
- Modify: `tests/services/shopify/shopify-target.service.test.js`

- [ ] **Step 1: Write the failing test**

```js
  describe('updateProductFields', () => {
    it('calls productUpdate mutation with all provided fields', async () => {
      service.query = jest.fn().mockResolvedValue({
        data: {
          productUpdate: {
            product: { id: 'gid://shopify/Product/123', title: 'New Name' },
            userErrors: []
          }
        }
      });

      const fields = {
        title: 'New Name',
        vendor: 'BrandCo',
        descriptionHtml: '<p>desc</p>',
        productType: 'Accessories',
        seoTitle: 'SEO Title',
        seoDescription: 'SEO Desc',
        tags: ['kw1', 'kw2']
      };

      await service.updateProductFields('gid://shopify/Product/123', fields);

      const callArgs = service.query.mock.calls[0];
      expect(callArgs[0]).toContain('productUpdate');
      expect(callArgs[1].input).toMatchObject({
        id: 'gid://shopify/Product/123',
        title: 'New Name',
        vendor: 'BrandCo',
        descriptionHtml: '<p>desc</p>',
        productType: 'Accessories',
        seo: { title: 'SEO Title', description: 'SEO Desc' },
        tags: ['kw1', 'kw2']
      });
    });

    it('omits vendor from input when it is null', async () => {
      service.query = jest.fn().mockResolvedValue({
        data: { productUpdate: { product: { id: 'gid://shopify/Product/123' }, userErrors: [] } }
      });

      await service.updateProductFields('gid://shopify/Product/123', {
        title: 'Test',
        vendor: null,
        descriptionHtml: '',
        productType: '',
        seoTitle: null,
        seoDescription: null,
        tags: []
      });

      const input = service.query.mock.calls[0][1].input;
      expect(input.vendor).toBeUndefined();
    });

    it('omits seo.title when seoTitle is null', async () => {
      service.query = jest.fn().mockResolvedValue({
        data: { productUpdate: { product: { id: 'gid://shopify/Product/123' }, userErrors: [] } }
      });

      await service.updateProductFields('gid://shopify/Product/123', {
        title: 'T', vendor: 'B', descriptionHtml: '', productType: '',
        seoTitle: null, seoDescription: 'desc', tags: []
      });

      const input = service.query.mock.calls[0][1].input;
      expect(input.seo.title).toBeUndefined();
      expect(input.seo.description).toBe('desc');
    });

    it('throws when userErrors are returned', async () => {
      service.query = jest.fn().mockResolvedValue({
        data: {
          productUpdate: {
            product: null,
            userErrors: [{ field: 'title', message: 'is blank' }]
          }
        }
      });

      await expect(
        service.updateProductFields('gid://shopify/Product/123', {
          title: '', vendor: null, descriptionHtml: '', productType: '',
          seoTitle: null, seoDescription: null, tags: []
        })
      ).rejects.toThrow('is blank');
    });
  });
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx jest tests/services/shopify/shopify-target.service.test.js --testNamePattern="updateProductFields" 2>&1 | tail -15
```

Expected: FAIL — `service.updateProductFields is not a function`

- [ ] **Step 3: Implement `updateProductFields` in ShopifyTargetService**

Add before `deleteAllProductMedia` in `src/services/shopify/shopify-target.service.js`:

```js
  /**
   * Update product content fields using the productUpdate mutation.
   * Null values for optional fields (vendor, seoTitle, seoDescription) are omitted
   * to preserve existing Shopify values.
   * @param {string} productId - Shopify product GID
   * @param {Object} fields
   * @param {string} fields.title
   * @param {string|null} fields.vendor
   * @param {string} fields.descriptionHtml
   * @param {string} fields.productType
   * @param {string|null} fields.seoTitle
   * @param {string|null} fields.seoDescription
   * @param {string[]} fields.tags
   */
  async updateProductFields(productId, fields) {
    logger.info('Updating product fields in Shopify', { productId });

    const { title, vendor, descriptionHtml, productType, seoTitle, seoDescription, tags } = fields;

    const input = {
      id: productId,
      title,
      descriptionHtml,
      productType,
      tags,
      seo: {}
    };

    if (vendor !== null && vendor !== undefined) {
      input.vendor = vendor;
    }
    if (seoTitle !== null && seoTitle !== undefined) {
      input.seo.title = seoTitle;
    }
    if (seoDescription !== null && seoDescription !== undefined) {
      input.seo.description = seoDescription;
    }

    const mutation = `
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            title
            vendor
            productType
            tags
            seo {
              title
              description
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const result = await this.query(mutation, { input });

    const errors = result.data.productUpdate.userErrors;
    if (errors && errors.length > 0) {
      throw new Error(`Product update failed: ${errors.map(e => e.message).join(', ')}`);
    }

    logger.info('Product fields updated in Shopify', { productId });
    return result.data.productUpdate.product;
  }
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx jest tests/services/shopify/shopify-target.service.test.js 2>&1 | tail -15
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/shopify/shopify-target.service.js tests/services/shopify/shopify-target.service.test.js
git commit -m "feat: add updateProductFields to ShopifyTargetService"
```

---

## Chunk 3: ProductUpdateService

> **Prerequisite:** Chunks 1 and 2 must be completed first. `targetService.deleteAllProductMedia` (added in Chunk 1, Task 1) and `notifyProductUpdateStart`/`notifyProductUpdateEnd` (added in Chunk 1, Task 2) are called by `ProductUpdateService`. `shopifyService.deleteAllProductMedia` (added in Chunk 2, Task 3) is called by `updateShopifyStore`.

### Task 5: Create ProductUpdateService — extraction + helper methods

**Files:**
- Create: `src/services/sync/product-update.service.js`
- Create: `tests/services/sync/product-update.service.test.js`

- [ ] **Step 1: Write the failing tests for extraction helpers**

Create `tests/services/sync/product-update.service.test.js`:

```js
'use strict';

jest.mock('../../../src/services/magento/source.service');
jest.mock('../../../src/services/magento/target.service');
jest.mock('../../../src/services/shopify/shopify-target.service');
jest.mock('../../../src/services/notification/google-chat.service');
jest.mock('../../../src/services/attribute.service');
jest.mock('../../../src/services/category-mapping.service');
jest.mock('../../../src/config', () => ({
  source: { baseUrl: 'http://source.test', token: 'tok' },
  api: {},
  shopify: { stores: { myshopify: { url: 'x.myshopify.com', token: 'st' } }, apiVersion: '2025-01' },
  magentoStores: { ejuices: { url: 'http://ejuices.test', token: 'mt' } },
  errorHandling: { continueOnError: true }
}));

const ProductUpdateService = require('../../../src/services/sync/product-update.service');

describe('ProductUpdateService', () => {
  let service;

  beforeEach(() => {
    service = new ProductUpdateService();
  });

  // ── classifyProductType ─────────────────────────────────────────────────────

  describe('classifyProductType', () => {
    it('returns "configurable" for configurable products', () => {
      expect(service.classifyProductType({ type_id: 'configurable', visibility: 4 }))
        .toBe('configurable');
    });

    it('returns "standalone-simple" for simple product with visibility > 1', () => {
      expect(service.classifyProductType({ type_id: 'simple', visibility: 4, sku: 'X' }))
        .toBe('standalone-simple');
    });

    it('throws for simple product with visibility === 1', () => {
      expect(() => service.classifyProductType({ type_id: 'simple', visibility: 1, sku: 'X' }))
        .toThrow('child simple');
    });

    it('throws for unsupported product type', () => {
      expect(() => service.classifyProductType({ type_id: 'bundle', sku: 'X' }))
        .toThrow('Unsupported product type');
    });

    it('throws when type_id is missing', () => {
      expect(() => service.classifyProductType({ sku: 'X' }))
        .toThrow();
    });
  });

  // ── extractCustomAttribute ─────────────────────────────────────────────────

  describe('extractCustomAttribute', () => {
    const product = {
      custom_attributes: [
        { attribute_code: 'description', value: 'Great product' },
        { attribute_code: 'meta_title', value: 'Meta T' }
      ]
    };

    it('returns value for existing attribute', () => {
      expect(service.extractCustomAttribute(product, 'description')).toBe('Great product');
    });

    it('returns null for missing attribute', () => {
      expect(service.extractCustomAttribute(product, 'meta_keyword')).toBeNull();
    });

    it('returns null when custom_attributes is absent', () => {
      expect(service.extractCustomAttribute({}, 'description')).toBeNull();
    });
  });

  // ── parseMetaKeywordsToTags ────────────────────────────────────────────────

  describe('parseMetaKeywordsToTags', () => {
    it('splits comma-separated keywords into trimmed array', () => {
      expect(service.parseMetaKeywordsToTags('a, b,  c ')).toEqual(['a', 'b', 'c']);
    });

    it('returns empty array for null input', () => {
      expect(service.parseMetaKeywordsToTags(null)).toEqual([]);
    });

    it('returns empty array for empty string', () => {
      expect(service.parseMetaKeywordsToTags('')).toEqual([]);
    });

    it('returns single-element array for no commas', () => {
      expect(service.parseMetaKeywordsToTags('keyword')).toEqual(['keyword']);
    });
  });

  // ── resolveMagentoTargetStores ────────────────────────────────────────────

  describe('resolveMagentoTargetStores', () => {
    it('returns provided stores when specified', () => {
      expect(service.resolveMagentoTargetStores(['ejuices'])).toEqual(['ejuices']);
    });

    it('defaults to all config.magentoStores when omitted', () => {
      expect(service.resolveMagentoTargetStores(undefined)).toEqual(['ejuices']);
    });

    it('defaults to all config.magentoStores for empty array', () => {
      expect(service.resolveMagentoTargetStores([])).toEqual(['ejuices']);
    });
  });

  // ── resolveShopifyTargetStores ────────────────────────────────────────────

  describe('resolveShopifyTargetStores', () => {
    it('returns provided stores when specified', () => {
      expect(service.resolveShopifyTargetStores(['myshopify'])).toEqual(['myshopify']);
    });

    it('defaults to all configured Shopify stores when omitted', () => {
      expect(service.resolveShopifyTargetStores(undefined)).toEqual(['myshopify']);
    });
  });

  // ── extractChildLinks ─────────────────────────────────────────────────────

  describe('extractChildLinks', () => {
    it('returns links from configurable_product_link_data', () => {
      const product = {
        extension_attributes: {
          configurable_product_link_data: [
            JSON.stringify({ simple_product_sku: 'CHILD-001', simple_product_id: 1 })
          ]
        }
      };
      expect(service.extractChildLinks(product)).toEqual([{ sku: 'CHILD-001', id: 1 }]);
    });

    it('returns empty array when no link data present', () => {
      expect(service.extractChildLinks({ extension_attributes: {} })).toEqual([]);
    });
  });

  // ── buildSourceImageUrls ──────────────────────────────────────────────────

  describe('buildSourceImageUrls', () => {
    it('prepends source base URL to relative image paths', () => {
      const entries = [
        { file: '/a/b.jpg', label: 'Front' },
        { file: '/c/d.jpg', label: 'Back' }
      ];
      const urls = service.buildSourceImageUrls(entries);
      expect(urls).toEqual([
        { url: 'http://source.test/media/catalog/product/a/b.jpg', alt: 'Front' },
        { url: 'http://source.test/media/catalog/product/c/d.jpg', alt: 'Back' }
      ]);
    });

    it('returns empty array for empty entries', () => {
      expect(service.buildSourceImageUrls([])).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npx jest tests/services/sync/product-update.service.test.js 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module '../../../src/services/sync/product-update.service'`

- [ ] **Step 3: Create the service skeleton with helper methods**

Create `src/services/sync/product-update.service.js`:

```js
'use strict';

const logger = require('../../config/logger');
const config = require('../../config');
const SourceService = require('../magento/source.service');
const TargetService = require('../magento/target.service');
const ShopifyTargetService = require('../shopify/shopify-target.service');
const AttributeService = require('../attribute.service');
const CategoryMappingService = require('../category-mapping.service');
const GoogleChatService = require('../notification/google-chat.service');
const { ExtractionError } = require('../../utils/error-handler');

class ProductUpdateService {
  constructor() {
    this.sourceService = new SourceService(
      config.source.baseUrl,
      config.source.token,
      config.api
    );
    this.attributeService = new AttributeService(this.sourceService);
    this.categoryMappingService = new CategoryMappingService();
    this.shopifyStores = config.shopify.stores;
    this.googleChatService = new GoogleChatService();
  }

  // ── Product type classification ──────────────────────────────────────────

  classifyProductType(product) {
    if (!product || !product.type_id) {
      throw new ExtractionError(`Product type could not be determined for SKU: ${product?.sku}`);
    }
    if (product.type_id === 'configurable') return 'configurable';
    if (product.type_id === 'simple') {
      if (product.visibility === 1) {
        throw new ExtractionError(
          `Product ${product.sku} is a child simple (non-standalone). Pass the parent SKU instead.`
        );
      }
      return 'standalone-simple';
    }
    throw new ExtractionError(`Unsupported product type: ${product.type_id} for SKU: ${product.sku}`);
  }

  // ── Custom attribute helpers ─────────────────────────────────────────────

  extractCustomAttribute(product, code) {
    if (!product.custom_attributes) return null;
    const attr = product.custom_attributes.find(a => a.attribute_code === code);
    return attr ? attr.value : null;
  }

  parseMetaKeywordsToTags(metaKeyword) {
    if (!metaKeyword) return [];
    return metaKeyword.split(',').map(k => k.trim()).filter(k => k.length > 0);
  }

  // ── Store resolvers ──────────────────────────────────────────────────────

  resolveMagentoTargetStores(optionStores) {
    if (optionStores && Array.isArray(optionStores) && optionStores.length > 0) {
      return optionStores.map(s => s.toLowerCase());
    }
    // Default to ALL configured Magento stores (differs from PriceSyncService which defaults to [])
    return Object.keys(config.magentoStores);
  }

  resolveShopifyTargetStores(optionStores) {
    const available = Object.keys(this.shopifyStores);
    if (optionStores && Array.isArray(optionStores) && optionStores.length > 0) {
      return optionStores.filter(s => available.includes(s.toLowerCase())).map(s => s.toLowerCase());
    }
    return available;
  }

  // ── Child link extraction (mirrors PriceSyncService.extractChildLinks) ───

  extractChildLinks(parent) {
    const links = [];
    if (parent.extension_attributes?.configurable_product_link_data) {
      for (const dataStr of parent.extension_attributes.configurable_product_link_data) {
        try {
          const data = JSON.parse(dataStr);
          if (data.simple_product_sku) {
            links.push({ sku: data.simple_product_sku, id: data.simple_product_id });
          }
        } catch (error) {
          logger.warn('Failed to parse configurable_product_link_data', { error: error.message });
        }
      }
      return links;
    }
    if (parent.extension_attributes?.configurable_product_links) {
      return parent.extension_attributes.configurable_product_links.map(link =>
        typeof link === 'object' ? link : { sku: link }
      );
    }
    return links;
  }

  // ── Image URL builder ────────────────────────────────────────────────────

  buildSourceImageUrls(mediaEntries) {
    const baseUrl = config.source.baseUrl;
    return (mediaEntries || []).map(entry => ({
      url: `${baseUrl}/media/catalog/product${entry.file}`,
      alt: entry.label || ''
    }));
  }
}

module.exports = ProductUpdateService;
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx jest tests/services/sync/product-update.service.test.js 2>&1 | tail -15
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/sync/product-update.service.js tests/services/sync/product-update.service.test.js
git commit -m "feat: add ProductUpdateService skeleton with helper methods"
```

---

### Task 6: ProductUpdateService — Magento update flow

**Files:**
- Modify: `src/services/sync/product-update.service.js`
- Modify: `tests/services/sync/product-update.service.test.js`

- [ ] **Step 1: Write the failing tests for `updateMagentoStore`**

Add to `tests/services/sync/product-update.service.test.js` inside the main `describe` block:

```js
  // ── updateMagentoStore ────────────────────────────────────────────────────

  describe('updateMagentoStore', () => {
    const TargetService = require('../../../src/services/magento/target.service');

    const sourceProduct = {
      sku: 'PARENT-001',
      name: 'My Product',
      media_gallery_entries: [{ id: 10, file: '/a/img.jpg', label: 'Front' }],
      custom_attributes: [
        { attribute_code: 'description', value: '<p>desc</p>' },
        { attribute_code: 'brand', value: '42' },
        { attribute_code: 'meta_title', value: 'MT' },
        { attribute_code: 'meta_keyword', value: 'kw1, kw2' },
        { attribute_code: 'meta_description', value: 'MD' }
      ],
      extension_attributes: {
        category_links: [{ category_id: '5' }]
      }
    };

    const extractedData = {
      sourceProduct,
      brandLabel: 'BrandCo',
      categories: [{ id: '5', name: 'Vapes' }]
    };

    let mockTargetInstance;

    beforeEach(() => {
      mockTargetInstance = {
        getProductBySku: jest.fn().mockResolvedValue({ sku: 'PARENT-001', media_gallery_entries: [] }),
        ensureAttributeOptionExists: jest.fn().mockResolvedValue({ value: '99' }),
        getCategoryIdByName: jest.fn().mockResolvedValue(7),
        client: { put: jest.fn().mockResolvedValue({}) },
        deleteAllProductMedia: jest.fn().mockResolvedValue(undefined),
        uploadProductImage: jest.fn().mockResolvedValue({}),
        getStoreWebsiteMapping: jest.fn().mockResolvedValue({ default: 1 }),
        createScopedInstance: jest.fn().mockReturnValue({
          updateProduct: jest.fn().mockResolvedValue({})
        })
      };
      TargetService.getInstanceForStore = jest.fn().mockReturnValue(mockTargetInstance);

      // Stub categoryMappingService
      service.categoryMappingService.getTargetMagentoCategories = jest.fn().mockReturnValue(['Vapes']);

      // Stub sourceService.downloadImage
      service.sourceService.downloadImage = jest.fn().mockResolvedValue({
        buffer: Buffer.from('img'),
        contentType: 'image/jpeg'
      });
    });

    it('returns success: false when product not found on target', async () => {
      mockTargetInstance.getProductBySku.mockResolvedValue(null);

      const result = await service.updateMagentoStore('ejuices', extractedData);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it('PUTs global fields via /rest/all/ endpoint', async () => {
      await service.updateMagentoStore('ejuices', extractedData);

      expect(mockTargetInstance.client.put).toHaveBeenCalledWith(
        expect.stringContaining('/rest/all/V1/products/PARENT-001'),
        expect.objectContaining({
          product: expect.objectContaining({
            sku: 'PARENT-001',
            custom_attributes: expect.arrayContaining([
              expect.objectContaining({ attribute_code: 'brand' })
            ])
          })
        })
      );
    });

    it('updates store-view scoped fields on each store view', async () => {
      await service.updateMagentoStore('ejuices', extractedData);

      expect(mockTargetInstance.getStoreWebsiteMapping).toHaveBeenCalled();
      expect(mockTargetInstance.createScopedInstance).toHaveBeenCalledWith('default');
      const scopedService = mockTargetInstance.createScopedInstance.mock.results[0].value;
      expect(scopedService.updateProduct).toHaveBeenCalledWith(
        'PARENT-001',
        expect.objectContaining({
          name: 'My Product'
        })
      );
    });

    it('returns success: true on happy path', async () => {
      const result = await service.updateMagentoStore('ejuices', extractedData);
      expect(result.success).toBe(true);
    });

    it('includes warning when brand translation fails', async () => {
      mockTargetInstance.ensureAttributeOptionExists.mockRejectedValue(new Error('option error'));

      const result = await service.updateMagentoStore('ejuices', extractedData);

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'brand' })])
      );
    });
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npx jest tests/services/sync/product-update.service.test.js --testNamePattern="updateMagentoStore" 2>&1 | tail -20
```

Expected: FAIL — `service.updateMagentoStore is not a function`

- [ ] **Step 3: Implement `updateMagentoStore` in ProductUpdateService**

Add inside the class in `src/services/sync/product-update.service.js`:

```js
  /**
   * Update content fields for one Magento target store.
   * @param {string} storeName
   * @param {Object} extractedData - { sourceProduct, brandLabel, categories }
   * @returns {Object} { success, warnings, error? }
   */
  async updateMagentoStore(storeName, extractedData) {
    const { sourceProduct, brandLabel, categories } = extractedData;
    const sku = sourceProduct.sku;
    const warnings = [];

    const targetService = TargetService.getInstanceForStore(storeName);

    // ── Step A: Global-scope fields (once per instance) ──────────────────

    // 1. Existence check
    const existingProduct = await targetService.getProductBySku(sku);
    if (!existingProduct) {
      return { success: false, error: 'Product not found in target store' };
    }

    // 2. Brand translation
    let brandOptionId = null;
    if (brandLabel) {
      try {
        const option = await targetService.ensureAttributeOptionExists('brand', brandLabel);
        brandOptionId = option?.value || null;
      } catch (error) {
        logger.warn('Brand translation failed, skipping brand update', { storeName, sku, error: error.message });
        warnings.push({ field: 'brand', message: `Brand translation failed: ${error.message}` });
      }
    }

    // 3. Category mapping
    const sourceCategoryNames = (categories || []).map(c => c.name);
    const categoryIds = [];
    try {
      const targetNames = this.categoryMappingService.getTargetMagentoCategories(sourceCategoryNames);
      for (const name of targetNames) {
        try {
          const catId = await targetService.getCategoryIdByName(name);
          if (catId) {
            categoryIds.push(catId);
          } else {
            warnings.push({ field: 'categories', message: `Category not found on target: ${name}` });
          }
        } catch (error) {
          warnings.push({ field: 'categories', message: `Category lookup failed: ${name}` });
        }
      }
    } catch (error) {
      logger.warn('Category mapping failed, skipping categories', { storeName, sku, error: error.message });
      warnings.push({ field: 'categories', message: `Category mapping failed: ${error.message}` });
    }

    // 4. PUT global fields via /rest/all/
    const globalCustomAttributes = [];
    if (brandOptionId) {
      globalCustomAttributes.push({ attribute_code: 'brand', value: brandOptionId });
    }

    const globalPayload = {
      product: {
        sku,
        custom_attributes: globalCustomAttributes,
        extension_attributes: {
          category_links: categoryIds.map(catId => ({ category_id: catId, position: 0 }))
        }
      }
    };

    await targetService.client.put(
      `/rest/all/V1/products/${encodeURIComponent(sku)}`,
      globalPayload
    );

    // 5. Image replace
    try {
      const mediaEntries = existingProduct.media_gallery_entries || [];
      await targetService.deleteAllProductMedia(sku, mediaEntries);

      for (const entry of (sourceProduct.media_gallery_entries || [])) {
        try {
          const { buffer, contentType } = await this.sourceService.downloadImage(entry.file);
          const base64 = buffer.toString('base64');
          await targetService.uploadProductImage(sku, base64, {
            label: entry.label || '',
            position: entry.position || 1,
            types: entry.types || [],
            contentType: contentType || 'image/jpeg',
            fileName: entry.file?.split('/').pop() || `${sku}-image.jpg`
          });
        } catch (imgError) {
          logger.warn('Failed to upload source image, skipping', { sku, file: entry.file, error: imgError.message });
          warnings.push({ field: 'images', message: `Image upload failed: ${imgError.message}` });
        }
      }
    } catch (error) {
      logger.warn('Image replace failed', { storeName, sku, error: error.message });
      warnings.push({ field: 'images', message: `Image replace failed: ${error.message}` });
    }

    // ── Step B: Store-view-scoped fields (per store view) ────────────────

    const storeWebsiteMapping = await targetService.getStoreWebsiteMapping();
    const storeCodes = Object.keys(storeWebsiteMapping);

    const description = this.extractCustomAttribute(sourceProduct, 'description');
    const metaTitle = this.extractCustomAttribute(sourceProduct, 'meta_title');
    const metaKeyword = this.extractCustomAttribute(sourceProduct, 'meta_keyword');
    const metaDescription = this.extractCustomAttribute(sourceProduct, 'meta_description');

    const scopedCustomAttributes = [];
    if (description !== null) scopedCustomAttributes.push({ attribute_code: 'description', value: description });
    if (metaTitle !== null) scopedCustomAttributes.push({ attribute_code: 'meta_title', value: metaTitle });
    if (metaKeyword !== null) scopedCustomAttributes.push({ attribute_code: 'meta_keyword', value: metaKeyword });
    if (metaDescription !== null) scopedCustomAttributes.push({ attribute_code: 'meta_description', value: metaDescription });

    const scopedProductData = {
      sku,
      name: sourceProduct.name,
      custom_attributes: scopedCustomAttributes
    };

    for (const storeCode of storeCodes) {
      const scopedService = targetService.createScopedInstance(storeCode);
      try {
        await scopedService.updateProduct(sku, scopedProductData);
        logger.debug('Store-view fields updated', { storeName, storeCode, sku });
      } catch (error) {
        logger.warn('Failed to update store-view fields', { storeName, storeCode, sku, error: error.message });
        warnings.push({ field: 'store-view', message: `Store view ${storeCode} update failed: ${error.message}` });
      }
    }

    logger.info('Magento store update complete', { storeName, sku, warnings: warnings.length });
    return { success: true, warnings };
  }
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx jest tests/services/sync/product-update.service.test.js 2>&1 | tail -15
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/sync/product-update.service.js tests/services/sync/product-update.service.test.js
git commit -m "feat: add updateMagentoStore to ProductUpdateService"
```

---

### Task 7: ProductUpdateService — Shopify update flow

**Files:**
- Modify: `src/services/sync/product-update.service.js`
- Modify: `tests/services/sync/product-update.service.test.js`

- [ ] **Step 1: Write the failing tests for `updateShopifyStore`**

Add to the test file inside the main `describe` block:

```js
  // ── updateShopifyStore ────────────────────────────────────────────────────

  describe('updateShopifyStore', () => {
    const ShopifyTargetService = require('../../../src/services/shopify/shopify-target.service');

    const sourceProduct = {
      sku: 'PARENT-001',
      name: 'My Product',
      media_gallery_entries: [{ file: '/a/img.jpg', label: 'Front' }],
      custom_attributes: [
        { attribute_code: 'description', value: '<p>desc</p>' },
        { attribute_code: 'meta_title', value: 'MT' },
        { attribute_code: 'meta_keyword', value: 'kw1, kw2' },
        { attribute_code: 'meta_description', value: 'MD' }
      ]
    };

    const extractedData = {
      sourceProduct,
      productType: 'configurable',
      brandLabel: 'BrandCo',
      categories: [{ id: '5', name: 'Vapes' }],
      firstChildSku: 'CHILD-001'
    };

    let mockShopify;

    beforeEach(() => {
      mockShopify = {
        getVariantsBySkus: jest.fn().mockResolvedValue([
          { sku: 'CHILD-001', product: { id: 'gid://shopify/Product/123' } }
        ]),
        updateProductFields: jest.fn().mockResolvedValue({}),
        deleteAllProductMedia: jest.fn().mockResolvedValue(undefined),
        createProductMedia: jest.fn().mockResolvedValue([]),
        query: jest.fn().mockResolvedValue({
          data: {
            product: {
              media: {
                edges: [{ node: { id: 'gid://shopify/MediaImage/1' } }]
              }
            }
          }
        })
      };
      ShopifyTargetService.mockImplementation(() => mockShopify);

      service.categoryMappingService.getShopifyProductType = jest.fn().mockReturnValue('Accessories');
    });

    it('returns success: false when product not found', async () => {
      mockShopify.getVariantsBySkus.mockResolvedValue([]);
      const result = await service.updateShopifyStore('myshopify', extractedData);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it('looks up by firstChildSku for configurable products', async () => {
      await service.updateShopifyStore('myshopify', extractedData);
      expect(mockShopify.getVariantsBySkus).toHaveBeenCalledWith(['CHILD-001']);
    });

    it('looks up by sku directly for standalone simple products', async () => {
      mockShopify.getVariantsBySkus.mockResolvedValue([
        { sku: 'PARENT-001', product: { id: 'gid://shopify/Product/456' } }
      ]);

      const standaloneData = { ...extractedData, productType: 'standalone-simple' };
      await service.updateShopifyStore('myshopify', standaloneData);

      expect(mockShopify.getVariantsBySkus).toHaveBeenCalledWith(['PARENT-001']);
    });

    it('calls updateProductFields with mapped fields', async () => {
      await service.updateShopifyStore('myshopify', extractedData);

      expect(mockShopify.updateProductFields).toHaveBeenCalledWith(
        'gid://shopify/Product/123',
        expect.objectContaining({
          title: 'My Product',
          vendor: 'BrandCo',
          descriptionHtml: '<p>desc</p>',
          productType: 'Accessories',
          seoTitle: 'MT',
          seoDescription: 'MD',
          tags: ['kw1', 'kw2']
        })
      );
    });

    it('returns success: true even when image replace fails', async () => {
      mockShopify.deleteAllProductMedia.mockRejectedValue(new Error('cdn error'));

      const result = await service.updateShopifyStore('myshopify', extractedData);

      expect(result.success).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: 'images' })])
      );
    });

    it('returns success: true on happy path', async () => {
      const result = await service.updateShopifyStore('myshopify', extractedData);
      expect(result.success).toBe(true);
    });
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npx jest tests/services/sync/product-update.service.test.js --testNamePattern="updateShopifyStore" 2>&1 | tail -20
```

Expected: FAIL — `service.updateShopifyStore is not a function`

- [ ] **Step 3: Implement `updateShopifyStore`**

Add inside the class in `src/services/sync/product-update.service.js`:

```js
  /**
   * Update content fields for one Shopify store.
   * @param {string} storeName
   * @param {Object} extractedData - { sourceProduct, productType, brandLabel, categories, firstChildSku }
   * @returns {Object} { success, warnings, error? }
   */
  async updateShopifyStore(storeName, extractedData) {
    const { sourceProduct, productType, brandLabel, categories, firstChildSku } = extractedData;
    const sku = sourceProduct.sku;
    const storeConfig = this.shopifyStores[storeName];
    const warnings = [];

    const shopifyService = new ShopifyTargetService(
      storeConfig.url,
      storeConfig.token,
      { apiVersion: config.shopify.apiVersion }
    );

    // 1. Existence check
    const lookupSku = productType === 'configurable' ? firstChildSku : sku;
    const variants = await shopifyService.getVariantsBySkus([lookupSku]);
    if (!variants || variants.length === 0) {
      return { success: false, error: 'Product not found in target store' };
    }
    const productId = variants[0].product.id;

    // 2. Category mapping
    const sourceCategoryNames = (categories || []).map(c => c.name);
    const shopifyProductType = this.categoryMappingService.getShopifyProductType(sourceCategoryNames, storeName) || '';

    // 3. Update product fields
    const description = this.extractCustomAttribute(sourceProduct, 'description');
    const metaTitle = this.extractCustomAttribute(sourceProduct, 'meta_title');
    const metaDescription = this.extractCustomAttribute(sourceProduct, 'meta_description');
    const metaKeyword = this.extractCustomAttribute(sourceProduct, 'meta_keyword');
    const tags = this.parseMetaKeywordsToTags(metaKeyword);

    await shopifyService.updateProductFields(productId, {
      title: sourceProduct.name,
      vendor: brandLabel,
      descriptionHtml: description || '',
      productType: shopifyProductType,
      seoTitle: metaTitle,
      seoDescription: metaDescription,
      tags
    });

    // 4. Image replace (best-effort — failure recorded as warning)
    try {
      // Query media IDs for deletion
      const imageUrls = this.buildSourceImageUrls(sourceProduct.media_gallery_entries || []);

      // Get current media IDs from the product
      const mediaIds = await this._getShopifyProductMediaIds(shopifyService, productId);
      await shopifyService.deleteAllProductMedia(productId, mediaIds);

      if (imageUrls.length > 0) {
        await shopifyService.createProductMedia(productId, imageUrls);
      }
    } catch (error) {
      logger.warn('Image replace failed for Shopify store', { storeName, sku, error: error.message });
      warnings.push({ field: 'images', message: `Image replace failed: ${error.message}` });
    }

    logger.info('Shopify store update complete', { storeName, sku });
    return { success: true, warnings };
  }

  /**
   * Query all media IDs for a Shopify product.
   * @private
   */
  async _getShopifyProductMediaIds(shopifyService, productId) {
    const query = `
      query getProductMedia($id: ID!) {
        product(id: $id) {
          media(first: 100) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `;
    try {
      const result = await shopifyService.query(query, { id: productId });
      return (result.data.product?.media?.edges || []).map(e => e.node.id);
    } catch (error) {
      logger.warn('Failed to fetch product media IDs', { productId, error: error.message });
      return [];
    }
  }
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npx jest tests/services/sync/product-update.service.test.js 2>&1 | tail -15
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/sync/product-update.service.js tests/services/sync/product-update.service.test.js
git commit -m "feat: add updateShopifyStore to ProductUpdateService"
```

---

### Task 8: ProductUpdateService — main `updateProductFields` orchestrator

**Files:**
- Modify: `src/services/sync/product-update.service.js`
- Modify: `tests/services/sync/product-update.service.test.js`

- [ ] **Step 1: Write the failing tests for `updateProductFields`**

Add to the test file inside the main `describe` block:

```js
  // ── updateProductFields (main entry point) ────────────────────────────────

  describe('updateProductFields', () => {
    const sourceProduct = {
      sku: 'PARENT-001',
      name: 'My Product',
      type_id: 'configurable',
      visibility: 4,
      price: 99,
      media_gallery_entries: [],
      custom_attributes: [
        { attribute_code: 'description', value: '<p>desc</p>' },
        { attribute_code: 'brand', value: '42' },
        { attribute_code: 'meta_title', value: 'MT' },
        { attribute_code: 'meta_keyword', value: 'kw1' },
        { attribute_code: 'meta_description', value: 'MD' }
      ],
      extension_attributes: {
        category_links: [{ category_id: '5' }],
        configurable_product_link_data: [
          JSON.stringify({ simple_product_sku: 'CHILD-001', simple_product_id: 1 })
        ]
      }
    };

    beforeEach(() => {
      service.sourceService.getProductBySku = jest.fn().mockResolvedValue(sourceProduct);
      service.attributeService.translateBrandAttribute = jest.fn().mockResolvedValue('BrandCo');
      service.attributeService.translateCategories = jest.fn().mockResolvedValue({ '5': 'Vapes' });
      service.googleChatService.notifyProductUpdateStart = jest.fn().mockResolvedValue(undefined);
      service.googleChatService.notifyProductUpdateEnd = jest.fn().mockResolvedValue(undefined);
      service.updateMagentoStore = jest.fn().mockResolvedValue({ success: true, warnings: [] });
      service.updateShopifyStore = jest.fn().mockResolvedValue({ success: true, warnings: [] });
    });

    it('throws immediately when source product not found', async () => {
      service.sourceService.getProductBySku.mockResolvedValue(null);
      await expect(service.updateProductFields('MISSING-SKU')).rejects.toThrow();
      expect(service.googleChatService.notifyProductUpdateStart).not.toHaveBeenCalled();
    });

    it('sends start notification after extraction', async () => {
      await service.updateProductFields('PARENT-001', {
        targetMagentoStores: ['ejuices'],
        targetShopifyStores: []
      });
      expect(service.googleChatService.notifyProductUpdateStart).toHaveBeenCalledWith(
        'PARENT-001',
        expect.any(Array)
      );
    });

    it('calls updateMagentoStore for each resolved Magento store', async () => {
      await service.updateProductFields('PARENT-001', {
        targetMagentoStores: ['ejuices'],
        includeShopify: false
      });
      expect(service.updateMagentoStore).toHaveBeenCalledWith('ejuices', expect.any(Object));
    });

    it('calls updateShopifyStore for each resolved Shopify store', async () => {
      await service.updateProductFields('PARENT-001', {
        targetShopifyStores: ['myshopify'],
        includeMagento: false
      });
      expect(service.updateShopifyStore).toHaveBeenCalledWith('myshopify', expect.any(Object));
    });

    it('sends end notification on success', async () => {
      await service.updateProductFields('PARENT-001', { targetMagentoStores: ['ejuices'], includeShopify: false });
      expect(service.googleChatService.notifyProductUpdateEnd).toHaveBeenCalledWith(
        expect.objectContaining({ sku: 'PARENT-001', success: true })
      );
    });

    it('sends end notification even when a store update fails', async () => {
      service.updateMagentoStore.mockResolvedValue({ success: false, error: 'not found' });
      await service.updateProductFields('PARENT-001', { targetMagentoStores: ['ejuices'], includeShopify: false });
      expect(service.googleChatService.notifyProductUpdateEnd).toHaveBeenCalled();
    });

    it('returns result.success false when any store fails', async () => {
      service.updateMagentoStore.mockResolvedValue({ success: false, error: 'not found' });
      const result = await service.updateProductFields('PARENT-001', {
        targetMagentoStores: ['ejuices'], includeShopify: false
      });
      expect(result.success).toBe(false);
    });

    it('skips Magento when includeMagento is false', async () => {
      await service.updateProductFields('PARENT-001', { includeMagento: false, includeShopify: false });
      expect(service.updateMagentoStore).not.toHaveBeenCalled();
    });

    it('skips Shopify when includeShopify is false', async () => {
      await service.updateProductFields('PARENT-001', { includeMagento: false, includeShopify: false });
      expect(service.updateShopifyStore).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npx jest tests/services/sync/product-update.service.test.js --testNamePattern="updateProductFields \(main" 2>&1 | tail -20
```

Expected: FAIL — `service.updateProductFields is not a function`

- [ ] **Step 3: Implement `updateProductFields` in ProductUpdateService**

Add inside the class in `src/services/sync/product-update.service.js`:

```js
  /**
   * Main entry point: update content fields for one SKU across all target stores.
   * @param {string} sku - Source product SKU
   * @param {Object} options
   */
  async updateProductFields(sku, options = {}) {
    const startTime = Date.now();

    const targetMagentoStores = this.resolveMagentoTargetStores(options.targetMagentoStores);
    const targetShopifyStores = this.resolveShopifyTargetStores(options.targetShopifyStores);
    const allTargetStores = [
      ...targetMagentoStores,
      ...targetShopifyStores.map(s => `shopify:${s}`)
    ];

    const result = {
      success: true,
      sku,
      results: { magento: {}, shopify: {} },
      errors: [],
      warnings: []
    };

    // Extraction — throws if product not found (no notifications sent)
    const sourceProduct = await this.sourceService.getProductBySku(sku);
    if (!sourceProduct) {
      throw new Error(`Product not found in source: ${sku}`);
    }

    const productType = this.classifyProductType(sourceProduct);

    const brandLabel = await this.attributeService.translateBrandAttribute(sourceProduct);

    const categoryIds = (sourceProduct.extension_attributes?.category_links || []).map(l => l.category_id);
    const categoryTranslations = await this.attributeService.translateCategories(categoryIds);
    const categories = Object.entries(categoryTranslations).map(([id, name]) => ({ id, name }));

    // For configurable products, get first child SKU for Shopify lookup
    let firstChildSku = null;
    if (productType === 'configurable') {
      const childLinks = this.extractChildLinks(sourceProduct);
      if (childLinks.length === 0) {
        throw new ExtractionError(`Configurable product has no child links; cannot locate product in Shopify. SKU: ${sku}`);
      }
      firstChildSku = childLinks[0].sku || null;
    }

    const extractedData = {
      sourceProduct,
      productType,
      brandLabel,
      categories,
      firstChildSku
    };

    logger.info('Extraction complete, starting store updates', { sku, productType, brandLabel });

    // Start notification (after successful extraction)
    await this.googleChatService.notifyProductUpdateStart(sku, allTargetStores);

    let extractionSucceeded = true;

    try {
      // Magento updates
      const includeMagento = options.includeMagento !== false;
      if (includeMagento) {
        for (const storeName of targetMagentoStores) {
          try {
            const storeResult = await this.updateMagentoStore(storeName, extractedData);
            result.results.magento[storeName] = storeResult;
            if (!storeResult.success) result.success = false;
            if (storeResult.warnings?.length) result.warnings.push(...storeResult.warnings.map(w => ({ store: storeName, ...w })));
          } catch (error) {
            result.results.magento[storeName] = { success: false, error: error.message };
            result.errors.push({ store: storeName, message: error.message });
            result.success = false;
            logger.error('Uncaught error updating Magento store', { storeName, sku, error: error.message });
            if (!config.errorHandling.continueOnError) break;
          }
        }
      }

      // Shopify updates
      const includeShopify = options.includeShopify !== false;
      if (includeShopify) {
        for (const storeName of targetShopifyStores) {
          try {
            const storeResult = await this.updateShopifyStore(storeName, extractedData);
            result.results.shopify[storeName] = storeResult;
            if (!storeResult.success) result.success = false;
            if (storeResult.warnings?.length) result.warnings.push(...storeResult.warnings.map(w => ({ store: storeName, ...w })));
          } catch (error) {
            result.results.shopify[storeName] = { success: false, error: error.message };
            result.errors.push({ store: storeName, message: error.message });
            result.success = false;
            logger.error('Uncaught error updating Shopify store', { storeName, sku, error: error.message });
            if (!config.errorHandling.continueOnError) break;
          }
        }
      }

      if (result.errors.length > 0) result.success = false;

      const duration = Date.now() - startTime;
      await this.googleChatService.notifyProductUpdateEnd({
        sku, success: result.success, errors: result.errors, targetStores: allTargetStores, duration
      });

      return result;
    } catch (error) {
      result.success = false;
      result.errors.push({ phase: 'update', message: error.message });

      const duration = Date.now() - startTime;

      if (extractionSucceeded) {
        await this.googleChatService.notifyProductUpdateEnd({
          sku, success: false, errors: result.errors, targetStores: allTargetStores, duration
        });
      }

      return result;
    }
  }
```

- [ ] **Step 4: Run all ProductUpdateService tests**

```bash
npx jest tests/services/sync/product-update.service.test.js 2>&1 | tail -15
```

Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/sync/product-update.service.js tests/services/sync/product-update.service.test.js
git commit -m "feat: add updateProductFields orchestrator to ProductUpdateService"
```

---

## Chunk 4: Route, controller, and wiring

### Task 9: Add route and controller handler

**Files:**
- Modify: `src/controllers/sync.controller.js`
- Modify: `src/routes/v1/sync.routes.js`

- [ ] **Step 1: Add `updateProductFields` to sync controller**

In `src/controllers/sync.controller.js`, add after the existing requires at top:

```js
const ProductUpdateService = require('../services/sync/product-update.service');
```

Add after the existing `priceSyncService` initialization:

```js
const productUpdateService = new ProductUpdateService();
```

Add after the `syncPrices` function:

```js
const updateProductFields = async (req, res, next) => {
  try {
    const { sku, options = {} } = req.body;

    if (!sku) {
      throw new ValidationError('SKU is required', [{ field: 'sku', message: 'SKU cannot be empty' }]);
    }

    logger.info('Product fields update request received', { sku, options });

    const result = await productUpdateService.updateProductFields(sku, options);

    const statusCode = result.success ? 200 : 207;

    res.status(statusCode).json(result);
  } catch (error) {
    next(error);
  }
};
```

Update the exports at the bottom of the file:

```js
module.exports = {
  syncPrices,
  updateProductFields
};
```

- [ ] **Step 2: Add route to sync.routes.js**

In `src/routes/v1/sync.routes.js`, replace the existing `syncPrices` import line:

```js
// Replace this existing line:
// const { syncPrices } = require('../../controllers/sync.controller');
// With:
const { syncPrices, updateProductFields } = require('../../controllers/sync.controller');
```

Add after the existing `/prices` route:

```js
router.post(
  '/product-fields',
  [
    body('sku').notEmpty().withMessage('SKU is required').trim(),
    body('options').optional().isObject().withMessage('Options must be an object'),
    body('options.targetMagentoStores')
      .optional()
      .isArray()
      .withMessage('targetMagentoStores must be an array'),
    body('options.targetMagentoStores.*')
      .optional()
      .isString()
      .notEmpty()
      .withMessage('Each Magento target store must be a non-empty string'),
    body('options.targetShopifyStores')
      .optional()
      .isArray()
      .withMessage('targetShopifyStores must be an array'),
    body('options.targetShopifyStores.*')
      .optional()
      .isString()
      .notEmpty()
      .withMessage('Each Shopify target store must be a non-empty string'),
    body('options.includeMagento')
      .optional()
      .isBoolean()
      .withMessage('includeMagento must be a boolean'),
    body('options.includeShopify')
      .optional()
      .isBoolean()
      .withMessage('includeShopify must be a boolean'),
    validateRequest
  ],
  asyncHandler(updateProductFields)
);
```

- [ ] **Step 3: Run all tests to confirm nothing broke**

```bash
npx jest 2>&1 | tail -20
```

Expected: all tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/controllers/sync.controller.js src/routes/v1/sync.routes.js
git commit -m "feat: wire POST /sync/product-fields route and controller"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
npx jest --verbose 2>&1 | tail -40
```

Expected: all tests PASS with no failures

- [ ] **Step 2: Start the server and verify the route is registered**

```bash
node -e "
const app = require('./src/app');
const routes = [];
app._router.stack.forEach(r => {
  if (r.handle && r.handle.stack) {
    r.handle.stack.forEach(s => {
      if (s.route) routes.push(s.route.path);
    });
  }
});
console.log(routes);
" 2>&1 | grep -E "product-fields|prices"
```

Expected output includes `/product-fields` and `/prices`

- [ ] **Step 3: Commit final state**

```bash
git add -A
git status
# Confirm no unintended files
git commit -m "feat: add product fields update endpoint (POST /api/v1/sync/product-fields)"
```
