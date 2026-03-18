# Special Price Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync Magento `special_price` to Shopify (`price`/`compareAtPrice`) and Magento target stores during price sync, and clear stale sale prices when none exists in source.

**Architecture:** Three focused changes — (1) extract `special_price` from source Magento response, (2) write it to Magento target alongside regular price, (3) use it to drive Shopify `price`/`compareAtPrice` instead of the old detect-and-preserve logic. Tier-priced Shopify stores are unchanged.

**Tech Stack:** Node.js, Jest, Magento 2 REST API, Shopify GraphQL Admin API

---

## Chunk 1: Extraction and Magento target

### Task 1: `extractSpecialPrice` helper and `extractPrices` update

**Spec ref:** Sections 1 and data model

**Files:**
- Create: `tests/services/sync/price-sync.service.test.js`
- Modify: `src/services/sync/price-sync.service.js`

---

- [ ] **Step 1.1: Create the test file with extractSpecialPrice tests**

Note: `tests/services/sync/` and `tests/services/magento/` directories do not exist yet. Run this before creating any test files:

```bash
mkdir -p tests/services/sync tests/services/magento tests/services/shopify
```

Create `tests/services/sync/price-sync.service.test.js`:

```js
'use strict';

jest.mock('../../../src/services/magento/source.service');
jest.mock('../../../src/services/magento/target.service');
jest.mock('../../../src/services/shopify/shopify-target.service');
jest.mock('../../../src/services/notification/google-chat.service');
jest.mock('../../../src/config', () => ({
  source: { baseUrl: 'http://source.test', token: 'tok' },
  api: {},
  shopify: { stores: {}, apiVersion: '2024-01' },
  priceSync: { storeGroupMapping: {} },
  magentoStores: {},
  errorHandling: { continueOnError: true }
}));

const PriceSyncService = require('../../../src/services/sync/price-sync.service');

describe('PriceSyncService', () => {
  let service;

  beforeEach(() => {
    service = new PriceSyncService();
  });

  describe('extractSpecialPrice', () => {
    it('returns null when product has no custom_attributes', () => {
      expect(service.extractSpecialPrice({})).toBeNull();
    });

    it('returns null when special_price attribute is absent', () => {
      const product = { custom_attributes: [{ attribute_code: 'color', value: 'red' }] };
      expect(service.extractSpecialPrice(product)).toBeNull();
    });

    it('returns null when special_price value is empty string', () => {
      const product = { custom_attributes: [{ attribute_code: 'special_price', value: '' }] };
      expect(service.extractSpecialPrice(product)).toBeNull();
    });

    it('returns null when special_price value is null', () => {
      const product = { custom_attributes: [{ attribute_code: 'special_price', value: null }] };
      expect(service.extractSpecialPrice(product)).toBeNull();
    });

    it('returns null when special_price is 0', () => {
      const product = { custom_attributes: [{ attribute_code: 'special_price', value: '0' }] };
      expect(service.extractSpecialPrice(product)).toBeNull();
    });

    it('returns null when special_price is not parseable as a number', () => {
      const product = { custom_attributes: [{ attribute_code: 'special_price', value: 'abc' }] };
      expect(service.extractSpecialPrice(product)).toBeNull();
    });

    it('returns float when special_price is a valid positive number string', () => {
      const product = { custom_attributes: [{ attribute_code: 'special_price', value: '79.99' }] };
      expect(service.extractSpecialPrice(product)).toBe(79.99);
    });

    it('returns float when special_price is an integer string', () => {
      const product = { custom_attributes: [{ attribute_code: 'special_price', value: '50' }] };
      expect(service.extractSpecialPrice(product)).toBe(50);
    });
  });
});
```

- [ ] **Step 1.2: Run the tests to confirm they fail**

```bash
npx jest tests/services/sync/price-sync.service.test.js --no-coverage
```

Expected: FAIL (example output: `TypeError: service.extractSpecialPrice is not a function`)

- [ ] **Step 1.3: Add `extractSpecialPrice` to `price-sync.service.js`**

Add this method to the `PriceSyncService` class (after `getTierPrice`, around line 371):

