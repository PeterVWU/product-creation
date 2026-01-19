const logger = require('../config/logger');
const OrchestratorService = require('../services/migration/orchestrator.service');
const ShopifyOrchestratorService = require('../services/migration/shopify-orchestrator.service');

const orchestrator = new OrchestratorService();
const shopifyOrchestrator = new ShopifyOrchestratorService();

const healthCheck = async (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
};

const magentoHealthCheck = async (req, res, next) => {
  try {
    logger.info('Testing Magento connections');

    const connections = await orchestrator.testConnections();

    const allConnected = connections.source.connected && connections.target.connected;

    res.status(allConnected ? 200 : 503).json({
      status: allConnected ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      connections: {
        source: {
          connected: connections.source.connected,
          url: connections.source.baseUrl,
          error: connections.source.error || null
        },
        target: {
          connected: connections.target.connected,
          url: connections.target.baseUrl,
          error: connections.target.error || null
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

const shopifyHealthCheck = async (req, res, next) => {
  try {
    const storeName = req.query.store || null;

    logger.info('Testing Shopify connection', { storeName });

    const connection = await shopifyOrchestrator.testShopifyConnection(storeName);

    res.status(connection.connected ? 200 : 503).json({
      status: connection.connected ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      connection: {
        connected: connection.connected,
        shopDomain: connection.shopDomain,
        shopName: connection.shopName || null,
        shopUrl: connection.shopUrl || null,
        error: connection.error || null
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  healthCheck,
  magentoHealthCheck,
  shopifyHealthCheck
};
