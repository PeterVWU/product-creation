'use strict';

const ShopifyTargetService = require('../../../src/services/shopify/shopify-target.service');

describe('ShopifyTargetService', () => {
  let service;
  let querySpy;

  beforeEach(() => {
    service = new ShopifyTargetService('test.myshopify.com', 'tok', { apiVersion: '2024-01' });
    querySpy = jest.spyOn(service, 'query').mockResolvedValue({
      data: {
        productVariantsBulkUpdate: {
          productVariants: [{ id: 'gid://shopify/ProductVariant/1', price: '79.99', sku: 'SKU-1' }],
          userErrors: []
        }
      }
    });
  });

  describe('updateVariantPrices', () => {
    it('sets both price and compareAtPrice when compareAtPrice is a string value', async () => {
      const variantPrices = [
        { id: 'gid://shopify/ProductVariant/1', price: 79.99, compareAtPrice: 99.99 }
      ];

      await service.updateVariantPrices('gid://shopify/Product/1', variantPrices);

      const variables = querySpy.mock.calls[0][1];
      expect(variables.variants[0]).toEqual({
        id: 'gid://shopify/ProductVariant/1',
        price: '79.99',
        compareAtPrice: '99.99'
      });
    });

    it('sets price and clears compareAtPrice when compareAtPrice is null', async () => {
      const variantPrices = [
        { id: 'gid://shopify/ProductVariant/1', price: 99.99, compareAtPrice: null }
      ];

      await service.updateVariantPrices('gid://shopify/Product/1', variantPrices);

      const variables = querySpy.mock.calls[0][1];
      expect(variables.variants[0]).toEqual({
        id: 'gid://shopify/ProductVariant/1',
        price: '99.99',
        compareAtPrice: null
      });
    });

    it('sets only price when compareAtPrice is undefined (no compareAtPrice key)', async () => {
      const variantPrices = [
        { id: 'gid://shopify/ProductVariant/1', price: 99.99 }
      ];

      await service.updateVariantPrices('gid://shopify/Product/1', variantPrices);

      const variables = querySpy.mock.calls[0][1];
      expect(variables.variants[0]).toEqual({
        id: 'gid://shopify/ProductVariant/1',
        price: '99.99'
      });
      expect(variables.variants[0]).not.toHaveProperty('compareAtPrice');
    });

    it('sets only compareAtPrice when updateCompareAt is true (legacy tier shape)', async () => {
      const variantPrices = [
        { id: 'gid://shopify/ProductVariant/1', price: 85.00, updateCompareAt: true }
      ];

      await service.updateVariantPrices('gid://shopify/Product/1', variantPrices);

      const variables = querySpy.mock.calls[0][1];
      expect(variables.variants[0]).toEqual({
        id: 'gid://shopify/ProductVariant/1',
        compareAtPrice: '85'
      });
      expect(variables.variants[0]).not.toHaveProperty('price');
    });

    it('handles multiple variants with mixed shapes', async () => {
      const variantPrices = [
        { id: 'gid://shopify/ProductVariant/1', price: 79.99, compareAtPrice: 99.99 },
        { id: 'gid://shopify/ProductVariant/2', price: 89.99, compareAtPrice: null },
        { id: 'gid://shopify/ProductVariant/3', price: 55.00, updateCompareAt: true }
      ];

      querySpy.mockResolvedValue({
        data: {
          productVariantsBulkUpdate: {
            productVariants: [],
            userErrors: []
          }
        }
      });

      await service.updateVariantPrices('gid://shopify/Product/1', variantPrices);

      const variables = querySpy.mock.calls[0][1];
      expect(variables.variants[0]).toEqual({ id: 'gid://shopify/ProductVariant/1', price: '79.99', compareAtPrice: '99.99' });
      expect(variables.variants[1]).toEqual({ id: 'gid://shopify/ProductVariant/2', price: '89.99', compareAtPrice: null });
      expect(variables.variants[2]).toEqual({ id: 'gid://shopify/ProductVariant/3', compareAtPrice: '55' });
    });
  });

  describe('deleteAllProductMedia', () => {
    it('calls productDeleteMedia mutation with all media IDs', async () => {
      service.query = jest.fn().mockResolvedValue({
        data: {
          productDeleteMedia: {
            deletedMediaIds: ['gid://shopify/MediaImage/1', 'gid://shopify/MediaImage/2'],
            mediaUserErrors: []
          }
        }
      });

      await service.deleteAllProductMedia(
        'gid://shopify/Product/123',
        ['gid://shopify/MediaImage/1', 'gid://shopify/MediaImage/2']
      );

      expect(service.query).toHaveBeenCalledWith(
        expect.stringContaining('productDeleteMedia'),
        {
          productId: 'gid://shopify/Product/123',
          mediaIds: ['gid://shopify/MediaImage/1', 'gid://shopify/MediaImage/2']
        }
      );
    });

    it('does nothing when mediaIds is empty', async () => {
      service.query = jest.fn();
      await service.deleteAllProductMedia('gid://shopify/Product/123', []);
      expect(service.query).not.toHaveBeenCalled();
    });

    it('throws when mutation returns userErrors', async () => {
      service.query = jest.fn().mockResolvedValue({
        data: {
          productDeleteMedia: {
            deletedMediaIds: [],
            mediaUserErrors: [{ field: 'mediaIds', message: 'invalid id' }]
          }
        }
      });

      await expect(
        service.deleteAllProductMedia('gid://shopify/Product/123', ['gid://shopify/MediaImage/1'])
      ).rejects.toThrow('invalid id');
    });
  });
});
