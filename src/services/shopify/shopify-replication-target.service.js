const axios = require('axios');

class ShopifyReplicationTarget {
  constructor(client) { this.client = client; }

  async createShell(product, handle, fields, status) {
    const result = await this.client.query(`mutation ReplicationCreate($product: ProductCreateInput!) {
      productCreate(product: $product) { product { id } userErrors { field message } }
    }`, { product: {
      ...fields, handle, status,
      productOptions: product.options.map(option => ({
        name: option.name, position: option.position,
        // Shopify creates a first variant from the first option values. Choose
        // an actual source combination so sparse option matrices gain no extra variant.
        values: [...new Set([
          product.variants[0].selectedOptions.find(value => value.name === option.name)?.value,
          ...option.values
        ].filter(value => value !== undefined))].map(name => ({ name }))
      }))
    } });
    return result.data.productCreate.product.id;
  }

  async content(id, fields) {
    await this.client.query(`mutation ReplicationContent($product: ProductUpdateInput!) {
      productUpdate(product: $product) { product { id } userErrors { field message } }
    }`, { product: { id, ...fields } });
  }

  async files(id, files) {
    await this.client.query(`mutation ReplicationFiles($input: ProductSetInput!, $identifier: ProductSetIdentifiers!) {
      productSet(input: $input, identifier: $identifier, synchronous: true) {
        product { id } userErrors { field message }
      }
    }`, { identifier: { id }, input: { files: files.map(file => ({ id: file.id, alt: file.alt || '' })) } });
  }

  async variants(id, variants, create = false) {
    const operation = create ? 'productVariantsBulkCreate' : 'productVariantsBulkUpdate';
    const strategy = create ? ', strategy: PRESERVE_STANDALONE_VARIANT' : '';
    for (let i = 0; i < variants.length; i += 100) {
      await this.client.query(`mutation ReplicationVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        ${operation}(productId: $productId, variants: $variants${strategy}) {
          productVariants { id } userErrors { field message }
        }
      }`, { productId: id, variants: variants.slice(i, i + 100) });
    }
  }

  async detachMedia(id, variantMedia) {
    for (let i = 0; i < variantMedia.length; i += 100) {
      await this.client.query(`mutation ReplicationDetachMedia($productId: ID!, $variantMedia: [ProductVariantDetachMediaInput!]!) {
        productVariantDetachMedia(productId: $productId, variantMedia: $variantMedia) {
          product { id } userErrors { field message }
        }
      }`, { productId: id, variantMedia: variantMedia.slice(i, i + 100) });
    }
  }

  async upload(image) {
    const files = await this.client.uploadAndWaitForFiles([{ url: image.image.url, alt: image.alt || '' }], async url => {
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
      return Buffer.from(response.data);
    });
    if (!files[0]) throw new Error(`Image upload failed for ${image.id}`);
    return files[0];
  }
}
module.exports = ShopifyReplicationTarget;
