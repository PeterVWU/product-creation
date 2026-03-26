exports.up = function (knex) {
  return knex.schema.createTable('ai_prompts', (table) => {
    table.uuid('id').primary().defaultTo(knex.fn.uuid());
    table.string('store_name', 100).notNullable();
    table.text('prompt_text').notNullable();
    table.integer('version').notNullable().defaultTo(1);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.uuid('created_by').references('id').inTable('api_keys').onDelete('SET NULL');
    table.timestamps(true, true);

    table.unique(['store_name', 'version']);
    table.index(['store_name', 'is_active']);
  }).then(() => {
    return knex.raw(
      'CREATE UNIQUE INDEX ai_prompts_one_active_per_store ON ai_prompts (store_name) WHERE is_active = true'
    );
  });
};

exports.down = function (knex) {
  return knex.schema.dropTableIfExists('ai_prompts');
};
