exports.up = async function (knex) {
  await knex.schema.createTable('shopify_product_mappings', table => {
    table.increments('id').primary();
    table.string('source_shop', 255).notNullable();
    table.string('source_product_id', 100).notNullable();
    table.string('target_shop', 255).notNullable();
    table.string('target_product_id', 100);
    table.string('creation_handle', 100).notNullable();
    table.boolean('initialized').notNullable().defaultTo(false);
    table.boolean('created_by_migration').notNullable().defaultTo(false);
    table.jsonb('variants').notNullable().defaultTo('{}');
    table.jsonb('images').notNullable().defaultTo('{}');
    table.timestamps(true, true);
    table.unique(['source_shop', 'source_product_id', 'target_shop']);
    table.unique(['target_shop', 'target_product_id']);
  });
};
exports.down = knex => knex.schema.dropTableIfExists('shopify_product_mappings');
