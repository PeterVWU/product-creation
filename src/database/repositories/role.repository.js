const db = require('../connection');

const TABLE = 'roles';

module.exports = {
  async findById(id) {
    const role = await db(TABLE).where({ id }).first();
    if (!role) return null;
    role.permissions = typeof role.permissions === 'string'
      ? JSON.parse(role.permissions)
      : role.permissions;
    return role;
  },

  async findAll() {
    const roles = await db(TABLE).select('*');
    return roles.map(role => ({
      ...role,
      permissions: typeof role.permissions === 'string'
        ? JSON.parse(role.permissions)
        : role.permissions
    }));
  }
};
