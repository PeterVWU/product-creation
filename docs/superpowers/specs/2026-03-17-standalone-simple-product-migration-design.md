# Standalone Simple Product Migration

**Date:** 2026-03-17
**Status:** Approved

## Overview

Extend the product migration system to support standalone simple products — Magento simple products that have no configurable parent. These products are fully visible on the storefront and map to a single-variant Shopify product with no options on the Shopify side.

Currently the system rejects any non-configurable product at extraction. This feature adds a parallel code path that handles standalone simples cleanly without touching the existing configurable flow.

## Detection & Routing

Detection happens at the entry point of both orchestrators (`migrateProduct()`), as a type probe **before** any extraction is called. The type probe must happen before `executeExtractionPhase()` is called because `ExtractionService.extractProduct()` throws `ExtractionError` for any non-configurable product.

**Restructured `migrateProduct()` — pseudocode (applies to both orchestrators):**
```
migrateProduct(sku, options):
  // TYPE PROBE — must occur before any extraction call
  sourceProduct = await sourceService.getProductBySku(sku)
  productType = classifyProductType(sourceProduct)  // returns 'configurable' | 'standalone-simple' | throws

  if productType === 'configurable':
    // existing path — completely unchanged
    extractedData = await executeExtractionPhase(sku, migrationContext)
    ...existing configurable flow...

  else if productType === 'standalone-simple':
    // new standalone path
    extractedData = await executeStandaloneExtractionPhase(sku, sourceProduct, migrationContext)
    ...standalone flow (see below)...
```

**`classifyProductType(product)` location:** Implemented as a private method on each orchestrator class (not a shared module). The function is small and the two orchestrators already share no direct imports. Keeping it duplicated avoids adding a shared utility dependency; if the logic ever diverges or needs testing in isolation, extraction can happen then.

**`classifyProductType(product)` logic:**
1. `type_id` is falsy/null/undefined → throw `ExtractionError`: "Product type could not be determined for SKU: `{sku}`"
2. `type_id === 'configurable'` → return `'configurable'`
3. `type_id === 'simple'` AND `visibility > 1` → return `'standalone-simple'`
4. `type_id === 'simple'` AND `visibility === 1` → throw `ExtractionError`: "Product is a configurable variant (visibility=1). Migrate its parent configurable instead."
5. Any other `type_id` → throw `ExtractionError`: "Unsupported product type: `{type_id}`"

**Trade-off:** The type probe adds one extra source API call on the configurable path (the existing `ExtractionService` re-fetches internally unchanged), resulting in two `GET /V1/products/{sku}` calls for every configurable migration. This is acceptable given the infrequency relative to the full migration workload. Threading the probe result into `ExtractionService` to eliminate the double-fetch is a possible future optimization.

**Why visibility?** The Magento REST API has no reverse parent-lookup endpoint. `GET /V1/products/{sku}` returns no parent reference. The `visibility` field is the only in-product signal available and is the same heuristic Magento's own admin UI uses to distinguish variant children (`visibility=1`) from standalone products (`visibility=2,3,4`).

## New Files

### `src/services/migration/standalone-extraction.service.js`

**Dependencies:** Requires `SourceService` and `AttributeService` injected via constructor — same pattern as `ExtractionService`.

Single method: `extractProduct(sku, prefetchedProduct)`. Accepts the pre-fetched product object from the routing step to avoid a duplicate API call.

**Images** are read from `prefetchedProduct.media_gallery_entries` directly — the same approach used by `ExtractionService.extractImages()`. No separate API call is made.

**Categories** are resolved by extracting category IDs from `prefetchedProduct.extension_attributes.category_links`, calling `this.attributeService.translateCategories(categoryIds)` to get `{ [id]: name }`, then converting to `[{ id, name }]` — identical to `ExtractionService` lines 41–44 and 182–185.

**Attribute translations** are built via `AttributeService`:
- `translateAttributeSet(prefetchedProduct.attribute_set_id)` is called to resolve `{ id, name }` — same call as `ExtractionService` line 168–170. The raw `attribute_set_id` integer is not stored directly.
- `translateConfigurableOptions()` is **not called** — standalone simples have no `configurable_product_options` so `attributes` and `attributeValues` are hardcoded to `{}` directly, avoiding unnecessary coupling.
- `translateCustomAttributes()` is called on `prefetchedProduct.custom_attributes` to get `{ [attribute_code]: value }`
- `brandLabel` is extracted same as `ExtractionService`