```js
/**
 * Extract special_price from Magento custom_attributes array.
 * Returns a positive float, or null if absent/invalid/zero.
 * @param {Object} product - Magento product object
 * @returns {number|null}
 */
extractSpecialPrice(product) {
  const attr = (product.custom_attributes || [])
    .find(a => a.attribute_code === 'special_price');
  if (!attr?.value) return null;
  const v = parseFloat(attr.value);
  return (isNaN(v) || v <= 0) ? null : v;
}
```

- [ ] **Step 1.4: Run the tests to confirm they pass**

```bash
npx jest tests/services/sync/price-sync.service.test.js --no-coverage
```

Expected: PASS (all 8 extractSpecialPrice tests)

- [ ] **Step 1.5: Add extractPrices tests to the test file**

Append inside `describe('PriceSyncService', ...)` in the test file:

```js
describe('extractPrices', () => {
  // PriceSyncService stores the source service instance as `service.sourceService`.
  // We set mocks directly on that instance rather than the class prototype.

  const mockParentBase = {
    price: 100,
    type_id: 'configurable',
    extension_attributes: {
      configurable_product_link_data: [
        JSON.stringify({ simple_product_sku: 'CHILD-001', simple_product_id: 1 })
      ]
    }
  };

  it('includes specialPrice on each child from custom_attributes', async () => {
    const mockParent = { sku: 'PARENT-001', ...mockParentBase };
    const mockChild = {
      sku: 'CHILD-001',
      price: 99.99,
      tier_prices: [],
      custom_attributes: [{ attribute_code: 'special_price', value: '79.99' }]
    };

    service.sourceService.getProductBySku = jest.fn()
      .mockResolvedValueOnce(mockParent)
      .mockResolvedValueOnce(mockChild);

    const result = await service.extractPrices('PARENT-001');

    expect(result.children).toHaveLength(1);
    expect(result.children[0].specialPrice).toBe(79.99);
  });

  it('sets specialPrice to null when child has no special_price', async () => {
    const mockParent = {
      sku: 'PARENT-002',
      ...mockParentBase,
      extension_attributes: {
        configurable_product_link_data: [
          JSON.stringify({ simple_product_sku: 'CHILD-002', simple_product_id: 2 })
        ]
      }
    };
    const mockChild = {
      sku: 'CHILD-002',
      price: 99.99,
      tier_prices: [],
      custom_attributes: []
    };

    service.sourceService.getProductBySku = jest.fn()
      .mockResolvedValueOnce(mockParent)
      .mockResolvedValueOnce(mockChild);

    const result = await service.extractPrices('PARENT-002');

    expect(result.children[0].specialPrice).toBeNull();
  });

  it('preserves tierPrices from child', async () => {
    const mockParent = { sku: 'PARENT-003', ...mockParentBase };
    const mockChild = {
      sku: 'CHILD-001',
      price: 99.99,
      tier_prices: [{ customer_group_id: 2, qty: 1, value: 85.00 }],
      custom_attributes: []
    };

    service.sourceService.getProductBySku = jest.fn()
      .mockResolvedValueOnce(mockParent)
      .mockResolvedValueOnce(mockChild);

    const result = await service.extractPrices('PARENT-003');

    expect(result.children[0].tierPrices).toEqual([{ customer_group_id: 2, qty: 1, value: 85.00 }]);
  });
});
```

- [ ] **Step 1.6: Run to confirm new tests fail**

```bash
npx jest tests/services/sync/price-sync.service.test.js --no-coverage -t "extractPrices"
```

Expected: FAIL (example output: `Expected: 79.99 / Received: undefined`)

- [ ] **Step 1.7: Update `extractPrices` in `price-sync.service.js` to include `specialPrice`**

Find the block inside the `for (const childSku of childSkus)` loop where the child is pushed (around line 176):

```js
// BEFORE:
priceData.children.push({
  sku: child.sku,
  price: child.price,
  tierPrices: child.tier_prices || []
});

// AFTER:
priceData.children.push({
  sku: child.sku,
  price: child.price,
  specialPrice: this.extractSpecialPrice(child),
  tierPrices: child.tier_prices || []
});
```

- [ ] **Step 1.8: Run all price-sync tests to confirm they pass**

```bash
npx jest tests/services/sync/price-sync.service.test.js --no-coverage
```

Expected: PASS (all tests)

- [ ] **Step 1.9: Commit**

