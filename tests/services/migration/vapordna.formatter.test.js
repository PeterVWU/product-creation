'use strict';

const formatter = require('../../../src/services/migration/formatters/vapordna.formatter');

describe('vapordna.formatter', () => {
  describe('buildMetaTitle', () => {
    it('formats title with 2-decimal price', () => {
      expect(formatter.buildMetaTitle('Geek Bar Pulse', 19.9)).toBe('"Geek Bar Pulse" | Only $19.90');
    });

    it('formats integer price with two decimals', () => {
      expect(formatter.buildMetaTitle('Nexa Ultra V2', 25)).toBe('"Nexa Ultra V2" | Only $25.00');
    });

    it('passes through non-numeric prices as-is', () => {
      expect(formatter.buildMetaTitle('Mystery Box', 'TBD')).toBe('"Mystery Box" | Only $TBD');
    });
  });

  describe('buildMetaDescription', () => {
    it('strips HTML tags and entities', () => {
      const result = formatter.buildMetaDescription('<p>Hello&nbsp;<strong>World</strong></p>');
      expect(result).toBe('Hello World');
    });

    it('truncates at 160 characters without breaking mid-word when possible', () => {
      const long = 'word '.repeat(100);
      const result = formatter.buildMetaDescription(long);
      expect(result.length).toBeLessThanOrEqual(160);
      expect(result.endsWith(' ')).toBe(false);
    });

    it('returns empty string for empty input', () => {
      expect(formatter.buildMetaDescription('')).toBe('');
      expect(formatter.buildMetaDescription(null)).toBe('');
    });

    it('preserves short descriptions verbatim', () => {
      const input = '<p>Short description.</p>';
      expect(formatter.buildMetaDescription(input)).toBe('Short description.');
    });
  });

  describe('sortVariantsAlphabetically', () => {
    it('sorts variants by option value labels case-insensitively', () => {
      const variants = [
        { optionValues: [{ name: 'Watermelon' }], sku: 'W' },
        { optionValues: [{ name: 'Apple' }], sku: 'A' },
        { optionValues: [{ name: 'mango' }], sku: 'M' }
      ];
      const sorted = formatter.sortVariantsAlphabetically(variants);
      expect(sorted.map(v => v.sku)).toEqual(['A', 'M', 'W']);
    });

    it('does not mutate the input array', () => {
      const variants = [
        { optionValues: [{ name: 'B' }] },
        { optionValues: [{ name: 'A' }] }
      ];
      const original = [...variants];
      formatter.sortVariantsAlphabetically(variants);
      expect(variants).toEqual(original);
    });

    it('handles variants without option values', () => {
      const variants = [{ sku: 'X' }, { optionValues: [{ name: 'A' }], sku: 'Y' }];
      expect(() => formatter.sortVariantsAlphabetically(variants)).not.toThrow();
    });
  });

  describe('detectKitOrPod', () => {
    it('detects kit from title', () => {
      expect(formatter.detectKitOrPod('Geek Bar Mate 60K Kit')).toBe('kit');
    });

    it('detects pod from title', () => {
      expect(formatter.detectKitOrPod('Geek Bar Mate 60K Refill Pod')).toBe('pod');
    });

    it('detects cartridge as pod', () => {
      expect(formatter.detectKitOrPod('SMOK Replacement Cartridge')).toBe('pod');
    });

    it('returns null when both kit and pod appear', () => {
      expect(formatter.detectKitOrPod('Kit with Pod bundle')).toBeNull();
    });

    it('returns null when neither keyword is present', () => {
      expect(formatter.detectKitOrPod('Disposable Vape')).toBeNull();
    });
  });

  describe('derivePartnerSearchTitle', () => {
    it('strips "kit" when searching for pod partner', () => {
      expect(formatter.derivePartnerSearchTitle('Geek Bar Mate 60K Kit', 'kit')).toBe('Geek Bar Mate 60K');
    });

    it('strips pod keywords when searching for kit partner', () => {
      expect(formatter.derivePartnerSearchTitle('Geek Bar Mate 60K Refill Pod', 'pod')).toBe('Geek Bar Mate 60K');
    });

    it('returns null when missing inputs', () => {
      expect(formatter.derivePartnerSearchTitle(null, 'kit')).toBeNull();
      expect(formatter.derivePartnerSearchTitle('Something', null)).toBeNull();
    });
  });
});
