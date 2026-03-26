const logger = require('../config/logger');
const { sanitizeLogPayload } = require('../utils/helpers');
const {
  MagentoAPIError,
  ValidationError,
  ExtractionError,
  PreparationError,
  CreationError,
  ImageProcessingError,
  DescriptionGenerationError,
  AuthenticationError,
  AuthorizationError
} = require('../utils/error-handler');

const errorMiddleware = (err, req, res, next) => {
  logger.error('Error occurred', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    body: sanitizeLogPayload(req.body)
  });

  if (err instanceof ValidationError) {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      message: err.message,
      fields: err.fields
    });
  }

  if (err instanceof MagentoAPIError) {
    return res.status(err.statusCode || 500).json({
      success: false,
      error: 'Magento API Error',
      message: err.message,
      details: process.env.NODE_ENV === 'development' ? err.details : undefined
    });
  }

  if (err instanceof ExtractionError ||
      err instanceof PreparationError ||
      err instanceof CreationError ||
      err instanceof ImageProcessingError) {
    return res.status(500).json({
      success: false,
      error: err.name,
      message: err.message,
      details: process.env.NODE_ENV === 'development' ? err.details : undefined
    });
  }

  if (err instanceof DescriptionGenerationError) {
    return res.status(err.statusCode || 500).json({
      success: false,
      error: {
        code: err.code,
        message: err.message
      },
      details: process.env.NODE_ENV === 'development' ? err.details : undefined
    });
  }

  if (err instanceof AuthenticationError) {
    return res.status(401).json({
      success: false,
      error: 'Authentication Error',
      message: err.message
    });
  }

  if (err instanceof AuthorizationError) {
    return res.status(403).json({
      success: false,
      error: 'Authorization Error',
      message: err.message
    });
  }

  return res.status(500).json({
    success: false,
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development'
      ? err.message
      : 'An unexpected error occurred'
  });
};

module.exports = errorMiddleware;
