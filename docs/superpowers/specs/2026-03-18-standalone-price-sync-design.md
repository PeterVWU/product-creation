# Standalone Product Price Sync Design

**Date:** 2026-03-18
**Status:** Approved

## Overview

Extend the price sync feature to support standalone (simple) Magento products. Currently `syncPrices` only syncs prices for configurable products by iterating over their children. When given a standalone product SKU, the `children` array stays empty and no prices are updated.

This spec covers `type_id === 'simple'` only. Other non-configurable Magento types (`bundle`, `grouped`, `virtual`, `downloadable`) are out of scope — they will continue to produce 0 variant updates, as before.

## Behaviour

A standalone simple product is its own only variant. The fix treats the parent product itself as a single-element `children` array. All existing sync logic — Magento target update, Shopify variant lookup, special_price → compareAtPrice mapping, tier pricing — applies identically to the 1-element array.

The Shopify variant SKU = the Magento product's own SKU (set during standalone product creation via `createStandaloneProduct`).

### Shopify Target (non-tier stores)

| Source Magento | Shopify `price` | Shopify `compareAtPrice` |
|---|---|---|
| Has `special_price` (and `special_price < price`) | `special_price` | regular `price` |
| No `special_price` | regular `price` | `null` (cleared) |

Note: the `special_price >= regular_price` guard is applied on the Shopify path only (same as for configurable products). A standalone product with `special_price >= price` will have Shopify `compareAtPrice` suppressed (treated as no special price) and will log a warning. See `2026-03-17-special-price-sync-design.md` for the guard details.

### Shopify Target (tier stores — unchanged)

Existing `updateCompareAt` detect-and-preserve logic. `special_price` is ignored for tier stores.

### Magento Target

| Source field | Target field |
|---|---|
| `price` | `price` |
| `special_price` (or absent) | `special_price` (null clears any existing value) |

The `special_price >= price` guard is NOT applied on the Magento path — a Magento target can legitimately store a `special_price` that equals or exceeds `price`. Behaviour is identical to configurable children.

### Error path — product not found in Shopify

If the standalone product's SKU does not exist in the target Shopify store, `updateShopifyPricesForStore` throws one of two errors depending on where the failure occurs:

- **`getVariantsBySkus` returns empty** (SKU not in Shopify at all): `No variants found in Shopify store "..." for SKUs: <sku>...`
- **SKU found in Shopify but no child matches** (should not occur for standalone, but guarded): `No matching variants found in Shopify store "..."`

Both surface to the caller as a store-level failure. No special handling is added — behaviour is identical to configurables with zero SKU matches.

## Component Changes

### `price-sync.service.js` — `extractPrices()`

Change the plain `if (priceData.isConfigurable)` to `if / else if / (implicit else)`:

```js
if (priceData.isConfigurable) {
  // ... existing configurable child-fetching logic (unchanged) ...
} else if (parent.type_id === 'simple') {
  // Standalone simple product — the product itself is its only variant
  priceData.children.push({
    sku: parent.sku,
    price: parent.price,
    specialPrice: this.extractSpecialPrice(parent),
    tierPrices: parent.tier_prices || []  // same field name as configurable children
  });
}
// Other type_ids (bundle, grouped, virtual, downloadable) — children stays []
```

**Assumption:** Magento simple products expose `tier_prices` at the same path as configurable children. This is consistent with the existing child-product handling and has been confirmed by inspection of the Magento REST API response format.

No other production code changes. All downstream methods (`updateMagentoPricesForInstance`, `updateShopifyPricesForStore`) already operate on `priceData.children` and work correctly with a 1-element array.

**Side effects:**
- `result.variantCount` becomes 1 instead of 0 for standalone products
- `notifyPriceSyncStart` / `notifyPriceSyncEnd` will report 1 variant synced

## What Is Not Changed

- `updateMagentoPricesForInstance` — no change
- `updateShopifyPricesForStore` — no change
- `shopify-target.service.js` — already updated by the special price sync feature (2026-03-17); no further changes required
- `target.service.js` — already updated by the special price sync feature (2026-03-17); no further changes required
- Tier pricing logic — no change
- Special price edge cases (0, NaN, `>=` regular price) — same guards apply

## Testing

Three new unit tests added to the existing `extractPrices` describe block in `tests/services/sync/price-sync.service.test.js`. All three use a mock parent with `type_id: 'simple'` (distinct from the existing `mockParentBase` fixture which has `type_id: 'configurable'`).

1. **Standalone, no special_price** — `children` has exactly one entry; `sku` = parent SKU, `price` = parent price, `specialPrice` = null, `tierPrices` = `[]`
2. **Standalone, with special_price** — `children` has exactly one entry with `specialPrice` populated from `custom_attributes`
3. **Standalone does not fetch extra children** — `getProductBySku` is called exactly once (for the parent), not a second time for any child SKU

## Files Touched

| File | Change |
|---|---|
| `src/services/sync/price-sync.service.js` | Add `else if (parent.type_id === 'simple')` branch in `extractPrices()` |
| `tests/services/sync/price-sync.service.test.js` | Add 3 tests in `extractPrices` describe block |
