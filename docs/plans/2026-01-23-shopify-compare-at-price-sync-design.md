# Shopify Compare At Price Sync

## Problem

When syncing prices from source Magento to Shopify, the current implementation updates the `price` field but erases the `compareAtPrice` field. This breaks sale pricing displays in Shopify.

## Solution

Update price sync to respect existing `compareAtPrice` on Shopify variants:

- **No compareAtPrice exists**: Update the regular `price` with Magento price
- **compareAtPrice exists**: Update only `compareAtPrice` with Magento price, leave `price` unchanged

This preserves sale pricing - when a product is on sale (has compareAtPrice), we update the "original" price while keeping the current sale price intact.

## Implementation

### File: `src/services/shopify/shopify-target.service.js`

**1. Update `getVariantsBySkus()` GraphQL query**

Add `compareAtPrice` to the query fields:

```graphql
productVariants(first: 100, query: $query) {
  edges {
    node {
      id
      sku
      price
      compareAtPrice    # ADD
      product {
        id
        title
      }
    }
  }
}
```

**2. Update `updateVariantPrices()` mutation builder**

Change variant mapping to conditionally set either `price` or `compareAtPrice`:

```js
const variants = variantPrices.map(v => ({
  id: v.id,
  ...(v.updateCompareAt
    ? { compareAtPrice: String(v.price) }
    : { price: String(v.price) })
}));
```

### File: `src/services/sync/price-sync.service.js`

**Update `updateShopifyPricesForStore()` variant mapping**

Add `updateCompareAt` flag based on whether Shopify variant has compareAtPrice:

```js
variantPrices.push({
  id: variant.id,
  price: child.price,
  productId: variant.product.id,
  updateCompareAt: variant.compareAtPrice !== null
});
```

## Behavior Matrix

| Shopify variant state | Action |
|-----------------------|--------|
| No compareAtPrice | Update `price` with Magento price |
| Has compareAtPrice | Update `compareAtPrice` with Magento price, leave `price` unchanged |

## No Changes To

- API endpoints or request/response format
- Magento price sync logic
- Google Chat notifications
- Logging format
