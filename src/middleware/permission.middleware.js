const { AuthorizationError } = require('../utils/error-handler');

function permit(...requiredPermissions) {
  return (req, res, next) => {
    if (!req.apiKey) {
      return next();
    }

    const userPermissions = req.apiKey.permissions || [];

    if (userPermissions.includes('*')) {
      return next();
    }

    const hasPermission = requiredPermissions.every(
      perm => userPermissions.includes(perm)
    );

    if (!hasPermission) {
      return next(new AuthorizationError(
        `Required permissions: ${requiredPermissions.join(', ')}`
      ));
    }

    next();
  };
}

module.exports = permit;
