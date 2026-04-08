#!/usr/bin/env node
require('dotenv').config();

const db = require('../src/database/connection');
const apiKeyRepo = require('../src/database/repositories/api-key.repository');
const { generateApiKey, hashSecret } = require('../src/utils/api-key.utils');

const VALID_ROLES = ['admin', 'operator', 'operator-readonly', 'viewer'];

async function main() {
  const name = process.argv[2] || 'admin-bootstrap';
  const role = process.argv[3] || 'admin';

  if (!VALID_ROLES.includes(role)) {
    console.error(`Invalid role: ${role}`);
    console.error(`Valid roles: ${VALID_ROLES.join(', ')}`);
    process.exit(1);
  }

  try {
    await db.migrate.latest();
    await db.seed.run();

    const { rawKey, prefix, secret } = generateApiKey();
    const keyHash = await hashSecret(secret);

    const record = await apiKeyRepo.create({
      name,
      keyPrefix: prefix,
      keyHash,
      roleId: role
    });

    console.log('\n=== API Key Created ===');
    console.log(`Name:  ${record.name}`);
    console.log(`Role:  ${role}`);
    console.log(`ID:    ${record.id}`);
    console.log(`Key:   ${rawKey}`);
    console.log('\nSave this key now — it cannot be retrieved again.\n');
  } catch (error) {
    console.error('Failed to create API key:', error.message);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();