```bash
git add src/services/sync/price-sync.service.js tests/services/sync/price-sync.service.test.js
git commit -m "feat: extract special_price from source Magento in price sync"
```

---

### Task 2: Magento target `updateProductPrice` + `updateMagentoPricesForInstance`

**Spec ref:** Sections 2 and 3

**Files:**
- Create: `tests/services/magento/target.service.test.js`
- Modify: `src/services/magento/target.service.js`
- Modify: `src/services/sync/price-sync.service.js`
- Modify: `tests/services/sync/price-sync.service.test.js`

---

- [ ] **Step 2.1: Write failing tests for `updateProductPrice` with specialPrice**

Create `tests/services/magento/target.service.test.js`:

```js
'use strict';

jest.mock('../../../src/config', () => ({
  magentoStores: {},
  api: {}
}));

const TargetService = require('../../../src/services/magento/target.service');

describe('TargetService', () => {
  let service;
  let putSpy;

  beforeEach(() => {
    service = new TargetService('http://target.test', 'tok', {});
    putSpy = jest.spyOn(service, 'put').mockResolvedValue({ sku: 'TEST-SKU' });
  });

  describe('updateProductPrice', () => {
    it('sends price in payload when specialPrice is omitted', async () => {
      await service.updateProductPrice('TEST-SKU', 99.99);

      expect(putSpy).toHaveBeenCalledWith(
        '/rest/V1/products/TEST-SKU',
        { product: { sku: 'TEST-SKU', price: 99.99 } }
      );
      // No custom_attributes key when specialPrice not provided
      const payload = putSpy.mock.calls[0][1];
      expect(payload.product.custom_attributes).toBeUndefined();
    });

    it('includes special_price in custom_attributes when specialPrice is provided', async () => {
      await service.updateProductPrice('TEST-SKU', 99.99, 79.99);

      const payload = putSpy.mock.calls[0][1];
      expect(payload.product.custom_attributes).toEqual([
        { attribute_code: 'special_price', value: 79.99 }
      ]);
    });

    it('sends null special_price to clear it when specialPrice is null', async () => {
      await service.updateProductPrice('TEST-SKU', 99.99, null);

      const payload = putSpy.mock.calls[0][1];
      expect(payload.product.custom_attributes).toEqual([
        { attribute_code: 'special_price', value: null }
      ]);
    });

    it('URL-encodes SKUs with special characters', async () => {
      await service.updateProductPrice('TEST/SKU-001', 10);

      expect(putSpy.mock.calls[0][0]).toBe('/rest/V1/products/TEST%2FSKU-001');
    });
  });
});
```

- [ ] **Step 2.2: Run to confirm tests fail**

```bash
npx jest tests/services/magento/target.service.test.js --no-coverage
```

Expected: FAIL (example output: `Expected: [{attribute_code: "special_price", ...}] / Received: undefined`)

- [ ] **Step 2.3: Update `updateProductPrice` in `target.service.js`**

Find `updateProductPrice` (around line 70) and replace:

```js
// BEFORE:
async updateProductPrice(sku, price) {
  logger.info('Updating product price in target', { sku, price });
  const payload = {
    product: {
      sku,
      price
    }
  };
  return await this.put(`/rest/V1/products/${encodeURIComponent(sku)}`, payload);
}

// AFTER:
async updateProductPrice(sku, price, specialPrice = undefined) {
  logger.info('Updating product price in target', { sku, price, specialPrice });
  const product = { sku, price };
  if (specialPrice !== undefined) {
    product.custom_attributes = [
      { attribute_code: 'special_price', value: specialPrice }
    ];
  }
  return await this.put(`/rest/V1/products/${encodeURIComponent(sku)}`, { product });
}
```

- [ ] **Step 2.4: Run target.service tests to confirm they pass**

```bash
npx jest tests/services/magento/target.service.test.js --no-coverage
```

Expected: PASS

- [ ] **Step 2.5: Add `updateMagentoPricesForInstance` tests to price-sync test file**

Append inside `describe('PriceSyncService', ...)` in `tests/services/sync/price-sync.service.test.js`:

