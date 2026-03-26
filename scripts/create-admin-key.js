#!/usr/bin/env node
require('dotenv').config();

const db = require('../src/database/connection');
const apiKeyRepo = require('../src/database/repositories/api-key.repository');
const { generateApiKey, hashSecret } = require('../src/utils/api-key.utils');

async function main() {
  const name = process.argv[2] || 'admin-bootstrap';

  try {
    await db.migrate.latest();
    await db.seed.run();

    const { rawKey, prefix, secret } = generateApiKey();
    const keyHash = await hashSecret(secret);

    const record = await apiKeyRepo.create({
      name,
      keyPrefix: prefix,
      keyHash,
      roleId: 'admin'
    });

    console.log('\n=== Admin API Key Created ===');
    console.log(`Name:  ${record.name}`);
    console.log(`ID:    ${record.id}`);
    console.log(`Key:   ${rawKey}`);
    console.log('\nSave this key now — it cannot be retrieved again.\n');
  } catch (error) {
    console.error('Failed to create admin key:', error.message);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();
