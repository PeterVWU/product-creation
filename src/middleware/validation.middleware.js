const { validationResult } = require('express-validator');
const { ValidationError } = require('../utils/error-handler');

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const fields = errors.array().map(err => ({
      field: err.path || err.param,
      message: err.msg,
      value: err.value
    }));

    throw new ValidationError('Request validation failed', fields);
  }

  next();
};

module.exports = { validateRequest };
