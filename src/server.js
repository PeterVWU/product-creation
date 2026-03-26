const app = require('./app');
const config = require('./config');
const logger = require('./config/logger');
const db = require('./database/connection');

const PORT = config.server.port;

const startServer = async () => {
  try {
    logger.info('Running database migrations...');
    await db.migrate.latest();
    logger.info('Database migrations complete');

    logger.info('Running database seeds...');
    await db.seed.run();
    logger.info('Database seeds complete');
  } catch (error) {
    logger.error('Database initialization failed', { error: error.message });
    process.exit(1);
  }

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

    server.close(async () => {
      logger.info('Server closed');
      await db.destroy();
      logger.info('Database connections closed');
      process.exit(0);
    });

    setTimeout(async () => {
      logger.error('Forced shutdown after timeout');
      try { await db.destroy(); } catch (e) { /* ignore */ }
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return server;
};

startServer();

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason, promise });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});
