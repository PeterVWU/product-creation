# Standalone Product Price Sync Design

**Date:** 2026-03-18
**Status:** Approved

## Overview

Extend the price sync feature to support standalone (simple) Magento products. Currently `syncPrices` only syncs prices for configurable products by iterating over their children. When given a standalone product SKU, the `children` array stays empty and no prices are updated.

## Behaviour

A standalone simple product is its own only variant. The fix treats the parent product itself as a single-element `children` array. All existing sync logic — Magento target update, Shopify variant lookup, special_price → compareAtPrice mapping, tier pricing — applies identically.

### Shopify Target (non-tier stores)

| Source Magento | Shopify `price` | Shopify `compareAtPrice` |
|---|---|---|
| Has `special_price` | `special_price` | regular `price` |
| No `special_price` | regular `price` | `null` (cleared) |

The Shopify variant SKU = the Magento product's own SKU (set during standalone product creation).

### Shopify Target (tier stores — unchanged)

Existing `updateCompareAt` detect-and-preserve logic. `special_price` is ignored for tier stores.

### Magento Target

| Source field | Target field |
|---|---|
| `price` | `price` |
| `special_price` (or absent) | `special_price` (null clears any existing value) |

## Component Changes

### `price-sync.service.js` — `extractPrices()`

Add an `else` branch after the existing `if (priceData.isConfigurable)` block:

```js
} else {
  // Standalone simple product — the product itself is its only variant
  priceData.children.push({
    sku: parent.sku,
    price: parent.price,
    specialPrice: this.extractSpecialPrice(parent),
    tierPrices: parent.tier_prices || []
  });
}
```

No other production code changes. All downstream methods (`updateMagentoPricesForInstance`, `updateShopifyPricesForStore`) already operate on `priceData.children` and work correctly with a 1-element array.

**Side effects:**
- `result.variantCount` becomes 1 instead of 0 for standalone products
- `notifyPriceSyncStart` / `notifyPriceSyncEnd` will report 1 variant synced

## What Is Not Changed

- `updateMagentoPricesForInstance` — no change
- `updateShopifyPricesForStore` — no change
- `shopify-target.service.js` — no change
- `target.service.js` — no change
- Tier pricing logic — no change
- Special price edge cases (0, NaN, `>=` regular price) — same guards apply

## Testing

Three new unit tests added to the existing `extractPrices` describe block in `tests/services/sync/price-sync.service.test.js`:

1. **Standalone, no special_price** — `children` has one entry with `sku`, `price`, `specialPrice: null`
2. **Standalone, with special_price** — `children` has one entry with `specialPrice` populated
3. **Standalone does not fetch extra children** — `getProductBySku` called exactly once (for the parent), never for a child SKU

## Files Touched

| File | Change |
|---|---|
| `src/services/sync/price-sync.service.js` | Add `else` branch in `extractPrices()` |
| `tests/services/sync/price-sync.service.test.js` | Add 3 tests in `extractPrices` describe |
