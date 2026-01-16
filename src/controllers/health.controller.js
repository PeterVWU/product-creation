const logger = require('../config/logger');
const OrchestratorService = require('../services/migration/orchestrator.service');

const orchestrator = new OrchestratorService();

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

module.exports = {
  healthCheck,
  magentoHealthCheck
};
