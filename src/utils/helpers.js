const buildMagentoSearchCriteria = (filters) => {
  const searchCriteria = {
    searchCriteria: {
      filterGroups: []
    }
  };

  filters.forEach((filter, index) => {
    searchCriteria.searchCriteria.filterGroups.push({
      filters: [
        {
          field: filter.field,
          value: filter.value,
          conditionType: filter.conditionType || 'eq'
        }
      ]
    });
  });

  return searchCriteria;
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const chunkArray = (array, size) => {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

const sanitizeSku = (sku) => {
  return sku ? sku.trim().toUpperCase() : '';
};

const buildProductPayload = (productData, options = {}) => {
  const payload = {
    product: {
      sku: productData.sku,
      name: productData.name,
      attribute_set_id: productData.attribute_set_id,
      price: productData.price,
      status: productData.status,
      visibility: productData.visibility,
      type_id: productData.type_id,
      weight: productData.weight || 0
    }
  };

  if (productData.custom_attributes && productData.custom_attributes.length > 0) {
    payload.product.custom_attributes = productData.custom_attributes;
  }

  if (productData.extension_attributes) {
    payload.product.extension_attributes = productData.extension_attributes;
  }

  return payload;
};

const extractErrorMessage = (error) => {
  if (error.response && error.response.data) {
    if (error.response.data.message) {
      return error.response.data.message;
    }
    if (typeof error.response.data === 'string') {
      return error.response.data;
    }
  }
  return error.message || 'Unknown error occurred';
};

module.exports = {
  buildMagentoSearchCriteria,
  delay,
  chunkArray,
  sanitizeSku,
  buildProductPayload,
  extractErrorMessage
};
