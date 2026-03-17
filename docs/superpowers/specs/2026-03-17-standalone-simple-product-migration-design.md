# Standalone Simple Product Migration

**Date:** 2026-03-17
**Status:** Approved

## Overview

Extend the product migration system to support standalone simple products — Magento simple products that have no configurable parent. These products are fully visible on the storefront and map to a single-variant Shopify product with no options on the Shopify side.

Currently the system rejects any non-configurable product at extraction. This feature adds a parallel code path that handles standalone simples cleanly without touching the existing configurable flow.

## Detection & Routing

Detection happens at the entry point of both orchestrators (`migrateProduct()`):

1. Fetch the product from source Magento: `GET /V1/products/{sku}`
2. `type_id === 'configurable'` → existing configurable path (unchanged)
3. `type_id === 'simple'` AND `visibility > 1` → new standalone simple path
4. `type_id === 'simple'` AND `visibility === 1` → throw `ExtractionError`: "Product is a configurable variant (visibility=1). Migrate its parent configurable instead."
5. Any other `type_id` → throw `ExtractionError`: unsupported product type

**Why visibility?** The Magento REST API has no reverse parent-lookup endpoint. `GET /V1/products/{sku}` returns no parent reference. The `visibility` field is the only in-product signal available and is the same heuristic Magento's own admin UI uses to distinguish variant children (`visibility=1`) from standalone products (`visibility=2,3,4`).

## New Files

### `src/services/migration/standalone-extraction.service.js`

Single method: `extractProduct(sku)`.

Fetches:
- `GET /V1/products/{sku}` — product data (SKU, name, price, `type_id`, `visibility`, custom attributes)
- `GET /V1/products/{sku}/media` — images
- Category IDs from `extension_attributes.category_links` → resolved to category names via source service
- Attribute translations via existing `AttributeService`

Returns:
```js
{
  product,      // raw Magento product object (includes price)
  images,       // array of media gallery entries
  categories,   // array of category name strings
  translations  // attribute code/label map
}
```

No children, link data, or configurable options.

### `src/services/migration/standalone-magento-creation.service.js`

Single method: `createProduct(extractedData, preparedData, targetService, storeViews)`.

Steps:
1. **Existence check** — `GET /V1/products/{sku}` on target. If found, throw `CreationError`: "Product already exists on target. Update not yet supported."
2. **First store view** — create product:
   - `type_id: 'simple'`
   - `visibility: 4` (Catalog, Search)
   - Price, name, custom attributes, `category_links`
   - Images via `ImageService`
3. **Subsequent store views** — scoped attribute updates (name, price, visibility), same cascading pattern as `creation.service.js`

## Modified Files

### `src/services/migration/shopify-creation.service.js`

New method: `createStandaloneProduct(extractedData, storeName)`.

Steps:
1. **Existence check** — search by SKU; if found, throw error: "Product already exists. Update not yet supported."
2. **Upload images** — same `fileCreate` flow as existing
3. **Create product** via `productSet` mutation:
   - No `options` array
   - Single variant: `{ sku, price, inventoryItem }` using source SKU
   - `productType` from `CategoryMappingService.getShopifyProductType()` (store-aware)
   - Media attached same as existing flow

Return shape mirrors `createProducts()` for orchestrator compatibility.

### `src/services/migration/preparation.service.js`

New method: `prepareStandaloneForInstance(extractedData, targetService)`.

Steps:
1. Map source category names → target Magento category IDs via `CategoryMappingService`
2. Ensure custom attributes exist on target via `AttributeService`

Returns: `{ categoryIds, attributeMapping }` — same shape as existing preparation result.

### `src/services/migration/orchestrator.service.js` (Magento)

Small routing branch at top of `migrateProduct()`:
- Fetch product, check `type_id` + `visibility`
- Standalone simple → `StandaloneExtractionService.extractProduct()` then loop over target instances calling `StandaloneMagentoCreationService.createProduct()` with preparation per instance
- Configurable → existing path, untouched

Multi-instance loop, result aggregation, and Google Chat notification remain unchanged.

### `src/services/migration/shopify-orchestrator.service.js`

Same routing branch pattern:
- Standalone simple → `StandaloneExtractionService.extractProduct()` then loop over Shopify stores calling `ShopifyCreationService.createStandaloneProduct()`
- Configurable → existing path, untouched

## Explicitly Out of Scope

- **Update if exists** — deferred; will be its own feature on the standalone code path
- **Grouped, virtual, bundle, downloadable product types** — unsupported, throw `ExtractionError`
- **Variant sync** — not applicable to standalone simples

## Error Handling

| Scenario | Behavior |
|---|---|
| `type_id === 'simple'`, `visibility === 1` | `ExtractionError`: "Product is a configurable variant. Migrate its parent configurable instead." |
| Unsupported `type_id` | `ExtractionError`: "Unsupported product type: `{type_id}`" |
| Product already exists on target | `CreationError`: "Product already exists on target. Update not yet supported." |

## What Is Not Changed

- `extraction.service.js` — configurable extraction unchanged
- `creation.service.js` — configurable Magento creation unchanged
- All platform clients (`source.service.js`, `target.service.js`, `shopify-target.service.js`)
- Category mapping, attribute, image, and description services
