const PRODUCT_FIELDS = `id title handle descriptionHtml vendor productType tags status
  seo { title description }
  options { name position values }`;
const VARIANT_FIELDS = `id sku price compareAtPrice barcode taxable inventoryPolicy
  selectedOptions { name value }
  inventoryItem { measurement { weight { value unit } } }
  media(first: 1) { nodes { id } }`;

class ShopifyProductSource {
  constructor(client) { this.client = client; }

  async shop() {
    const result = await this.client.query(`query ReplicationShop {
      shop { id myshopifyDomain primaryDomain { url } }
    }`);
    return result.data.shop;
  }

  async product(id) {
    const result = await this.client.query(`query ReplicationProduct($id: ID!) {
      product(id: $id) { ${PRODUCT_FIELDS} }
    }`, { id });
    if (!result.data.product) return null;
    const product = result.data.product;
    product.variants = await this.pages('variants', id, VARIANT_FIELDS);
    const media = await this.pages('media', id, `id mediaContentType alt ... on MediaImage { image { url } }`);
    product.images = media.filter(item => item.mediaContentType === 'IMAGE' && item.image?.url);
    return product;
  }

  async pages(field, id, fields) {
    const nodes = [];
    let after = null;
    do {
      const result = await this.client.query(`query ReplicationPage($id: ID!, $after: String) {
        product(id: $id) { ${field}(first: 100, after: $after) {
          nodes { ${fields} } pageInfo { hasNextPage endCursor }
        } }
      }`, { id, after });
      const page = result.data.product?.[field];
      if (!page) throw new Error(`Product disappeared while reading ${field}`);
      nodes.push(...page.nodes);
      if (!page.pageInfo.hasNextPage) break;
      if (!page.pageInfo.endCursor || page.pageInfo.endCursor === after) throw new Error('Invalid pagination cursor');
      after = page.pageInfo.endCursor;
    } while (true);
    return nodes;
  }

  async byHandle(handle) {
    const result = await this.client.query(`query ReplicationHandle($handle: String!) {
      productByIdentifier(identifier: {handle: $handle}) { id }
    }`, { handle });
    return result.data.productByIdentifier?.id || null;
  }

  async bySkus(skus) {
    const matches = [];
    // Escape Shopify search syntax and check exact SKUs after search.
    for (let i = 0; i < skus.length; i += 25) {
      const wanted = skus.slice(i, i + 25);
      const query = wanted.map(sku => `sku:"${sku.replace(/([\\":()])/g, '\\$1')}"`).join(' OR ');
      let after = null;
      do {
        const result = await this.client.query(`query ReplicationSku($query: String!, $after: String) {
          productVariants(first: 100, query: $query, after: $after) {
            nodes { id sku product { id } } pageInfo { hasNextPage endCursor }
          }
        }`, { query, after });
        const page = result.data.productVariants;
        matches.push(...page.nodes.filter(variant => wanted.includes(variant.sku)));
        if (!page.pageInfo.hasNextPage) break;
        if (!page.pageInfo.endCursor || page.pageInfo.endCursor === after) throw new Error('Invalid SKU pagination cursor');
        after = page.pageInfo.endCursor;
      } while (true);
    }
    return matches;
  }
}
module.exports = ShopifyProductSource;
