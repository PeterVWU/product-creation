exports.up = function (knex) {
  return knex.schema.createTable('roles', (table) => {
    table.string('id', 50).primary();
    table.string('description', 255);
    table.jsonb('permissions').notNullable().defaultTo('[]');
    table.timestamp('created_at').defaultTo(knex.fn.now());
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('roles');
};
