# Store-Aware Category Mapping

## Problem

The category mapping currently returns a single Shopify `productType` regardless of which Shopify store a product is being created on. Different stores (e.g., VAPORDNA) need different product type values for the same source categories.

## Approach

Extend the existing `category-mapping.json` with per-store overrides using a `shopifyStores` object on each mapping entry. The service checks store-specific mappings first, then falls back to the default.

## Data Format

`category-mapping.json` gains an optional `shopifyStores` field per entry:

```json
{
  "source": "Tanks",
  "shopify": "Atomizers",
  "targetMagento": "Tanks",
  "shopifyStores": { "vapordna": "Vape Tank" }
}
```

Only entries where the store-specific value differs from the default `shopify` value need the override.

## Service Changes — `CategoryMappingService`

- New map: `sourceToShopifyByStore` — `Map<storeName, Map<sourceKey, shopifyType>>`
- Populated during `loadMappings()` from the `shopifyStores` object on each mapping entry
- `getShopifyProductType(sourceCategoryNames, storeName = null)`:
  - If `storeName` provided, check store-specific map first
  - Fall back to default `sourceToShopify` map
  - Return `null` if no match (unchanged behavior)

## Caller Changes — `ShopifyCreationService`

- Thread `storeName` from `options.shopifyStore` into `getShopifyProductType()` calls
- The store name is already available in the orchestrator via `options.shopifyStore`

## Backward Compatibility

- Callers that don't pass `storeName` get identical behavior to today
- JSON entries without `shopifyStores` work unchanged
- No new files, config, or env vars required