```js
describe('updateMagentoPricesForInstance', () => {
  // updateMagentoPricesForInstance receives a scoped TargetService instance directly.
  // We pass a plain mock object — no need to involve the TargetService class mock.
  let mockScopedService;

  beforeEach(() => {
    mockScopedService = {
      updateProductPrice: jest.fn().mockResolvedValue({})
    };
  });

  it('passes specialPrice to updateProductPrice', async () => {
    const priceData = {
      children: [{ sku: 'CHILD-001', price: 99.99, specialPrice: 79.99, tierPrices: [] }]
    };

    await service.updateMagentoPricesForInstance(priceData, mockScopedService, null, 'store1', 'default');

    expect(mockScopedService.updateProductPrice).toHaveBeenCalledWith('CHILD-001', 99.99, 79.99);
  });

  it('passes null specialPrice to clear it on target', async () => {
    const priceData = {
      children: [{ sku: 'CHILD-001', price: 99.99, specialPrice: null, tierPrices: [] }]
    };

    await service.updateMagentoPricesForInstance(priceData, mockScopedService, null, 'store1', 'default');

    expect(mockScopedService.updateProductPrice).toHaveBeenCalledWith('CHILD-001', 99.99, null);
  });

  it('uses tier price for price but still passes specialPrice', async () => {
    const priceData = {
      children: [{
        sku: 'CHILD-001',
        price: 99.99,
        specialPrice: 60.00,
        tierPrices: [{ customer_group_id: 2, qty: 1, value: 85.00 }]
      }]
    };

    await service.updateMagentoPricesForInstance(priceData, mockScopedService, 2, 'store1', 'default');

    // price becomes tier price (85.00), but specialPrice still flows through
    expect(mockScopedService.updateProductPrice).toHaveBeenCalledWith('CHILD-001', 85.00, 60.00);
  });
});
```

- [ ] **Step 2.6: Run to confirm new tests fail**

```bash
npx jest tests/services/sync/price-sync.service.test.js --no-coverage -t "updateMagentoPricesForInstance"
```

Expected: FAIL (example output: `Expected: called with ("CHILD-001", 99.99, 79.99) / Received: called with ("CHILD-001", 99.99)`)

- [ ] **Step 2.7: Update `updateMagentoPricesForInstance` in `price-sync.service.js`**

Find the `await service.updateProductPrice(child.sku, price)` line (around line 323) and update:

```js
// BEFORE:
await service.updateProductPrice(child.sku, price);

// AFTER:
await service.updateProductPrice(child.sku, price, child.specialPrice);
```

- [ ] **Step 2.8: Run all price-sync and target-service tests**

```bash
npx jest tests/services/sync/price-sync.service.test.js tests/services/magento/target.service.test.js --no-coverage
```

Expected: PASS (all tests in both files)

- [ ] **Step 2.9: Commit**

```bash
git add src/services/magento/target.service.js src/services/sync/price-sync.service.js \
        tests/services/magento/target.service.test.js tests/services/sync/price-sync.service.test.js
git commit -m "feat: sync special_price to Magento target stores"
```

---

## Chunk 2: Shopify target

### Task 3: `updateVariantPrices` — support new special-price variant shape

**Spec ref:** Section 5

**Files:**
- Create: `tests/services/shopify/shopify-target.service.test.js`
- Modify: `src/services/shopify/shopify-target.service.js`

---

- [ ] **Step 3.1: Write failing tests for the updated `updateVariantPrices`**

Create `tests/services/shopify/shopify-target.service.test.js`:

