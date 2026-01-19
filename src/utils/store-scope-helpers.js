/**
 * Validates store codes format
 * @param {string[]} codes - Array of store codes
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateStoreCodes(codes) {
  const errors = [];

  if (!Array.isArray(codes)) {
    return { valid: false, errors: ['Store codes must be an array'] };
  }

  codes.forEach((code, index) => {
    if (typeof code !== 'string') {
      errors.push(`Store code at index ${index} must be a string`);
    } else if (code.trim() === '') {
      errors.push(`Store code at index ${index} cannot be empty`);
    } else if (!/^[a-zA-Z0-9_]+$/.test(code.trim())) {
      errors.push(`Store code "${code}" contains invalid characters (only alphanumeric and underscore allowed)`);
    }
  });

  return { valid: errors.length === 0, errors };
}

/**
 * Normalizes store codes (lowercase, trim)
 * @param {string[]} codes - Array of store codes
 * @returns {string[]}
 */
function normalizeStoreCodes(codes) {
  if (!Array.isArray(codes)) {
    return [];
  }
  return codes
    .filter(code => typeof code === 'string' && code.trim() !== '')
    .map(code => code.trim().toLowerCase());
}

/**
 * Merges per-store results into a summary
 * @param {Object.<string, { success: boolean, productId?: number, error?: string }>} storeResults
 * @returns {{ storesSucceeded: number, storesFailed: number, allSucceeded: boolean }}
 */
function mergeStoreResults(storeResults) {
  const stores = Object.keys(storeResults);
  const succeeded = stores.filter(store => storeResults[store].success);
  const failed = stores.filter(store => !storeResults[store].success);

  return {
    storesSucceeded: succeeded.length,
    storesFailed: failed.length,
    allSucceeded: failed.length === 0
  };
}

module.exports = {
  validateStoreCodes,
  normalizeStoreCodes,
  mergeStoreResults
};