The resulting `translations` shape (identical sub-key structure to `ExtractionService`):
```js
translations = {
  attributeSet: { id, name },                          // from translateAttributeSet(prefetchedProduct.attribute_set_id)
  attributes: {},                                       // hardcoded empty — no configurable options
  attributeValues: {},                                  // hardcoded empty — no configurable option values
  categories: { [id]: name },                          // category id → name map
  customAttributes: { [attribute_code]: value },        // plain object from translateCustomAttributes()
  brandLabel: '...'                                     // brand label if present
}
```

**Note on select-type custom attributes:** Because `attributeValues` is `{}`, `prepareAttributes({})` in the preparation step produces an empty `attributeMapping`. Select-type custom attribute option IDs will not be translated to target option IDs on the Magento creation path. This is an accepted limitation for the initial implementation — deferred to a future enhancement.

Returns (compatible with existing orchestrator code that reads `extractedData.parent` and `extractedData.children`):
```js
{
  parent,         // the prefetchedProduct object (price, visibility, all attributes, media_gallery_entries)
  images: {
    parent: [],   // media_gallery_entries from prefetchedProduct
    children: {}  // empty object — no variants exist
  },
  categories,     // array of { id, name } objects — same shape as ExtractionService
  translations,   // see sub-key structure above
  children: [],   // REQUIRED — empty array; orchestrator reads extractedData.children.length and .map()
  childLinks: []  // REQUIRED — empty array; matches ExtractionService return shape for defensive consistency
}
```

### `src/services/migration/standalone-magento-creation.service.js`

Methods:
- `createProduct(extractedData, preparedData, storeViews, websiteIds, options)` — full creation
- `updateProductForStore(extractedData, storeCode, options)` — scoped attribute update for subsequent store views

The `options` parameter carries `{ productEnabled, includeImages }` — same `migrationOptions` object threaded through from `migrateProduct()`.

**`createProduct` owns the full store-view loop** (same responsibility boundary as `CreationService.createProducts()`). The orchestrator calls `createProduct` once; the service iterates `storeViews` internally — the orchestrator does **not** loop over store views separately.

**`createProduct` steps:**
1. **First store view** — create product:
   - `type_id: 'simple'`
   - `visibility: 4` (Catalog, Search)
   - `attribute_set_id` from `preparedData.attributeSet.id`
   - `website_ids` from `websiteIds` parameter
   - `status`: `options.productEnabled ? 1 : 2` — same as existing `buildSimpleProductData()`
   - Price, name, custom attributes, `category_links` (from `preparedData.categoryMapping`)
   - `stock_item` from `parent.extension_attributes.stock_item` — same as `buildSimpleProductData()` in `creation.service.js`
   - `weight`: `"0.1"` default — same as `buildSimpleProductData()`; follow-up `updateProductWeight()` call if needed
   - Images via `ImageService` (only if `options.includeImages`)
2. **Subsequent store views** — for each additional store view, create a scoped instance via `targetService.createScopedInstance(storeCode)` and call `updateProductForStore(extractedData, storeCode, options)`

**`updateProductForStore` steps:**
- Calls `PUT /V1/products/{sku}` on scoped target with store-scoped name, price, visibility, and **status** — mirrors `CreationService.updateProductsForStore()`

Existence is checked by the orchestrator before calling this service. This service does not perform an existence check internally.

## Modified Files

### `src/services/migration/shopify-creation.service.js`

New method: `createStandaloneProduct(extractedData, storeName)`.

Steps:
1. **Upload images** — same `fileCreate` flow as existing
2. **Create product** via `productSet` mutation:
   - No `productOptions` array — omitting it entirely causes Shopify to create the default `"Title"/"Default Title"` option automatically
   - Single variant: `{ sku, price, inventoryItem }` using source SKU (`extractedData.parent.sku`) — **`optionValues` must be omitted** from the variant input (not set to `[]`); passing an empty `optionValues` array causes a Shopify API validation error for single-variant products
   - `productType` from `CategoryMappingService.getShopifyProductType()` (store-aware)
   - Call `buildImageInputs(extractedData.images, parent, [])` — `buildImageInputs` iterates `images.children` (the object) not the `children` array parameter; since `extractedData.images.children = {}` there are no variant-to-image associations to produce. The `[]` argument is passed to satisfy the method signature.
   - Media attached same as existing flow

