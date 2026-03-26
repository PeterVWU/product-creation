const apiKeyRepo = require('../database/repositories/api-key.repository');
const roleRepo = require('../database/repositories/role.repository');
const { generateApiKey, hashSecret } = require('../utils/api-key.utils');
const { ValidationError } = require('../utils/error-handler');

const createKey = async (req, res, next) => {
  try {
    const { name, role } = req.body;
    if (!name || !role) {
      throw new ValidationError('name and role are required');
    }
    const roleExists = await roleRepo.findById(role);
    if (!roleExists) {
      throw new ValidationError(`Role '${role}' does not exist`);
    }
    const { rawKey, prefix, secret } = generateApiKey();
    const keyHash = await hashSecret(secret);
    const record = await apiKeyRepo.create({
      name,
      keyPrefix: prefix,
      keyHash,
      roleId: role
    });
    res.status(201).json({
      success: true,
      data: {
        id: record.id,
        name: record.name,
        role: record.role_id,
        key: rawKey
      }
    });
  } catch (error) {
    next(error);
  }
};

const listKeys = async (req, res, next) => {
  try {
    const keys = await apiKeyRepo.findAll();
    res.json({ success: true, data: keys });
  } catch (error) {
    next(error);
  }
};

const updateKey = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.role !== undefined) {
      const roleExists = await roleRepo.findById(req.body.role);
      if (!roleExists) {
        throw new ValidationError(`Role '${req.body.role}' does not exist`);
      }
      updates.role_id = req.body.role;
    }
    if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;
    const updated = await apiKeyRepo.update(id, updates);
    if (!updated) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

const deactivateKey = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await apiKeyRepo.update(id, { is_active: false });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'API key not found' });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

module.exports = { createKey, listKeys, updateKey, deactivateKey };
