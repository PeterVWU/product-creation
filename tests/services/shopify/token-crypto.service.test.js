const crypto = require('crypto');
const TokenCryptoService = require('../../../src/services/shopify/token-crypto.service');

describe('TokenCryptoService', () => {
  const key = crypto.randomBytes(32).toString('base64');
  const service = new TokenCryptoService({ current: key }, 'current');

  it('round trips and randomizes ciphertext', () => {
    const first = service.encrypt('secret', 'store-1', 'access');
    const second = service.encrypt('secret', 'store-1', 'access');
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(service.decrypt(first, 'store-1', 'access')).toBe('secret');
  });

  it('rejects tampering and wrong authenticated identity', () => {
    const envelope = service.encrypt('secret', 'store-1', 'refresh');
    expect(() => service.decrypt(envelope, 'store-2', 'refresh')).toThrow();
    expect(() => service.decrypt({ ...envelope, tag: Buffer.alloc(16).toString('base64') }, 'store-1', 'refresh')).toThrow();
  });

  it('rewraps an old key under the active key', () => {
    const old = new TokenCryptoService({ old: key }, 'old').encrypt('secret', 'store-1', 'access');
    const next = new TokenCryptoService({ old: key, next: crypto.randomBytes(32).toString('base64') }, 'next');
    const wrapped = next.rewrap(old, 'store-1', 'access');
    expect(wrapped.kid).toBe('next');
    expect(next.decrypt(wrapped, 'store-1', 'access')).toBe('secret');
  });
});