Returns the same keys used by the Shopify orchestrator's result-wiring code:
```js
{
  parentProductId,      // Shopify product GID
  shopifyHandle,        // product handle
  createdVariants: [{ id, sku, title, success: true }]  // one entry for the single Shopify variant; title from API response, matches existing createProducts() shape
}
```

`createdVariants` has one entry so `summary.variantsMigrated = 1` in Google Chat — accurately reflects one purchasable variant created. The `title` field matches the existing `createProducts()` shape.

Existence is checked by the orchestrator before calling this service. This service does not perform an existence check internally.

### `src/services/migration/preparation.service.js`

**No new method needed.** The existing `prepareTarget(extractedData, targetService)` already handles the standalone case without changes:
- `prepareAttributeSet(extractedData.translations.attributeSet)` — works on standalone data
- `prepareAttributes(extractedData.translations.attributeValues)` — `attributeValues = {}` for standalones; `groupByAttribute({})` returns `{}` gracefully; result is an empty `attributeMapping`
- `customAttributeMapping = extractedData.translations.customAttributes` — passes through correctly
- `prepareCategories(extractedData.categories)` — works on standalone data

The Magento orchestrator calls `prepareTarget(extractedData, targetService)` unchanged for the standalone path.

### `src/services/migration/orchestrator.service.js` (Magento)

**Restructured `migrateProduct()`** — type probe and branch added at the top, before the existing `executeExtractionPhase()` call (see pseudocode in Detection section). The existing `executeExtractionPhase()` call AND the existing `notifyMigrationStart` call (currently line 84) both move inside the `configurable` branch. They are NOT left unconditionally before the branch — doing so would fire `notifyMigrationStart` twice for standalone migrations (once before the branch, once in the standalone path).

**New `executeStandaloneExtractionPhase(sku, sourceProduct, migrationContext)` helper:**
- Calls `standaloneExtractionService.extractProduct(sku, sourceProduct)`
- Logs extraction result; `extractedData.children.length` safely logs as `0`
- Updates `context.phases.extraction` (same as existing `executeExtractionPhase`): `success`, `duration`, `childrenFound: 0`

After standalone extraction, `notifyMigrationStart` is called with `childSkus = []` (from `extractedData.children.map(c => c.sku)`).

**Note on type probe error path:** If the type probe `getProductBySku(sku)` throws (product not found, network error), it is caught by the outer `try/catch` in `migrateProduct()` and `notifyMigrationEnd` fires correctly. `context.phases.extraction.duration` will remain `0` — this is acceptable since extraction never started.

**New `migrateStandaloneToInstance(sku, extractedData, instanceConfig, migrationOptions)` helper:**
1. **Construct services** — `targetService = TargetService.getInstanceForStore(instanceConfig.storeName)`, `preparationService = new PreparationService(targetService, this.categoryMappingService)`, `creationService = new StandaloneMagentoCreationService(this.sourceService, targetService)` — `StandaloneMagentoCreationService` constructs `ImageService` internally using `sourceService` and `targetService` (same pattern as `CreationService` constructor lines 11–13); the orchestrator does not hold a `this.imageService`
2. **Website IDs** — derive `websiteIds` from `getStoreWebsiteMapping()`, same as `migrateToInstance` (lines 203–205)
3. **Existence check** — `GET /V1/products/{sku}` on target. If found → **return** `{ success: false, mode: 'error', error: 'Product already exists on target. Update not yet supported.', storeResults: {} }` (do not throw; `storeResults: {}` is required by outer loop and notifier).
   **Note:** This intentionally uses `success: false` / `mode: 'error'`, unlike the configurable "all variants exist" case which returns `success: true` / `mode: 'no-action'`. The standalone case is a hard error (update not supported) rather than a benign no-op, so `instancesFailed` is incremented. The existing `isConfigurable` guard inside `migrateToInstance()` becomes dead code for simple products after this routing change — it can be cleaned up as a follow-up but does not affect correctness.
4. **Store views** — discover via `GET /rest/V1/store/storeViews`
5. Call `preparationService.prepareTarget(extractedData)` — existing method, reused unchanged
6. Call `creationService.createProduct(extractedData, preparedData, storeViews, websiteIds, migrationOptions)` — returns `{ parentProductId }` (integer Magento product ID from API response)
7. **Return** on success: `{ success: true, mode: 'standalone-creation', productId: creationResult.parentProductId, childrenCreated: 0, storeResults }` — `childrenCreated: 0` is intentional; the outer `totalChildrenMigrated` accumulation at lines 138–141 of the orchestrator will safely produce `0`

