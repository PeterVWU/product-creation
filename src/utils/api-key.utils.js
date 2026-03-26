const crypto = require('crypto');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;
const PREFIX_LENGTH = 8;
const SECRET_LENGTH = 32;

function generateApiKey() {
  const prefix = crypto.randomBytes(4).toString('hex');
  const secret = crypto.randomBytes(SECRET_LENGTH).toString('hex');
  const rawKey = `mk_${prefix}_${secret}`;
  return { rawKey, prefix, secret };
}

async function hashSecret(secret) {
  return bcrypt.hash(secret, SALT_ROUNDS);
}

async function verifySecret(secret, hash) {
  return bcrypt.compare(secret, hash);
}

function parseApiKey(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') return null;
  const parts = rawKey.split('_');
  if (parts.length !== 3 || parts[0] !== 'mk') return null;
  return { prefix: parts[1], secret: parts[2] };
}

module.exports = { generateApiKey, hashSecret, verifySecret, parseApiKey };
