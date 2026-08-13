exports.up = async function (knex) {
  await knex.schema.createTable('shopify_stores', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('alias', 64).notNullable().unique();
    table.string('shop_domain', 255).notNullable().unique();
    table.string('status', 40).notNullable().defaultTo('pending');
    table.specificType('scopes', 'text[]').notNullable().defaultTo('{}');
    table.jsonb('access_token_envelope');
    table.jsonb('refresh_token_envelope');
    table.timestamp('access_token_expires_at');
    table.timestamp('refresh_token_expires_at');
    table.timestamp('verified_at');
    table.timestamp('uninstalled_at');
    table.text('last_error');
    table.timestamps(true, true);
    table.index(['status', 'access_token_expires_at']);
  });

  await knex.schema.createTable('shopify_oauth_attempts', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('alias', 64).notNullable();
    table.string('shop_domain', 255).notNullable();
    table.string('ticket_hash', 64).notNullable().unique();
    table.string('state_hash', 64).unique();
    table.uuid('api_key_id').nullable().references('id').inTable('api_keys').onDelete('SET NULL');
    table.timestamp('expires_at').notNullable();
    table.timestamp('started_at');
    table.timestamp('used_at');
    table.timestamps(true, true);
    table.index('expires_at');
  });

  await knex.schema.createTable('shopify_uninstall_webhooks', (table) => {
    table.string('webhook_id', 255).primary();
    table.string('shop_domain', 255).notNullable();
    table.timestamp('processed_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('shopify_uninstall_webhooks');
  await knex.schema.dropTableIfExists('shopify_oauth_attempts');
  await knex.schema.dropTableIfExists('shopify_stores');
};
