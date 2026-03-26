const auditLogRepo = require('../../database/repositories/audit-log.repository');
const logger = require('../../config/logger');

module.exports = {
  async logAction({ apiKeyId, action, resourceType, resourceId, metadata, status, durationMs }) {
    try {
      return await auditLogRepo.create({
        apiKeyId,
        action,
        resourceType,
        resourceId,
        metadata,
        status,
        durationMs
      });
    } catch (error) {
      // Audit failures must never break business operations
      logger.error('Failed to write audit log', {
        error: error.message,
        action,
        resourceType,
        resourceId
      });
      return null;
    }
  }
};
