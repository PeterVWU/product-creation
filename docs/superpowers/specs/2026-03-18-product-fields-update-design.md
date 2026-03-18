# Product Fields Update

**Date:** 2026-03-18
**Status:** Approved

## Overview

Add a new endpoint to update a fixed set of content fields on both Magento and Shopify target stores for any given product SKU. The source of truth is always the source Magento instance. Supports both configurable and standalone simple products. Returns an error per store if the product does not exist on that target.

## API

**Endpoint:** `POST /api/v1/sync/product-fields`

**Request body:**
```json
{
  "sku": "PARENT-SKU",
  "options": {
    "targetMagentoStores": ["ejuices"],
    "targetShopifyStores": ["wholesale"],
    "includeMagento": true,
    "includeShopify": true
  }
}
```

All `options` fields are optional. When `targetMagentoStores` is omitted, the service defaults to **all keys in `config.magentoStores`**. This differs deliberately from `PriceSyncService.resolveMagentoTargetStores`, which returns an empty array when omitted — the behaviour here matches the Shopify resolver pattern instead. When `targetShopifyStores` is omitted, defaults to all configured Shopify stores. `includeMagento` and `includeShopify` default to `true`.

Note: omitting both store lists with just `{ "sku": "X" }` will push to every configured store on all platforms.

**Fields always updated (no per-field selection):**
- Product name
- Brand (Magento `brand` custom attribute → Shopify `vendor`)
- Categories (Magento `category_ids` → Shopify `productType`)
- Images (replace all existing)
- Description (Magento `description` custom attribute → Shopify `descriptionHtml`)
- SEO: meta title (`meta_title`), meta keywords (`meta_keyword` attribute code → Shopify `tags`), meta description (`meta_description`)

**Response:** HTTP status is derived from the computed top-level `result.success`:
- `200` — `result.success === true` (all stores succeeded)
- `207` — `result.success === false` (any per-store failure, any entry in `errors[]`, or both)

**Result shape:**
```json
{
  "success": true,
  "sku": "PARENT-SKU",
  "results": {
    "magento": {
      "ejuices": { "success": true }
    },
    "shopify": {
      "wholesale": { "success": true }
    }
  },
  "errors": [],
  "warnings": []
}
```

If the product does not exist on a target store, that store's result is `{ "success": false, "error": "Product not found in target store" }`. This sets `result.success = false` and returns HTTP 207. Other stores continue processing.

## Extraction

Source product is fetched once via `sourceService.getProductBySku(sku)`. If not found, throw immediately — **neither start nor end notification is sent** in this case.

The resolved target store lists (`allTargetStores`) are computed from options **before** extraction begins, matching the price sync pattern — so the lists are available for the start notification as soon as extraction succeeds.

Fields extracted:

- `product.name`
- `product.media_gallery_entries` → image file paths (prepended with source base URL to form publicly accessible URLs for Shopify; downloaded to base64 for Magento)
- `product.custom_attributes` → `description`, `brand` (option ID), `meta_title`, `meta_keyword`, `meta_description`
- `product.type_id` + `product.visibility` → detect configurable vs standalone. Logic is a private method duplicated inline (same approach as each orchestrator — not a shared utility):
  - `type_id === 'configurable'` → configurable
  - `type_id === 'simple'` AND `visibility > 1` → standalone simple
  - `type_id === 'simple'` AND `visibility === 1` → throw: "Product is a child simple (non-standalone). Pass the parent SKU instead."
  - Any other `type_id` → throw: "Unsupported product type: `{type_id}`"
- `product.extension_attributes.category_links` → category IDs → resolved to `{ [id]: name }` via `AttributeService.translateCategories(categoryIds)`
- **Configurable products only**: call `extractChildLinks(product)` (same parsing logic as `PriceSyncService.extractChildLinks`) → take `childLinks[0]` as the `firstChildSku`. If `childLinks` is empty for a configurable product, throw an extraction error: "Configurable product has no child links; cannot locate product in Shopify."

Brand option ID is translated to a human-readable label via `AttributeService.translateBrandAttribute(product)`. `AttributeService` is instantiated in the `ProductUpdateService` constructor with `this.sourceService` — same pattern as `StandaloneExtractionService`.

After successful extraction, fire `notifyProductUpdateStart(sku, allTargetStores)` before beginning store updates.

## Magento Update Flow (per target store)

Get the target service instance: `const targetService = TargetService.getInstanceForStore(storeName)`. All method calls below use this instance unless noted.

Note: `targetService` is a `TargetService` instance. `createScopedInstance` is an **instance method** on it — not a static call. `MagentoClient.buildEndpoint` automatically prefixes `/rest/V1/...` → `/rest/{storeCode}/V1/...` when `storeCode` is set, so scoped writes work correctly via the normal `put()` method.

**Step A — Global-scope fields (once per instance, not per store view):**

1. **Existence check** — `targetService.getProductBySku(sku)`. If null, record `{ success: false, error: "Product not found in target store" }` for this store and skip to next. Store the returned product object; its `media_gallery_entries` are reused in step A5 to avoid an extra API call.
2. **Brand translation** — source brand label → target option ID via `targetService.ensureAttributeOptionExists('brand', brandLabel)`. If brand is null (no brand on source), omit from payload. On failure, push to per-store `warnings[]` and continue without brand.
3. **Category mapping** — two-step:
   a. `categoryMappingService.getTargetMagentoCategories(sourceCategoryNames)` → target category names.
   b. `targetService.getCategoryIdByName(name)` for each → target category IDs. Unmapped or unresolvable entries are skipped; push to per-store `warnings[]`.
