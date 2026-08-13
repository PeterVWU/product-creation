const config = require('../src/config');
const storeRepo = require('../src/database/repositories/shopify-store.repository');
const db = require('../src/database/connection');
const TokenCryptoService = require('../src/services/shopify/token-crypto.service');

async function main() {
  const cryptoService = new TokenCryptoService(config.shopify.oauth.keyring, config.shopify.oauth.activeKeyId);
  const stores = await storeRepo.list(); let count = 0;
  for (const store of stores) {
    const values = {};
    if (store.access_token_envelope) values.access_token_envelope = cryptoService.rewrap(store.access_token_envelope, store.id, 'access');
    if (store.refresh_token_envelope) values.refresh_token_envelope = cryptoService.rewrap(store.refresh_token_envelope, store.id, 'refresh');
    if (Object.keys(values).length) { await storeRepo.update(store.id, values); count += 1; }
  }
  console.log(`Rewrapped credentials for ${count} Shopify stores under key ${config.shopify.oauth.activeKeyId}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.destroy());
