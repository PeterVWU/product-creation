const app = require('./app');
const config = require('./config');
const logger = require('./config/logger');

const PORT = config.server.port;

const server = app.listen(PORT, () => {
  logger.info(`Server started successfully`, {
    port: PORT,
    environment: config.server.env,
    sourceUrl: config.source.baseUrl,
    magentoStores: Object.keys(config.magentoStores)
  });

  logger.info(`API Documentation: http://localhost:${PORT}/api`);
  logger.info(`Health Check: http://localhost:${PORT}/api/v1/health`);
  logger.info(`Magento Health: http://localhost:${PORT}/api/v1/health/magento`);
});

const gracefulShutdown = (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

module.exports = server;
