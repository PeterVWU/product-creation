jest.mock('../../src/services/migration/shopify-replication.service');
jest.mock('../../src/controllers/migration.controller', () => ({ migrateProduct: jest.fn(), migrateProductsBatch: jest.fn(), migrateProductToShopify: jest.fn() }));
jest.mock('../../src/controllers/sync.controller', () => ({ syncPrices: jest.fn(), updateProductFields: jest.fn() }));
const express = require('express');
const config = require('../../src/config');
const db = require('../../src/database/connection');
const Service = require('../../src/services/migration/shopify-replication.service');
const { generateApiKey, hashSecret } = require('../../src/utils/api-key.utils');
const keyRepo = require('../../src/database/repositories/api-key.repository');
const app = express();
app.use(express.json());
app.use('/migrate', require('../../src/routes/v1/migration.routes'));
app.use('/sync', require('../../src/routes/v1/sync.routes'));
app.use(require('../../src/middleware/error.middleware'));
const serviceInstance = Service.mock.instances[0];
let server, base, operator, viewer;
const createdKeys = [];
const paths = [
  ['/migrate/product/shopify-to-shopify', 'create'],
  ['/sync/product-fields/shopify-to-shopify', 'content'],
  ['/sync/prices/shopify-to-shopify', 'prices']
];
const body = { sourceProductId: '123', options: { targetShopifyStores: ['test'] } };
async function request(path, payload = body, key = operator) {
  return fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'X-API-Key': key } : {}) }, body: JSON.stringify(payload) });
}
beforeAll(async () => {
  config.auth.enabled = true;
  await db.migrate.latest(); await db.seed.run();
  for (const role of ['operator', 'viewer']) {
    const key = generateApiKey();
    const row = await keyRepo.create({ name: 'replication-route-test', keyPrefix: key.prefix, keyHash: await hashSecret(key.secret), roleId: role });
    createdKeys.push(row.id);
    if (role === 'operator') operator = key.rawKey; else viewer = key.rawKey;
  }
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await db('api_keys').whereIn('id', createdKeys).del();
  await db.destroy();
});
beforeEach(() => { serviceInstance.run.mockResolvedValue({ success: true, sourceProductId: 'gid://shopify/Product/123', results: { test: { success: true } } }); });

test.each(paths)('%s enforces authentication and permissions before invoking migration', async path => {
  expect((await request(path, body, null)).status).toBe(401);
  expect((await request(path, body, viewer)).status).toBe(403);
  expect(serviceInstance.run).not.toHaveBeenCalled();
});

test.each(paths)('%s invokes the intended operation and records an audit log', async (path, operation) => {
  expect((await request(path)).status).toBe(200);
  expect(serviceInstance.run).toHaveBeenCalledWith('123', body.options, operation);
  const record = await db('audit_logs').where({ action: `product:shopify_replication_${operation}`, resource_id: 'gid://shopify/Product/123' }).first();
  expect(record.status).toBe('success');
});

test.each([
  { sourceProductId: 'bad', options: body.options },
  { sourceProductId: '123', options: {} },
  { ...body, options: { ...body.options, includeImages: 'false' } },
  { ...body, options: { ...body.options, productStatus: 'published' } }
])('rejects malformed request before invoking migration', async payload => {
  expect((await request(paths[0][0], payload)).status).toBe(400);
  expect(serviceInstance.run).not.toHaveBeenCalled();
});

test('returns per-destination partial failures with HTTP 207 and audit evidence', async () => {
  serviceInstance.run.mockResolvedValue({ success: false, sourceProductId: 'gid://shopify/Product/123', results: { test: { success: false, error: 'Unavailable' } } });
  const response = await request(paths[0][0]);
  expect(response.status).toBe(207);
  expect(await response.json()).toMatchObject({ results: { test: { success: false } } });
});

test('returns a useful 404 when the source product is absent and records failure', async () => {
  serviceInstance.run.mockRejectedValueOnce(Object.assign(new Error('Source product not found in VaporDNA'), { statusCode: 404 }));
  const response = await request(paths[0][0]);
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ message: 'Source product not found in VaporDNA' });
  const audit = await db('audit_logs').where({ action: 'product:shopify_replication_create', status: 'failure', resource_id: '123' }).first();
  expect(audit).toBeTruthy();
});

test('exposes source validation errors as HTTP 400', async () => {
  const { ValidationError } = require('../../src/utils/error-handler');
  serviceInstance.run.mockRejectedValueOnce(new ValidationError('Source variants must have non-empty, unique SKUs'));
  const response = await request(paths[0][0]);
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ message: 'Source variants must have non-empty, unique SKUs' });
});
