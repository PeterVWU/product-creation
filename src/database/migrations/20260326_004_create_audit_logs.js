exports.up = function (knex) {
  return knex.schema.createTable('audit_logs', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.uuid('api_key_id').nullable()
      .references('id').inTable('api_keys').onDelete('SET NULL');
    table.string('action', 100).notNullable();
    table.string('resource_type', 50);
    table.string('resource_id', 255);
    table.jsonb('metadata').defaultTo('{}');
    table.string('status', 20).notNullable();
    table.integer('duration_ms');
    table.timestamp('created_at').defaultTo(knex.fn.now());

    table.index('action');
    table.index('created_at');
    table.index('api_key_id');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('audit_logs');
};
