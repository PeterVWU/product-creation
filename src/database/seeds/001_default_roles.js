exports.seed = async function (knex) {
  const roles = [
    {
      id: 'admin',
      description: 'Full access — manage keys, roles, prompts, run any operation',
      permissions: JSON.stringify(['*'])
    },
    {
      id: 'operator',
      description: 'Day-to-day operations — migrations, sync, prompt management',
      permissions: JSON.stringify([
        'migrate:product', 'migrate:batch', 'migrate:shopify',
        'sync:prices', 'sync:product-fields',
        'product:delete',
        'ai:prompts:read', 'ai:prompts:write',
        'audit:read'
      ])
    },
    {
      id: 'operator-readonly',
      description: 'Operations without delete — migrations, sync, prompt management',
      permissions: JSON.stringify([
        'migrate:product', 'migrate:batch', 'migrate:shopify',
        'sync:prices', 'sync:product-fields',
        'product:read',
        'ai:prompts:read', 'ai:prompts:write',
        'audit:read'
      ])
    },
    {
      id: 'viewer',
      description: 'Read-only — health, product lookup, view prompts and audit',
      permissions: JSON.stringify([
        'health:read', 'product:read',
        'ai:prompts:read', 'audit:read'
      ])
    }
  ];

  for (const role of roles) {
    await knex.raw(
      `INSERT INTO roles (id, description, permissions)
       VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         description = EXCLUDED.description,
         permissions = EXCLUDED.permissions`,
      [role.id, role.description, role.permissions]
    );
  }
};
