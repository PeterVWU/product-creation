const ShopifyReplicationService = require('../services/migration/shopify-replication.service');
const audit = require('../services/audit/audit.service');
const service = new ShopifyReplicationService();

module.exports = operation => async (req, res) => {
  const start = Date.now();
  let result;
  try {
    result = await service.run(req.body.sourceProductId, req.body.options, operation);
  } catch (error) {
    await audit.logAction({ apiKeyId: req.apiKey?.id, action: `product:shopify_replication_${operation}`,
      resourceType: 'product', resourceId: String(req.body.sourceProductId), status: 'failure',
      metadata: { sourceStore: 'vapordna', targetShopifyStores: req.body.options?.targetShopifyStores, error: error.message },
      durationMs: Date.now() - start });
    if (error.statusCode === 404) return res.status(404).json({ success: false, error: 'Not Found', message: error.message });
    throw error;
  }
  await audit.logAction({ apiKeyId: req.apiKey?.id, action: `product:shopify_replication_${operation}`,
    resourceType: 'product', resourceId: result.sourceProductId,
    metadata: { sourceStore: 'vapordna', operation, results: result.results },
    status: result.success ? 'success' : 'partial', durationMs: Date.now() - start });
  res.status(result.success ? 200 : 207).json(result);
};
