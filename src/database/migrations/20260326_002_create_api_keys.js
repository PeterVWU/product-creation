exports.up = function (knex) {
  return knex.schema.createTable('api_keys', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('name', 100).notNullable();
    table.string('key_prefix', 8).notNullable().index();
    table.string('key_hash', 60).notNullable();
    table.string('role_id', 50).notNullable()
      .references('id').inTable('roles').onDelete('RESTRICT');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.timestamps(true, true);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('api_keys');
};
