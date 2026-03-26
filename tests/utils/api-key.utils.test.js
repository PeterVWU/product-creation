const { parseApiKey, generateApiKey, hashSecret, verifySecret } = require('../../src/utils/api-key.utils');

describe('api-key.utils', () => {
  test('generateApiKey returns rawKey, prefix, and secret', () => {
    const { rawKey, prefix, secret } = generateApiKey();
    expect(rawKey).toMatch(/^mk_[a-f0-9]{8}_[a-f0-9]{64}$/);
    expect(prefix).toHaveLength(8);
    expect(secret).toHaveLength(64);
  });

  test('parseApiKey extracts prefix and secret', () => {
    const result = parseApiKey('mk_abcd1234_secretvalue');
    expect(result).toEqual({ prefix: 'abcd1234', secret: 'secretvalue' });
  });

  test('parseApiKey returns null for invalid formats', () => {
    expect(parseApiKey(null)).toBeNull();
    expect(parseApiKey('')).toBeNull();
    expect(parseApiKey('invalid')).toBeNull();
    expect(parseApiKey('xx_abc_def')).toBeNull();
  });

  test('hashSecret and verifySecret round-trip', async () => {
    const secret = 'test-secret-value';
    const hash = await hashSecret(secret);
    expect(await verifySecret(secret, hash)).toBe(true);
    expect(await verifySecret('wrong-secret', hash)).toBe(false);
  });
});