```js
'use strict';

const ShopifyTargetService = require('../../../src/services/shopify/shopify-target.service');

describe('ShopifyTargetService', () => {
  let service;
  let querySpy;

  beforeEach(() => {
    service = new ShopifyTargetService('test.myshopify.com', 'tok', { apiVersion: '2024-01' });
    querySpy = jest.spyOn(service, 'query').mockResolvedValue({
      data: {
        productVariantsBulkUpdate: {
          productVariants: [{ id: 'gid://shopify/ProductVariant/1', price: '79.99', sku: 'SKU-1' }],
          userErrors: []
        }
      }
    });
  });

  describe('updateVariantPrices', () => {
    it('sets both price and compareAtPrice when compareAtPrice is a string value', async () => {
      const variantPrices = [
        { id: 'gid://shopify/ProductVariant/1', price: 79.99, compareAtPrice: 99.99 }
      ];

      await service.updateVariantPrices('gid://shopify/Product/1', variantPrices);

      const variables = querySpy.mock.calls[0][1];
      expect(variables.variants[0]).toEqual({
        id: 'gid://shopify/ProductVariant/1',
        price: '79.99',
        compareAtPrice: '99.99'
      });
    });

    it('sets price and clears compareAtPrice when compareAtPrice is null', async () => {
      const variantPrices = [
        { id: 'gid://shopify/ProductVariant/1', price: 99.99, compareAtPrice: null }
      ];

      await service.updateVariantPrices('gid://shopify/Product/1', variantPrices);

      const variables = querySpy.mock.calls[0][1];
      expect(variables.variants[0]).toEqual({
        id: 'gid://shopify/ProductVariant/1',
        price: '99.99',
        compareAtPrice: null
      });
    });

    it('sets only price when compareAtPrice is undefined (no compareAtPrice key)', async () => {
      const variantPrices = [
        { id: 'gid://shopify/ProductVariant/1', price: 99.99 }
      ];

      await service.updateVariantPrices('gid://shopify/Product/1', variantPrices);

      const variables = querySpy.mock.calls[0][1];
      expect(variables.variants[0]).toEqual({
        id: 'gid://shopify/ProductVariant/1',
        price: '99.99'
      });
      expect(variables.variants[0]).not.toHaveProperty('compareAtPrice');
    });

    it('sets only compareAtPrice when updateCompareAt is true (legacy tier shape)', async () => {
      const variantPrices = [
        { id: 'gid://shopify/ProductVariant/1', price: 85.00, updateCompareAt: true }
      ];

      await service.updateVariantPrices('gid://shopify/Product/1', variantPrices);

      const variables = querySpy.mock.calls[0][1];
      expect(variables.variants[0]).toEqual({
        id: 'gid://shopify/ProductVariant/1',
        compareAtPrice: '85'
      });
      expect(variables.variants[0]).not.toHaveProperty('price');
    });

    it('handles multiple variants with mixed shapes', async () => {
      const variantPrices = [
        { id: 'gid://shopify/ProductVariant/1', price: 79.99, compareAtPrice: 99.99 },
        { id: 'gid://shopify/ProductVariant/2', price: 89.99, compareAtPrice: null },
        { id: 'gid://shopify/ProductVariant/3', price: 55.00, updateCompareAt: true }
      ];

      querySpy.mockResolvedValue({
        data: {
          productVariantsBulkUpdate: {
            productVariants: [],
            userErrors: []
          }
        }
      });

      await service.updateVariantPrices('gid://shopify/Product/1', variantPrices);

      const variables = querySpy.mock.calls[0][1];
      expect(variables.variants[0]).toEqual({ id: 'gid://shopify/ProductVariant/1', price: '79.99', compareAtPrice: '99.99' });
      expect(variables.variants[1]).toEqual({ id: 'gid://shopify/ProductVariant/2', price: '89.99', compareAtPrice: null });
      expect(variables.variants[2]).toEqual({ id: 'gid://shopify/ProductVariant/3', compareAtPrice: '55' });
    });
  });
});
```

- [ ] **Step 3.2: Run to confirm tests fail**

```bash
npx jest tests/services/shopify/shopify-target.service.test.js --no-coverage
```

Expected: FAIL — current code uses `updateCompareAt` flag only, doesn't handle new `compareAtPrice` field

- [ ] **Step 3.3: Update `updateVariantPrices` in `shopify-target.service.js`**

Find the `const variants = variantPrices.map(...)` block (around line 674) and replace:

```js
// BEFORE:
const variants = variantPrices.map(v => ({
  id: v.id,
  ...(v.updateCompareAt
    ? { compareAtPrice: String(v.price) }
    : { price: String(v.price) })
}));

// AFTER:
const variants = variantPrices.map(v => {
  if (v.updateCompareAt) {
    // Legacy tier store shape: only update compareAtPrice
    return { id: v.id, compareAtPrice: String(v.price) };
  }
  const variant = { id: v.id, price: String(v.price) };
  if ('compareAtPrice' in v) {
    variant.compareAtPrice = v.compareAtPrice != null ? String(v.compareAtPrice) : null;
  }
  return variant;
});
```

- [ ] **Step 3.4: Run shopify-target tests to confirm they pass**

```bash
npx jest tests/services/shopify/shopify-target.service.test.js --no-coverage
```

