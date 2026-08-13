const crypto = require('crypto');

class TokenCryptoService {
  constructor(keyring = {}, activeKeyId = null) {
    this.keys = Object.fromEntries(Object.entries(keyring).map(([id, value]) => {
      const key = Buffer.from(value, 'base64');
      if (key.length !== 32) throw new Error(`Shopify encryption key '${id}' must decode to 32 bytes`);
      return [id, key];
    }));
    this.activeKeyId = activeKeyId;
    if (activeKeyId && !this.keys[activeKeyId]) throw new Error('SHOPIFY_ENCRYPTION_ACTIVE_KEY_ID is not in the keyring');
  }

  aad(storeId, tokenType) { return Buffer.from(`shopify-token:v1:${storeId}:${tokenType}`); }

  encrypt(value, storeId, tokenType) {
    if (!this.activeKeyId) throw new Error('Shopify token encryption is not configured');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.keys[this.activeKeyId], iv);
    cipher.setAAD(this.aad(storeId, tokenType));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return { v: 1, kid: this.activeKeyId, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  }

  decrypt(envelope, storeId, tokenType) {
    if (!envelope || envelope.v !== 1 || !this.keys[envelope.kid]) throw new Error('Unknown Shopify token encryption envelope or key');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.keys[envelope.kid], Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(this.aad(storeId, tokenType));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  }

  rewrap(envelope, storeId, tokenType) {
    return envelope.kid === this.activeKeyId ? envelope : this.encrypt(this.decrypt(envelope, storeId, tokenType), storeId, tokenType);
  }
}

module.exports = TokenCryptoService;
