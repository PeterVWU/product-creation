# Special Price Sync Design

**Date:** 2026-03-17
**Status:** Approved

## Overview

Extend the price sync feature to include Magento `special_price` when syncing to both Shopify and Magento target stores. Previously only regular `price` was synced; `compareAtPrice` on Shopify was preserved if it already existed but never driven by source data.

## Behaviour

### Shopify Target (non-tier stores)

| Source Magento | Shopify `price` | Shopify `compareAtPrice` |
|---|---|---|
| Has `special_price` | `special_price` | regular `price` |
| No `special_price` | regular `price` | `null` (cleared) |

### Shopify Target (tier stores — unchanged)

Tier-mapped stores continue using the existing `updateCompareAt` detect-and-preserve logic. `special_price` is ignored for these stores.

### Magento Target

| Source field | Target field |
|---|---|
| `price` | `price` |
| `special_price` (or absent) | `special_price` (null clears any existing value) |

Both fields are written in a single `PUT /rest/V1/products/{sku}` call.

## Data Model

After `extractPrices()`, each child object carries:

```js
{
  sku: "CHILD-SKU",
  price: 99.99,         // regular price (always present)
  specialPrice: 79.99,  // null if not set in source
  tierPrices: []
}
```

`special_price` lives in the Magento REST response under `custom_attributes`:

```json
[{ "attribute_code": "special_price", "value": "79.99" }]
```

A helper `extractSpecialPrice(product)` reads this array and returns a positive float or `null`.

**Edge cases for `specialPrice`:**
- Empty string value (`""`) → `null` (attribute present but unset in Magento)
- `NaN` from `parseFloat` → `null`
- `0` → `null` (treat as unset; free products via special_price are not a supported use case)
- `special_price >= regular_price` → `null` (Shopify rejects `compareAtPrice <= price`; log a warning and treat as no sale)

## Component Changes

### 1. `price-sync.service.js` — `extractPrices()`

Add `specialPrice: this.extractSpecialPrice(child)` to each child object pushed into `priceData.children`.

Add private helper:

```js
extractSpecialPrice(product) {
  const attr = (product.custom_attributes || [])
    .find(a => a.attribute_code === 'special_price');
  if (!attr?.value) return null;
  const v = parseFloat(attr.value);
  return (isNaN(v) || v <= 0) ? null : v;
}
```

Note: the `special_price >= regular_price` guard is applied in `updateShopifyPricesForStore` (section 4), not during extraction. This is intentional: Magento target stores can legitimately receive a `special_price` that is >= `price` (Magento does not reject this). The guard only exists because Shopify's API rejects `compareAtPrice <= price`.

### 2. `price-sync.service.js` — `updateMagentoPricesForInstance()`

Pass `child.specialPrice` (including `null`) to the target service method so stale special prices on the target are cleared when the source no longer has one.

```js
await service.updateProductPrice(child.sku, price, child.specialPrice);
```

The `price` used here is already resolved via the `groupId` tier-price branch (existing behaviour). Magento target stores with a `groupId` mapping still receive `child.specialPrice` — `groupId` only governs which value becomes `price`, not whether `special_price` is synced. Tier mapping is a Shopify-only concept; Magento target always syncs both fields.

### 3. `target.service.js` — `updateProductPrice()`

Add optional `specialPrice` parameter (default `undefined`). When the caller passes a value (including `null`), include `custom_attributes` in the payload:

```js
async updateProductPrice(sku, price, specialPrice = undefined) {
  const product = { sku, price };
  if (specialPrice !== undefined) {
    product.custom_attributes = [
      { attribute_code: 'special_price', value: specialPrice }
    ];
  }
  return await this.put(`/rest/V1/products/${encodeURIComponent(sku)}`, { product });
}
```

Using `undefined` as the sentinel means existing callers that omit the argument are unaffected.

Passing `value: null` clears the `special_price` attribute on the Magento target — the Magento REST API treats `null` value as a clear/reset for custom attributes.

### 4. `price-sync.service.js` — `updateShopifyPricesForStore()`

Replace the `updateCompareAt` flag logic for non-tier stores with special-price-driven logic:

```js
if (groupId) {
  // Tier store — existing behaviour unchanged
  const hasCompareAt = variant.compareAtPrice !== null;
  variantPrices.push({ id, price, productId, updateCompareAt: hasCompareAt });
} else {
  // Non-tier store — drive compareAtPrice from Magento special_price
  // Guard: if special_price >= regular price, treat as no special price
  // (Shopify rejects compareAtPrice <= price)
  const hasSpecial = child.specialPrice != null && child.specialPrice < price;
  if (child.specialPrice != null && child.specialPrice >= price) {
    logger.warn('special_price >= regular price, ignoring special price', {
      sku: child.sku, specialPrice: child.specialPrice, price
    });
  }
  variantPrices.push({
    id,
    price: hasSpecial ? child.specialPrice : price,
    compareAtPrice: hasSpecial ? price : null,
    productId
  });
}
```

Remove the now-unused `logger.debug` block that logged `currentCompareAt` / `currentPrice` (was tier-only logging).

Also update the `pricesToUpdate` map at line 535 to pass through `compareAtPrice`:

```js
.map(({ id, price, updateCompareAt, compareAtPrice }) => ({ id, price, updateCompareAt, compareAtPrice }));
```

Without this, `compareAtPrice` is stripped before it reaches `updateVariantPrices`. For tier store variants, `compareAtPrice` will be `undefined` here (they never had it set), which is harmless — the `updateVariantPrices` logic skips the `compareAtPrice` field when it is `undefined`.

### 5. `shopify-target.service.js` — `updateVariantPrices()`

Support two variant shapes:

- **Legacy tier shape:** `{ id, price, updateCompareAt: true }` — sets only `compareAtPrice`
- **New special-price shape:** `{ id, price, compareAtPrice }` — sets `price`, and includes `compareAtPrice` (string value or `null` to clear)

```js
const variants = variantPrices.map(v => {
  if (v.updateCompareAt) {
    return { id: v.id, compareAtPrice: String(v.price) };
  }
  const variant = { id: v.id, price: String(v.price) };
  if ('compareAtPrice' in v) {
    variant.compareAtPrice = v.compareAtPrice != null ? String(v.compareAtPrice) : null;
  }
  return variant;
});
```

## Error Handling

- If `special_price` is present in `custom_attributes` but not parseable as a float, treat it as `null` (no special price).
- Magento target special_price update is part of the same PUT call as price — if the call fails, both fields fail together (existing error handling covers this).
- Shopify: if `compareAtPrice` cannot be cleared (API error), the existing `userErrors` check in `updateVariantPrices` will throw and surface the error.

## Out of Scope

- Google Chat price notifications (`notifyPriceSyncEnd`) log only `p.price` per variant. Adding `specialPrice` to notifications is a separate observability improvement, not part of this feature.

## What Is Not Changed

- Tier pricing stores: no change to price logic or compareAtPrice handling.
- `special_price_from_date` / `special_price_to_date` Magento attributes: not synced (out of scope).
- Product creation flow: `compareAtPrice` is still not set during initial Shopify product creation (separate concern).

## Files Touched

| File | Change |
|---|---|
| `src/services/sync/price-sync.service.js` | `extractPrices`, `extractSpecialPrice` (new), `updateMagentoPricesForInstance`, `updateShopifyPricesForStore` |
| `src/services/magento/target.service.js` | `updateProductPrice` — add `specialPrice` param |
| `src/services/shopify/shopify-target.service.js` | `updateVariantPrices` — support new variant shape |
