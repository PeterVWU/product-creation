'use strict';

const crypto = require('crypto');

/**
 * Return a stable key for a source image without treating cache-busting query
 * strings or fragments as distinct files. URL paths remain case-sensitive.
 */
function canonicalImageSource(value) {
  const source = String(value || '').trim();
  if (!source) return '';

  try {
    const url = new URL(source);
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch (_error) {
    return source.replace(/\\/g, '/').replace(/[?#].*$/, '');
  }
}

/**
 * Preserve the first occurrence of every source image file.
 */
function uniqueMediaEntries(entries = []) {
  const seen = new Set();
  const unique = [];

  for (const entry of entries || []) {
    const key = canonicalImageSource(entry?.file || entry?.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }

  return unique;
}

function imageContentHash(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('Image content must be a Buffer');
  }
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
  canonicalImageSource,
  imageContentHash,
  uniqueMediaEntries
};
