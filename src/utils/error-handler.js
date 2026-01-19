class MagentoAPIError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = 'MagentoAPIError';
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ExtractionError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ExtractionError';
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

class PreparationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'PreparationError';
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

class CreationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'CreationError';
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends Error {
  constructor(message, fields = []) {
    super(message);
    this.name = 'ValidationError';
    this.fields = fields;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ImageProcessingError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'ImageProcessingError';
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ShopifyAPIError extends Error {
  constructor(message, statusCode = 500, details = null) {
    super(message);
    this.name = 'ShopifyAPIError';
    this.statusCode = statusCode;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = {
  MagentoAPIError,
  ExtractionError,
  PreparationError,
  CreationError,
  ValidationError,
  ImageProcessingError,
  ShopifyAPIError
};
