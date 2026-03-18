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

All `options` fields are optional. Defaults match price sync behaviour: all configured stores, both platforms included.

**Fields always updated (no per-field selection):**
- Product name
- Brand (Magento `brand` custom attribute → Shopify `vendor`)
- Categories (Magento `category_ids` → Shopify `productType`)
- Images (replace all existing)
- Description (Magento `description` custom attribute → Shopify `descriptionHtml`)
- SEO: meta title, meta keywords, meta description

**Response:**
- `200` — all stores succeeded
- `207` — partial success (at least one store failed)

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

If the product does not exist on a target store, that store's result is `{ "success": false, "error": "Product not found in target store" }`. Other stores continue processing.

## Extraction

Source product is fetched once via `sourceService.getProductBySku(sku)`. Only the parent product is read — child products are not touched.

Fields extracted:
- `product.name`
- `product.media_gallery_entries` → images
- `product.custom_attributes` → `description`, `brand` (option ID), `meta_title`, `meta_keyword`, `meta_description`
- `product.extension_attributes.category_links` → category IDs → resolved to `[{ id, name }]` via `sourceService.getCategoryById()`
- `product.type_id` → detect configurable vs standalone (same `classifyProductType` logic used in orchestrators)

Brand option ID is translated to a human-readable label via `AttributeService.translateBrandAttribute()` — same as migration.

## Magento Update Flow (per target store)

1. **Existence check** — `targetService.getProductBySku(sku)`. If null, record `{ success: false, error: "Product not found in target store" }` for this store and continue.
2. **Brand translation** — source brand label → target option ID via `targetService.ensureAttributeOptionExists('brand', brandLabel)`.
3. **Category mapping** — source category names → target category IDs via `CategoryMappingService` + `targetService.getCategoryIdByName()`.
4. **Build focused update payload** — only the 8 fields: `name`, `brand` custom attribute, `description` custom attribute, `meta_title`, `meta_keyword`, `meta_description` custom attributes, and `category_ids` via `extension_attributes.category_links`.
5. **PUT product** — `targetService.updateProduct(sku, payload)` using `/rest/V1/products/{sku}` (store-scoped — these are content fields, not global-scope attributes).
6. **Image replace** — new `deleteAllProductMedia(sku)` method removes all existing media entries, then each source image is uploaded via `targetService.uploadProductImage()`.

## Shopify Update Flow (per store)

1. **Existence check** — `shopifyTargetService.getVariantsBySkus([sku])`. If empty result, record `{ success: false, error: "Product not found in target store" }` and continue.
2. **Category mapping** — source category names → Shopify `productType` via `CategoryMappingService.getShopifyProductType()`.
3. **Update product fields** — new `updateProductFields(productId, fields)` method on `ShopifyTargetService` using the `productUpdate` GraphQL mutation with:
   - `title` — product name
   - `vendor` — brand label
   - `descriptionHtml` — description
   - `productType` — mapped from categories
   - `seo.title` — meta_title
   - `seo.description` — meta_description
   - `tags` — meta_keywords (comma-split into array)
4. **Image replace** — new `deleteAllProductMedia(productId)` method removes all existing media, then source images are uploaded via existing `uploadAndWaitForFiles()` + `createProductMedia()`.

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
- `notifyProductUpdateStart(sku, targetStores)` — sent before update begins
- `notifyProductUpdateEnd({ sku, success, errors, targetStores, duration })` — sent on completion or failure

## Error Handling

- Product not found on a target → per-store error, processing continues to other stores
- Brand translation failure → logged as warning, update continues without brand field
- Category mapping failure → logged as warning, update continues without category field
- Image replace failure → logged as warning, update continues (fields already updated)
- Fatal extraction error (product not found on source) → immediately return failure, no notifications sent to stores