Expected: PASS

- [ ] **Step 3.5: Commit**

```bash
git add src/services/shopify/shopify-target.service.js tests/services/shopify/shopify-target.service.test.js
git commit -m "feat: support special_price variant shape in Shopify updateVariantPrices"
```

---

### Task 4: `updateShopifyPricesForStore` — special_price-driven compareAtPrice logic

**Spec ref:** Section 4

**Files:**
- Modify: `src/services/sync/price-sync.service.js`
- Modify: `tests/services/sync/price-sync.service.test.js`

---

- [ ] **Step 4.1: Add failing tests for `updateShopifyPricesForStore`**

Append inside `describe('PriceSyncService', ...)` in `tests/services/sync/price-sync.service.test.js`:

```js
describe('updateShopifyPricesForStore (non-tier store)', () => {
  const ShopifyTargetService = require('../../../src/services/shopify/shopify-target.service');
  const config = require('../../../src/config');

  let mockShopifyService;

  beforeEach(() => {
    // Non-tier store: no groupId mapping
    config.priceSync.storeGroupMapping = {};

    mockShopifyService = {
      getVariantsBySkus: jest.fn(),
      updateVariantPrices: jest.fn().mockResolvedValue({ updatedCount: 1 })
    };

    jest.spyOn(ShopifyTargetService.prototype, 'getVariantsBySkus')
      .mockImplementation((...args) => mockShopifyService.getVariantsBySkus(...args));
    jest.spyOn(ShopifyTargetService.prototype, 'updateVariantPrices')
      .mockImplementation((...args) => mockShopifyService.updateVariantPrices(...args));
  });

  const storeConfig = { url: 'test.myshopify.com', token: 'tok' };
  const existingVariant = {
    id: 'gid://shopify/ProductVariant/1',
    sku: 'CHILD-001',
    price: '95.00',
    compareAtPrice: null,
    product: { id: 'gid://shopify/Product/1' }
  };

  it('sets price=specialPrice and compareAtPrice=regularPrice when child has specialPrice', async () => {
    mockShopifyService.getVariantsBySkus.mockResolvedValue([existingVariant]);

    const priceData = {
      parentSku: 'PARENT-001',
      children: [{ sku: 'CHILD-001', price: 99.99, specialPrice: 79.99 }]
    };

    await service.updateShopifyPricesForStore(priceData, 'teststore', storeConfig);

    const variantPrices = mockShopifyService.updateVariantPrices.mock.calls[0][1];
    expect(variantPrices[0].price).toBe(79.99);
    expect(variantPrices[0].compareAtPrice).toBe(99.99);
  });

  it('sets price=regularPrice and compareAtPrice=null when child has no specialPrice', async () => {
    mockShopifyService.getVariantsBySkus.mockResolvedValue([existingVariant]);

    const priceData = {
      parentSku: 'PARENT-001',
      children: [{ sku: 'CHILD-001', price: 99.99, specialPrice: null }]
    };

    await service.updateShopifyPricesForStore(priceData, 'teststore', storeConfig);

    const variantPrices = mockShopifyService.updateVariantPrices.mock.calls[0][1];
    expect(variantPrices[0].price).toBe(99.99);
    expect(variantPrices[0].compareAtPrice).toBeNull();
  });

  it('treats specialPrice >= regularPrice as no special price (logs warning)', async () => {
    mockShopifyService.getVariantsBySkus.mockResolvedValue([existingVariant]);

    const priceData = {
      parentSku: 'PARENT-001',
      children: [{ sku: 'CHILD-001', price: 79.99, specialPrice: 99.99 }]
    };

    await service.updateShopifyPricesForStore(priceData, 'teststore', storeConfig);

    const variantPrices = mockShopifyService.updateVariantPrices.mock.calls[0][1];
    // specialPrice >= price → treated as no special price
    expect(variantPrices[0].price).toBe(79.99);
    expect(variantPrices[0].compareAtPrice).toBeNull();
  });

  it('uses legacy updateCompareAt shape for tier-mapped stores and ignores specialPrice', async () => {
    // Set up a tier store mapping
    config.priceSync.storeGroupMapping = { tierstore: 2 };

    const variantWithCompareAt = {
      ...existingVariant,
      compareAtPrice: '95.00' // has compare-at price → tier logic will use updateCompareAt
    };
    mockShopifyService.getVariantsBySkus.mockResolvedValue([variantWithCompareAt]);

    const priceData = {
      parentSku: 'PARENT-001',
      children: [{
        sku: 'CHILD-001',
        price: 99.99,
        specialPrice: 79.99,
        tierPrices: [{ customer_group_id: 2, qty: 1, value: 85.00 }]
      }]
    };

    await service.updateShopifyPricesForStore(priceData, 'tierstore', storeConfig);

    const variantPrices = mockShopifyService.updateVariantPrices.mock.calls[0][1];
    // Tier store: uses updateCompareAt flag, not compareAtPrice field
    expect(variantPrices[0].updateCompareAt).toBe(true);
    expect(variantPrices[0]).not.toHaveProperty('compareAtPrice');
  });
});
```

