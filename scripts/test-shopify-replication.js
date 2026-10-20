/** Live ECOM-327 verification. Source is read-only; destination is pinned to the test shop. */
require('dotenv').config();
process.env.GOOGLE_CHAT_ENABLED = 'false';
process.env.SLACK_ENABLED = 'false';
process.env.AUTH_ENABLED = 'true';
const assert = require('node:assert/strict');
const db = require('../src/database/connection');
const registry = require('../src/services/shopify/shopify-store-registry.service');
const Source = require('../src/services/shopify/shopify-product-source.service');
const { generateApiKey, hashSecret } = require('../src/utils/api-key.utils');
const keyRepo = require('../src/database/repositories/api-key.repository');

const partialDestination = process.argv.includes('--partial-destination');
const injectFailure = process.argv.includes('--inject-failure');
const ids = process.argv.slice(2).filter(arg => !['--inject-failure', '--partial-destination'].includes(arg));
let failureInjected = false;
const expectedShop = 'vwu-test-store.myshopify.com';
let server, keyRow;
const checks = [];
const record = name => { checks.push(name); console.log(`PASS ${name}`); };

async function main() {
  assert(ids.length, 'Pass one or more VaporDNA product GIDs (include single-variant, multi-variant and image-bearing products)');
  assert(process.env.DB_NAME && /test|ecom327/i.test(process.env.DB_NAME), 'Use an explicitly configured, dedicated test database');
  await db.migrate.latest(); await db.seed.run();
  const getClient = registry.getTargetService.bind(registry);
  // Every client used by the app is guarded, including newly resolved clients.
  registry.getTargetService = async alias => {
    assert(['test', 'vapordna'].includes(alias), 'Live harness only permits VaporDNA reads and test-store writes');
    const client = await getClient(alias);
    const query = client.query.bind(client);
    const identity = await query('{ shop { id myshopifyDomain } }');
    if (alias === 'test') assert.equal(identity.data.shop.myshopifyDomain, expectedShop);
    client.query = async (document, variables) => {
      if (/\bmutation\b/.test(document)) assert.equal(alias, 'test', 'Production source is strictly read-only');
      if (injectFailure && !failureInjected && alias === 'test' && document.includes('ReplicationVariants') && document.includes('productVariantsBulkCreate')) {
        failureInjected = true;
        throw new Error('ECOM-327 injected interruption before missing-variant creation');
      }
      return query(document, variables);
    };
    return client;
  };
  const source = new Source(await registry.getTargetService('vapordna'));
  const client = await registry.getTargetService('test');
  const target = new Source(client);
  const sourceIdentity = await source.shop();
  const targetIdentity = await target.shop();
  assert.notEqual(sourceIdentity.id, targetIdentity.id);
  const key = generateApiKey();
  keyRow = await keyRepo.create({ name: 'ECOM-327 live verification', keyPrefix: key.prefix,
    keyHash: await hashSecret(key.secret), roleId: 'operator' });
  const app = require('../src/app');
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const request = async (operation, sourceProductId, options = {}) => {
    const path = { create: '/migrate/product/shopify-to-shopify', content: '/sync/product-fields/shopify-to-shopify', prices: '/sync/prices/shopify-to-shopify' }[operation];
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': key.rawKey },
      body: JSON.stringify({ sourceProductId, options: { targetShopifyStores: ['test'], ...options } }) });
    return { status: response.status, body: await response.json() };
  };
  const { rewriteStoreReferences } = require('../src/services/migration/shopify-replication.service');
  for (const id of ids) {
    const product = await source.product(id);
    assert(product, 'Source exists');
    const before = JSON.stringify(product);
    const priorMapping = await db('shopify_product_mappings').where({ source_shop: sourceIdentity.myshopifyDomain,
      source_product_id: product.id, target_shop: targetIdentity.myshopifyDomain }).first();
    if (priorMapping?.target_product_id) assert(priorMapping.created_by_migration, 'Refusing to mutate an adopted destination listing');
    else assert.equal((await target.bySkus(product.variants.map(variant => variant.sku))).length, 0,
      'Use a source product absent from the test destination');
    if (partialDestination && !priorMapping?.target_product_id) {
      assert(product.variants.length > 1, 'Partial-destination fixture requires multiple source variants');
      const Target = require('../src/services/shopify/shopify-replication-target.service');
      const Service = require('../src/services/migration/shopify-replication.service');
      const mappings = require('../src/database/repositories/shopify-product-mapping.repository');
      const { createHash } = require('node:crypto');
      const writer = new Target(client), builder = new Service();
      const key = { source_shop: sourceIdentity.myshopifyDomain, source_product_id: product.id, target_shop: targetIdentity.myshopifyDomain };
      const handle = `migration-${createHash('sha256').update(`${key.source_shop}:${product.id}`).digest('hex').slice(0, 32)}`;
      await mappings.withMapping(key, handle, async (row, save) => {
        const fixtureId = await writer.createShell(product, handle, builder.fields(product, targetIdentity), 'DRAFT');
        await save({ target_product_id: fixtureId, created_by_migration: true });
        const fixture = await target.product(fixtureId);
        const laterImageIds = new Set(product.variants.slice(1).flatMap(v => v.media.nodes.map(media => media.id)));
        // Set up an existing destination with only its first variant and images.
        // No destination variant is deleted to create this scenario.
        const initialImages = product.images.filter(image => !laterImageIds.has(image.id));
        const images = {};
        for (const image of initialImages) images[image.id] = { ...await writer.upload(image), url: image.image.url };
        await save({ images });
        await writer.files(fixtureId, Object.values(images));
        await writer.variants(fixtureId, [{ id: fixture.variants[0].id, ...builder.variantInput(product.variants[0], images, true) }]);
        await writer.content(fixtureId, { handle: product.handle });
        await save({ initialized: true, variants: { [product.variants[0].id]: fixture.variants[0].id } });
      });
      record(`${id}: prepared destination fixture with one variant and initial images, without deleting variants`);
    }
    let result = await request('create', id);
    if (failureInjected && result.status === 207) {
      assert.match(result.body.results.test.error, /injected interruption/);
      const failedProductId = result.body.results.test.productId;
      assert(failedProductId, 'Successful product creation must be checkpointed');
      result = await request('create', id);
      assert.equal(result.body.results.test.productId, failedProductId, 'Retry must reuse the partially created product');
      record(`${id}: partial creation failure recovered by adding missing variants to the same product`);
    }
    assert.equal(result.status, 200, JSON.stringify(result.body));
    const targetId = result.body.results.test.productId;
    if (partialDestination && !priorMapping?.target_product_id) {
      assert.equal(result.body.results.test.variantsCreated, product.variants.length - 1);
      record(`${id}: missing variants and their images added to a partially populated listing`);
    }
    const mapping = await db('shopify_product_mappings').where({ source_shop: sourceIdentity.myshopifyDomain,
      source_product_id: product.id, target_shop: targetIdentity.myshopifyDomain }).first();
    // Existing adopted listings are only read by this harness; mutation fixtures must be our own clones.
    assert(mapping.created_by_migration, 'Use source products absent from destination (or previously created by this feature)');
    let copied = await target.product(targetId);
    const originalStatus = copied.status;
    if (result.body.results.test.mode === 'created') {
      assert.equal(copied.status, 'DRAFT');
      assert.equal(copied.handle, product.handle);
    }
    assert(copied.variants.length >= product.variants.length);
    assert.equal(copied.title, product.title);
    assert.equal(copied.images.length, product.images.length);
    record(`${id}: create/copy all variants and images`);

    // Change destination content and SKU, then ensure explicit updates restore from master using stored IDs.
    await client.query(`mutation FixtureContent($product: ProductUpdateInput!) {
      productUpdate(product: $product) { product { id } userErrors { field message } }
    }`, { product: { id: targetId, title: 'ECOM-327 temporary destination edit' } });
    await client.query(`mutation FixtureVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) { productVariants { id } userErrors { field message } }
    }`, { productId: targetId, variants: [{ id: copied.variants[0].id, price: '0.99', compareAtPrice: '1.99',
      inventoryItem: { sku: `ECOM327-${Date.now()}` } }] });
    const inventoryBefore = await client.query(`query Stock($id: ID!) { product(id: $id) { variants(first: 100) { nodes { id inventoryQuantity inventoryItem { tracked } } } } }`, { id: targetId });
    result = await request('content', id);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    copied = await target.product(targetId);
    assert.equal(copied.title, product.title);
    assert.equal(copied.descriptionHtml, rewriteStoreReferences(product.descriptionHtml, targetIdentity.primaryDomain.url, targetIdentity.name, true));
    assert.equal(copied.status, originalStatus);
    assert.equal(copied.images.length, product.images.length);
    assert.equal(copied.variants[0].sku, product.variants[0].sku);
    assert.equal(copied.variants[0].price, '0.99', 'Content update must not change prices');
    assert.equal(copied.vendor, product.vendor);
    assert.equal(copied.productType, product.productType);
    assert.deepEqual([...copied.tags].sort(), [...product.tags].sort());
    assert.equal(copied.seo.title, product.seo.title);
    assert.equal(copied.seo.description, rewriteStoreReferences(product.seo.description, targetIdentity.primaryDomain.url, targetIdentity.name) || null);
    for (const variant of product.variants) {
      const dest = copied.variants.find(v => v.id === mapping.variants[variant.id]);
      const expectedImage = mapping.images[variant.media.nodes[0]?.id]?.id;
      if (expectedImage) assert.equal(dest.media.nodes[0]?.id, expectedImage);
    }
    const inventoryAfter = await client.query(`query Stock($id: ID!) { product(id: $id) { variants(first: 100) { nodes { id inventoryQuantity inventoryItem { tracked } } } } }`, { id: targetId });
    assert.deepEqual(inventoryAfter.data, inventoryBefore.data);
    record(`${id}: content, domain, SEO, SKU mappings, media associations, status and stock preservation`);

    result = await request('prices', id);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    copied = await target.product(targetId);
    for (const variant of product.variants) {
      const dest = copied.variants.find(v => v.id === mapping.variants[variant.id]);
      assert.equal(dest.price, variant.price);
      assert.equal(dest.compareAtPrice, variant.compareAtPrice);
    }
    record(`${id}: price and compare-at sync`);
    result = await request('create', id);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.results.test.productId, targetId);
    assert.equal(result.body.results.test.variantsCreated, 0);
    record(`${id}: retry without duplicate products/variants`);
    // Add a destination-only variant, then exercise every operation to prove it survives.
    const extraSku = `ECOM327-EXTRA-${product.id.split('/').pop()}`;
    let extra = copied.variants.find(v => v.sku === extraSku);
    if (!extra) {
      const optionValues = product.variants[0].selectedOptions.map((option, index) => ({
        optionName: option.name, name: index === 0 ? 'ECOM-327 destination only' : option.value
      }));
      const created = await client.query(`mutation FixtureExtra($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: PRESERVE_STANDALONE_VARIANT) {
          productVariants { id sku } userErrors { field message }
        }
      }`, { productId: targetId, variants: [{ optionValues, price: '77.00', inventoryItem: { sku: extraSku, tracked: true } }] });
      extra = created.data.productVariantsBulkCreate.productVariants[0];
    }
    const idsBefore = (await target.product(targetId)).variants.map(v => v.id).sort();
    for (const operation of ['create', 'content', 'prices']) {
      const outcome = await request(operation, id);
      assert.equal(outcome.status, 200, JSON.stringify(outcome.body));
      assert.deepEqual((await target.product(targetId)).variants.map(v => v.id).sort(), idsBefore);
    }
    assert.equal((await target.product(targetId)).variants.find(v => v.id === extra.id).price, '77.00');
    record(`${id}: destination-only variant survives creation, content update and price sync`);
    const partial = await request('create', id, { targetShopifyStores: ['test', 'not-a-configured-store'] });
    assert.equal(partial.status, 207);
    assert.equal(partial.body.results.test.success, true);
    assert.equal(partial.body.results['not-a-configured-store'].success, false);
    const sameShop = await request('create', id, { targetShopifyStores: ['vapordna'] });
    assert.equal(sameShop.status, 207);
    assert.match(sameShop.body.results.vapordna.error, /different Shopify stores/);
    record(`${id}: per-store partial failures and same-shop rejection`);

    assert.equal(JSON.stringify(await source.product(id)), before, 'Source listing must remain unchanged');
    console.log(`Destination: https://admin.shopify.com/store/vwu-test-store/products/${targetId.split('/').pop()}`);
  }
  if (injectFailure) assert(failureInjected, 'Provide a fresh multi-variant source product to exercise interrupted creation');
  const logs = await db('audit_logs').where({ api_key_id: keyRow.id });
  assert(logs.some(log => log.action === 'product:shopify_replication_create'));
  assert(logs.some(log => log.action === 'product:shopify_replication_content'));
  assert(logs.some(log => log.action === 'product:shopify_replication_prices'));
  record('API authentication, routing and persistent audit records');
  console.log(JSON.stringify({ success: true, destination: expectedShop, checks }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (keyRow) await db('api_keys').where({ id: keyRow.id }).del();
  await db.destroy();
});
