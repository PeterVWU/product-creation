'use strict';

const {
  canonicalImageSource,
  imageContentHash,
  uniqueMediaEntries
} = require('../../src/utils/image-deduplication');

describe('image deduplication', () => {
  it('ignores URL query strings and fragments while preserving path case', () => {
    expect(canonicalImageSource('https://CDN.Example.com/A/Photo.png?v=1#top'))
      .toBe('https://cdn.example.com/A/Photo.png');
  });

  it('keeps the first media entry for each source file', () => {
    const entries = [
      { file: '/a/photo.png', label: 'First' },
      { file: '/a/photo.png?v=2', label: 'Duplicate' },
      { file: '/a/other.png', label: 'Other' }
    ];

    expect(uniqueMediaEntries(entries)).toEqual([entries[0], entries[2]]);
  });

  it('hashes identical image bytes identically', () => {
    expect(imageContentHash(Buffer.from('same-image')))
      .toBe(imageContentHash(Buffer.from('same-image')));
    expect(imageContentHash(Buffer.from('same-image')))
      .not.toBe(imageContentHash(Buffer.from('other-image')));
  });
});