- [ ] **Step 4.2: Run to confirm new tests fail**

```bash
npx jest tests/services/sync/price-sync.service.test.js --no-coverage -t "updateShopifyPricesForStore"
```

Expected: FAIL — non-tier store still uses `updateCompareAt` logic, not specialPrice

- [ ] **Step 4.3: Update `updateShopifyPricesForStore` in `price-sync.service.js`**

This step requires **two separate edits** to `price-sync.service.js`:

**Edit A** — Replace the variantPrices-building block (lines 489–513):

Find the block inside `for (const child of priceData.children)` that starts with `const hasCompareAt = variant.compareAtPrice !== null` and ends with the closing `if (hasCompareAt) { ... }` logger block:

```js
// BEFORE (entire block):
const hasCompareAt = variant.compareAtPrice !== null;
variantPrices.push({
  id: variant.id,
  price,
  productId: variant.product.id,
  updateCompareAt: hasCompareAt
});

if (groupId && price !== child.price) {
  logger.debug('Using tier price for variant', {
    sku: child.sku,
    tierPrice: price,
    basePrice: child.price,
    customerGroupId: groupId
  });
}

if (hasCompareAt) {
  logger.debug('Variant has compareAtPrice, will update compareAtPrice only', {
    sku: child.sku,
    currentCompareAt: variant.compareAtPrice,
    currentPrice: variant.price,
    newCompareAt: price
  });
}

// AFTER:
if (groupId) {
  // Tier store — existing behaviour unchanged
  const hasCompareAt = variant.compareAtPrice !== null;
  variantPrices.push({
    id: variant.id,
    price,
    productId: variant.product.id,
    updateCompareAt: hasCompareAt
  });

  if (price !== child.price) {
    logger.debug('Using tier price for variant', {
      sku: child.sku,
      tierPrice: price,
      basePrice: child.price,
      customerGroupId: groupId
    });
  }
} else {
  // Non-tier store — drive compareAtPrice from Magento special_price
  const hasSpecial = child.specialPrice != null && child.specialPrice < price;
  if (child.specialPrice != null && child.specialPrice >= price) {
    logger.warn('special_price >= regular price, ignoring special price', {
      sku: child.sku, specialPrice: child.specialPrice, price
    });
  }
  variantPrices.push({
    id: variant.id,
    price: hasSpecial ? child.specialPrice : price,
    compareAtPrice: hasSpecial ? price : null,
    productId: variant.product.id
  });
}
```

**Edit B** — Fix the `pricesToUpdate` destructure (~line 535, inside the `for (const [productId, productVariants] of variantsByProduct)` loop). Find:

```js
.map(({ id, price, updateCompareAt }) => ({ id, price, updateCompareAt }));
```

Replace with:

```js
.map(({ id, price, updateCompareAt, compareAtPrice }) => ({ id, price, updateCompareAt, compareAtPrice }));
```

- [ ] **Step 4.4: Run all price-sync tests**

```bash
npx jest tests/services/sync/price-sync.service.test.js --no-coverage
```

Expected: PASS (all tests)

- [ ] **Step 4.5: Run the full test suite to check for regressions**

```bash
npx jest --no-coverage
```

Expected: PASS (all tests across the project)

- [ ] **Step 4.6: Commit**

```bash
git add src/services/sync/price-sync.service.js tests/services/sync/price-sync.service.test.js
git commit -m "feat: sync special_price to Shopify via compareAtPrice"
```
