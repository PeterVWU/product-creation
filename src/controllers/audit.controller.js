const auditLogRepo = require('../database/repositories/audit-log.repository');

const queryAuditLogs = async (req, res, next) => {
  try {
    const { action, api_key_id, start_date, end_date, limit, offset } = req.query;
    const results = await auditLogRepo.query({
      action,
      apiKeyId: api_key_id,
      startDate: start_date,
      endDate: end_date,
      limit: limit ? Math.min(parseInt(limit, 10), 1000) : 50,
      offset: offset ? parseInt(offset, 10) : 0
    });
    res.json({ success: true, ...results });
  } catch (error) {
    next(error);
  }
};

module.exports = { queryAuditLogs };
