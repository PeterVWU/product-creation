'use strict';

const { sanitizeLogPayload } = require('../../src/utils/helpers');

describe('sanitizeLogPayload', () => {
  it('returns null/undefined as-is', () => {
    expect(sanitizeLogPayload(null)).toBe(null);
    expect(sanitizeLogPayload(undefined)).toBe(undefined);
  });

  it('returns primitives as-is', () => {
    expect(sanitizeLogPayload('hello')).toBe('hello');
    expect(sanitizeLogPayload(42)).toBe(42);
  });

  it('redacts base64_encoded_data fields', () => {
    const input = {
      product: {
        sku: 'TEST-SKU',
        media_gallery_entries: [{
          content: {
            base64_encoded_data: 'iVBORw0KGgoAAAANSUhEUgAAAAUA...',
            type: 'image/jpeg',
            name: 'test.jpg'
          }
        }]
      }
    };
    const result = sanitizeLogPayload(input);
    expect(result.product.media_gallery_entries[0].content.base64_encoded_data).toBe('[BASE64_REDACTED]');
    expect(result.product.media_gallery_entries[0].content.type).toBe('image/jpeg');
    expect(result.product.sku).toBe('TEST-SKU');
  });

  it('redacts long strings that look like base64 (>256 chars)', () => {
    const longBase64 = 'A'.repeat(300);
    const input = {
      entry: {
        content: {
          base64_encoded_data: longBase64,
          type: 'image/png'
        }
      }
    };
    const result = sanitizeLogPayload(input);
    expect(result.entry.content.base64_encoded_data).toBe('[BASE64_REDACTED]');
  });

  it('does not redact non-base64 URL strings', () => {
    const input = {
      query: 'mutation fileCreate...',
      variables: {
        files: [{
          originalSource: 'https://example.com/image.jpg',
          alt: 'test'
        }]
      }
    };
    const result = sanitizeLogPayload(input);
    expect(result.variables.files[0].originalSource).toBe('https://example.com/image.jpg');
  });

  it('returns placeholder for deeply nested objects beyond depth limit', () => {
    let obj = { value: 'deep' };
    for (let i = 0; i < 12; i++) {
      obj = { nested: obj };
    }
    const result = sanitizeLogPayload(obj);
    let current = result;
    for (let i = 0; i < 10; i++) {
      current = current.nested;
    }
    expect(current.nested).toBe('[nested too deep]');
  });

  it('does not mutate the original object', () => {
    const input = {
      product: {
        media_gallery_entries: [{
          content: { base64_encoded_data: 'abc123longdata' }
        }]
      }
    };
    sanitizeLogPayload(input);
    expect(input.product.media_gallery_entries[0].content.base64_encoded_data).toBe('abc123longdata');
  });

  it('truncates long string values (>500 chars)', () => {
    const longDescription = '<p>' + 'x'.repeat(600) + '</p>';
    const input = { product: { name: 'Test', description: longDescription } };
    const result = sanitizeLogPayload(input);
    expect(result.product.description).toMatch(/^<p>x{497}\.\.\. \[truncated, 607 chars total\]$/);
    expect(result.product.name).toBe('Test');
  });

  it('handles deeply nested objects', () => {
    const input = {
      level1: {
        level2: {
          level3: {
            base64_encoded_data: 'data-to-redact'
          }
        }
      }
    };
    const result = sanitizeLogPayload(input);
    expect(result.level1.level2.level3.base64_encoded_data).toBe('[BASE64_REDACTED]');
  });

  it('handles arrays of objects', () => {
    const input = {
      entries: [
        { content: { base64_encoded_data: 'data1' } },
        { content: { base64_encoded_data: 'data2' } }
      ]
    };
    const result = sanitizeLogPayload(input);
    expect(result.entries[0].content.base64_encoded_data).toBe('[BASE64_REDACTED]');
    expect(result.entries[1].content.base64_encoded_data).toBe('[BASE64_REDACTED]');
  });
});