4. **PUT global fields** — `await targetService.client.put(\`/rest/all/V1/products/${encodeURIComponent(sku)}\`, payload)` (same pattern as `updateProductWeight`) with: `brand` custom attribute and `extension_attributes.category_links` (array of `{ category_id, position: 0 }`). Must use `/rest/all/` — store-scoped endpoints don't save global-scope attributes correctly (existing Magento bug noted in codebase).
5. **Image replace** — `targetService.deleteAllProductMedia(sku)` is a new method that loops over `media_gallery_entries` from the product fetched in step A1 (no extra GET needed) and deletes each entry via `DELETE /rest/V1/products/{sku}/media/{entryId}`. Individual deletion failures are logged and skipped (best-effort). After deletion, each source image is downloaded to base64 and uploaded via `targetService.uploadProductImage(sku, base64, metadata)`. This step runs once per instance after step A4.

**Step B — Store-view-scoped fields (per store view):**

Discover store views via `targetService.getStoreWebsiteMapping()`. For each store view, call `targetService.createScopedInstance(storeCode)` and on that scoped instance call `scopedService.updateProduct(sku, payload)` with: `name`, `description`, `meta_title`, `meta_keyword`, `meta_description` custom attributes. These are store-view-scoped in Magento; the scoped `put()` call is automatically prefixed to `/rest/{storeCode}/V1/...` by `MagentoClient.buildEndpoint`.

Result key: `storeName` (one result per Magento instance, not per store view).

## Shopify Update Flow (per store)

1. **Existence check** — method depends on product type:
   - **Standalone simple**: `shopifyTargetService.getVariantsBySkus([sku])` — the variant SKU matches the product SKU directly.
   - **Configurable**: `shopifyTargetService.getVariantsBySkus([firstChildSku])` using the child SKU extracted during extraction. In Shopify, parent SKUs are not variant SKUs; only child SKUs are.
   - If empty result, record `{ success: false, error: "Product not found in target store" }` and continue. Otherwise, extract `productId = variants[0].product.id`.
2. **Category mapping** — `categoryMappingService.getShopifyProductType(sourceCategoryNames, storeName)`.
3. **Update product fields** — new `updateProductFields(productId, fields)` method on `ShopifyTargetService` using the `productUpdate` GraphQL mutation with:
   - `title` — product name
   - `vendor` — brand label (omit field if null)
   - `descriptionHtml` — description
   - `productType` — mapped from categories
   - `seo.title` — meta_title (omit if null — preserves existing Shopify SEO value)
   - `seo.description` — meta_description (omit if null — preserves existing Shopify SEO value)
   - `tags` — `meta_keyword` value split by comma and trimmed into an array; **replaces all existing Shopify tags** (destructive, not merged)
4. **Image replace** — wrap entirely in try/catch; on failure, push to per-store `warnings[]` and continue with `success: true` (text fields already written). Inside the try:
   - New `deleteAllProductMedia(productId)` method on `ShopifyTargetService`: first query existing media IDs (or accept them from a prior call), then call the `productDeleteMedia` GraphQL mutation with all media IDs. Failure of this mutation is re-thrown so the outer try/catch handles it.
   - Source image URLs (full source Magento URLs from `media_gallery_entries[].file`) are passed directly to `createProductMedia(productId, images)`. `createProductMedia` takes external URLs and internally polls for readiness — no `uploadAndWaitForFiles` step needed.

## New Files

| File | Change |
|---|---|
| `src/services/sync/product-update.service.js` | New — main service, mirrors `price-sync.service.js` structure |
| `src/services/shopify/shopify-target.service.js` | Add `updateProductFields()` and `deleteAllProductMedia()` methods |
| `src/services/magento/target.service.js` | Add `deleteAllProductMedia()` method |
| `src/controllers/sync.controller.js` | Add `updateProductFields` controller handler |
| `src/routes/v1/sync.routes.js` | Add `POST /product-fields` route with validation |
| `src/services/notification/google-chat.service.js` | Add `notifyProductUpdateStart()` and `notifyProductUpdateEnd()` methods |

## Google Chat Notifications

Two new methods on `GoogleChatService`, matching the style of migration notifications:
- `notifyProductUpdateStart(sku, targetStores)` — two arguments; sent after successful extraction, before store updates begin
- `notifyProductUpdateEnd({ sku, success, errors, targetStores, duration })` — sent in two places: (1) in the happy path after all stores complete, and (2) in the top-level `catch` block for any uncaught error — **but not** when extraction throws (since no start notification was sent in that case)

## Error Handling

- Product not found on source → extraction throws, neither start nor end notification sent; the error propagates to the caller via the Express error handler
- Product not found on a target → per-store `success: false`, `result.success = false`, processing continues to other stores
- Brand translation failure (Magento) → push to per-store `warnings[]`, brand field omitted from payload
- Category mapping failure (Magento) → push to per-store `warnings[]`, category update skipped
- Image replace failure (Shopify) → caught in per-store try/catch, push to per-store `warnings[]`, store result remains `success: true`
- Image replace failure (Magento) → log warning, continue (text fields already written); push to per-store `warnings[]`
- Any uncaught store-level error → push to top-level `errors[]`, `result.success = false`, continue if `config.errorHandling.continueOnError` is true
- Top-level `catch` → call `notifyProductUpdateEnd` with `success: false`, return result
