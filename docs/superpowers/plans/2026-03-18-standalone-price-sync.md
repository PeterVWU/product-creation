# Standalone Product Price Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `syncPrices` work for standalone (simple) Magento products by treating the product itself as its only variant.

**Architecture:** One `else if` branch in `extractPrices()` pushes the parent product into `children[]` when `type_id === 'simple'`. All downstream update methods already iterate `children` generically — no other production code changes are needed. Three new unit tests cover the standalone path.

**Tech Stack:** Node.js, Jest

---

## Chunk 1: Standalone price extraction

### Task 1: Add standalone product support to `extractPrices`

**Files:**
- Modify: `src/services/sync/price-sync.service.js` (around line 168 — the `if (priceData.isConfigurable)` block)
- Test: `tests/services/sync/price-sync.service.test.js` (inside the existing `extractPrices` describe block, after line 141)

**Context for the implementer:**

`extractPrices()` currently has:
```js
if (priceData.isConfigurable) {
  // ... fetches children, pushes to priceData.children ...
}
// nothing else — children stays [] for non-configurable products
```

The fix adds an `else if` branch. A standalone simple product in Shopify is created with `sku: parent.sku` as its only variant (see `shopify-creation.service.js` line 847). So `getVariantsBySkus([parentSku])` will find it, and `updateProductPrice(parentSku, ...)` will update it on Magento targets.

The existing test mock pattern (look at the `extractPrices` describe block, lines 66–141):
- `service.sourceService.getProductBySku` is set as `jest.fn()` directly on the instance
- `.mockResolvedValueOnce(mockParent)` for the first call (fetching the parent)
- For standalone tests, there is NO second call — we only call `getProductBySku` once

---

- [ ] **Step 1: Write the three failing tests**

Add these three tests **inside** the existing `extractPrices` describe block in `tests/services/sync/price-sync.service.test.js`, after the last existing test (line 141, the closing `});` of `preserves tierPrices from child`):

```js
it('standalone: children contains one entry using parent sku and price', async () => {
  const mockParent = {
    sku: 'SIMPLE-001',
    type_id: 'simple',
    price: 49.99,
    tier_prices: [],
    custom_attributes: []
  };

  service.sourceService.getProductBySku = jest.fn().mockResolvedValueOnce(mockParent);

  const result = await service.extractPrices('SIMPLE-001');

  expect(result.children).toHaveLength(1);
  expect(result.children[0].sku).toBe('SIMPLE-001');
  expect(result.children[0].price).toBe(49.99);
  expect(result.children[0].specialPrice).toBeNull();
  expect(result.children[0].tierPrices).toEqual([]);
});

it('standalone: specialPrice is populated from parent custom_attributes', async () => {
  const mockParent = {
    sku: 'SIMPLE-002',
    type_id: 'simple',
    price: 49.99,
    tier_prices: [],
    custom_attributes: [{ attribute_code: 'special_price', value: '39.99' }]
  };

  service.sourceService.getProductBySku = jest.fn().mockResolvedValueOnce(mockParent);

  const result = await service.extractPrices('SIMPLE-002');

  expect(result.children[0].specialPrice).toBe(39.99);
});

it('standalone: getProductBySku is called exactly once — no child fetches', async () => {
  const mockParent = {
    sku: 'SIMPLE-003',
    type_id: 'simple',
    price: 29.99,
    tier_prices: [],
    custom_attributes: []
  };

  service.sourceService.getProductBySku = jest.fn().mockResolvedValueOnce(mockParent);

  await service.extractPrices('SIMPLE-003');

  expect(service.sourceService.getProductBySku).toHaveBeenCalledTimes(1);
  expect(service.sourceService.getProductBySku).toHaveBeenCalledWith('SIMPLE-003');
});
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
npx jest tests/services/sync/price-sync.service.test.js --testNamePattern="standalone" -t "standalone"
```

Expected: **3 failing tests** — `children` will be empty because the `else if` branch does not exist yet.

- [ ] **Step 3: Implement the `else if` branch in `extractPrices()`**

In `src/services/sync/price-sync.service.js`, find the block (around line 168):

```js
    // If configurable, get children prices
    if (priceData.isConfigurable) {
      const childLinks = this.extractChildLinks(parent);
      const childSkus = this.resolveChildSkus(childLinks);

      for (const childSku of childSkus) {
        try {
          const child = await this.sourceService.getProductBySku(childSku);
          if (child) {
            priceData.children.push({
              sku: child.sku,
              price: child.price,
              specialPrice: this.extractSpecialPrice(child),
              tierPrices: child.tier_prices || []
            });
          }
        } catch (error) {
          logger.warn('Failed to fetch child product price', {
            parentSku: sku,
            childSku,
            error: error.message
          });
        }
      }
    }
```

Change the closing `}` of the configurable block (line ~191) from a bare `}` to `} else if (parent.type_id === 'simple') {`, then add the body and closing brace. In other words, replace:

```js
      }
    }

    // Log extracted price data for debugging
```

with:

```js
      }
    } else if (parent.type_id === 'simple') {
      // Standalone simple product — the product itself is its only variant
      priceData.children.push({
        sku: parent.sku,
        price: parent.price,
        specialPrice: this.extractSpecialPrice(parent),
        tierPrices: parent.tier_prices || []
      });
    }

    // Log extracted price data for debugging
```

The result should look like:

```js
    if (priceData.isConfigurable) {
      // ... existing configurable child-fetching loop (unchanged) ...
    } else if (parent.type_id === 'simple') {
      // Standalone simple product — the product itself is its only variant
      priceData.children.push({
        sku: parent.sku,
        price: parent.price,
        specialPrice: this.extractSpecialPrice(parent),
        tierPrices: parent.tier_prices || []
      });
    }
    // Other type_ids (bundle, grouped, virtual, downloadable) — children stays []
```

- [ ] **Step 4: Run the new tests to confirm they pass**

```bash
npx jest tests/services/sync/price-sync.service.test.js --testNamePattern="standalone" -t "standalone"
```

Expected: **3 passing tests**

- [ ] **Step 5: Run the full test suite to confirm nothing is broken**

```bash
npm test
```

Expected: **all tests pass** — the new branch is additive and does not touch the configurable path.

- [ ] **Step 6: Commit**

```bash
git add src/services/sync/price-sync.service.js \
        tests/services/sync/price-sync.service.test.js
git commit -m "feat: support standalone simple product price sync"
```