The outer multi-instance loop (which reads `instanceResult.success` and respects `continueOnError`), result aggregation, and Google Chat notification remain unchanged. `summary.childrenMigrated` will be `0` for standalone products — acceptable.

### `src/services/migration/shopify-orchestrator.service.js`

**Restructured `migrateProduct()`** — type probe and branch added at the top, before the existing `executeExtractionPhase()` call (see pseudocode in Detection section).

**New `executeStandaloneExtractionPhase(sku, sourceProduct, migrationContext)` helper** mirrors the Magento side.

After standalone extraction, `notifyMigrationStart(sku, [], [shopifyStore])` is called with `childSkus = []` — same call site as the existing configurable path (line 93 of `shopify-orchestrator.service.js`), just with an empty children array.

**New `migrateStandaloneToStore(sku, extractedData, storeConfig, migrationOptions)` helper:**
1. **Construct services** — `shopifyTargetService = this.getShopifyTargetService(storeConfig.storeName)` (existing helper on `ShopifyOrchestratorService`; no static factory exists on `ShopifyTargetService`), `creationService = new ShopifyCreationService(this.sourceService, shopifyTargetService, this.categoryMappingService, storeConfig.storeName)` — same construction pattern as the existing creation phase
2. **Existence check** — call `shopifyTargetService.getVariantsBySkus([sku])`. If any result is returned → **return** `{ success: false, mode: 'error', error: 'Product already exists. Update not yet supported.' }` (do not throw)
2. Call `ShopifyCreationService.createStandaloneProduct(extractedData, storeName)`
3. Set `migrationContext.shopifyProductId = creationResult.parentProductId`
4. Set `migrationContext.shopifyProductUrl = shopifyTargetService.buildAdminUrl(creationResult.parentProductId)`
5. Update `migrationContext.phases.creation`:
   ```js
   migrationContext.phases.creation.success = true;
   migrationContext.phases.creation.variantsCreated = creationResult.createdVariants.length; // = 1
   migrationContext.phases.creation.imagesUploaded = ...; // same as existing creation path
   ```
   Steps 3–5 mirror lines 194–196 and 286–289 of the current `shopify-orchestrator.service.js`.
6. Update `migrationContext.summary`:
   ```js
   migrationContext.summary.variantsMigrated = creationResult.createdVariants.length; // = 1
   migrationContext.summary.imagesUploaded = ...; // from creation result, same as existing path
   migrationContext.summary.errorsCount = migrationContext.errors.length;
   migrationContext.summary.warningsCount = migrationContext.warnings.length;
   migrationContext.summary.totalDuration = Date.now() - migrationStartTime;
   migrationContext.success = true;
   ```
   Same summary assignments as the existing configurable creation path.

The existing `hasChildren` gate (variant sync routing) is naturally bypassed — the standalone path is a separate branch entered before that gate.

The outer per-store loop, result aggregation, and Google Chat notification remain unchanged.

## Explicitly Out of Scope

- **Update if exists** — deferred; will be its own feature on the standalone code path
- **Grouped, virtual, bundle, downloadable product types** — unsupported, throw `ExtractionError`
- **Variant sync** — not applicable to standalone simples
- **Select-type custom attribute option ID translation** — deferred; standalone products pass raw option values through

## Error Handling

| Scenario | Behavior |
|---|---|
| `type_id === 'simple'`, `visibility === 1` | `ExtractionError`: "Product is a configurable variant (visibility=1). Migrate its parent configurable instead." |
| Unsupported `type_id` | `ExtractionError`: "Unsupported product type: `{type_id}`" |
| Product already exists on Magento target | Instance-level result `{ success: false, storeResults: {} }`. Other instances continue per `continueOnError`. |
| Product already exists on Shopify target | Store-level result `{ success: false }`. Other stores continue per `continueOnError`. |

## What Is Not Changed

- `extraction.service.js` — configurable extraction unchanged
- `creation.service.js` — configurable Magento creation unchanged
- All platform clients (`source.service.js`, `target.service.js`, `shopify-target.service.js`)
- Category mapping, attribute, image, and description services
