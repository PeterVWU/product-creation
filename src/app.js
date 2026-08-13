const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const logger = require('./config/logger');
const requestLogger = require('./middleware/request-logger.middleware');
const errorMiddleware = require('./middleware/error.middleware');
const routes = require('./routes');
const shopifyController = require('./controllers/shopify.controller');
const asyncHandler = require('./utils/async-handler');

const app = express();

app.use(helmet());

app.use(cors());

app.use(compression());

// HMAC verification requires the exact bytes Shopify sent.
app.post('/api/v1/shopify/webhooks/app-uninstalled', express.raw({ type: 'application/json', limit: '1mb' }), asyncHandler(shopifyController.uninstalled));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(requestLogger);

app.use('/api', routes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Route ${req.method} ${req.url} not found`
  });
});

app.use(errorMiddleware);

module.exports = app;
