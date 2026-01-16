module.exports = {
  MAGENTO_API: {
    ENDPOINTS: {
      PRODUCTS: '/rest/V1/products',
      PRODUCT_BY_SKU: '/rest/V1/products/:sku',
      PRODUCT_MEDIA: '/rest/V1/products/:sku/media',
      CONFIGURABLE_OPTIONS: '/rest/V1/configurable-products/:sku/options',
      CONFIGURABLE_CHILD: '/rest/V1/configurable-products/:sku/child',
      ATTRIBUTE_SETS: '/rest/V1/products/attribute-sets/sets/list',
      ATTRIBUTES: '/rest/V1/products/attributes/:attributeCode',
      ATTRIBUTE_OPTIONS: '/rest/V1/products/attributes/:attributeCode/options',
      CATEGORIES: '/rest/V1/categories/:id'
    },

    PRODUCT_TYPES: {
      SIMPLE: 'simple',
      CONFIGURABLE: 'configurable'
    },

    VISIBILITY: {
      NOT_VISIBLE: 1,
      CATALOG: 2,
      SEARCH: 3,
      CATALOG_SEARCH: 4
    },

    STATUS: {
      DISABLED: 2,
      ENABLED: 1
    },

    MEDIA_TYPES: {
      IMAGE: 'image',
      SMALL_IMAGE: 'small_image',
      THUMBNAIL: 'thumbnail',
      SWATCH_IMAGE: 'swatch_image'
    }
  },

  HTTP: {
    STATUS_CODES: {
      OK: 200,
      CREATED: 201,
      MULTI_STATUS: 207,
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      NOT_FOUND: 404,
      TOO_MANY_REQUESTS: 429,
      INTERNAL_ERROR: 500
    }
  },

  MIGRATION: {
    PHASES: {
      EXTRACTION: 'extraction',
      PREPARATION: 'preparation',
      CREATION: 'creation'
    }
  }
};
