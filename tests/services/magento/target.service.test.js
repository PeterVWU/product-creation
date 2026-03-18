'use strict';

jest.mock('../../../src/config', () => ({
  magentoStores: {},
  api: {}
}));

const TargetService = require('../../../src/services/magento/target.service');

describe('TargetService', () => {
  let service;
  let putSpy;

  beforeEach(() => {
    service = new TargetService('http://target.test', 'tok', {});
    putSpy = jest.spyOn(service, 'put').mockResolvedValue({ sku: 'TEST-SKU' });
  });

  describe('updateProductPrice', () => {
    it('sends price in payload when specialPrice is omitted', async () => {
      await service.updateProductPrice('TEST-SKU', 99.99);

      expect(putSpy).toHaveBeenCalledWith(
        '/rest/V1/products/TEST-SKU',
        { product: { sku: 'TEST-SKU', price: 99.99 } }
      );
      // No custom_attributes key when specialPrice not provided
      const payload = putSpy.mock.calls[0][1];
      expect(payload.product.custom_attributes).toBeUndefined();
    });

    it('includes special_price in custom_attributes when specialPrice is provided', async () => {
      await service.updateProductPrice('TEST-SKU', 99.99, 79.99);

      const payload = putSpy.mock.calls[0][1];
      expect(payload.product.custom_attributes).toEqual([
        { attribute_code: 'special_price', value: 79.99 }
      ]);
    });

    it('sends null special_price to clear it when specialPrice is null', async () => {
      await service.updateProductPrice('TEST-SKU', 99.99, null);

      const payload = putSpy.mock.calls[0][1];
      expect(payload.product.custom_attributes).toEqual([
        { attribute_code: 'special_price', value: null }
      ]);
    });

    it('URL-encodes SKUs with special characters', async () => {
      await service.updateProductPrice('TEST/SKU-001', 10);

      expect(putSpy.mock.calls[0][0]).toBe('/rest/V1/products/TEST%2FSKU-001');
    });
  });

  describe('deleteAllProductMedia', () => {
    let deleteSpy;

    beforeEach(() => {
      deleteSpy = jest.spyOn(service, 'delete').mockResolvedValue({});
    });

    it('deletes each media entry by id', async () => {
      const entries = [
        { id: 1, file: '/a.jpg' },
        { id: 2, file: '/b.jpg' }
      ];
      await service.deleteAllProductMedia('TEST-SKU', entries);
      expect(deleteSpy).toHaveBeenCalledTimes(2);
      expect(deleteSpy).toHaveBeenCalledWith('/rest/V1/products/TEST-SKU/media/1');
      expect(deleteSpy).toHaveBeenCalledWith('/rest/V1/products/TEST-SKU/media/2');
    });

    it('does nothing when entries array is empty', async () => {
      await service.deleteAllProductMedia('TEST-SKU', []);
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('does nothing when entries is null', async () => {
      await service.deleteAllProductMedia('TEST-SKU', null);
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('continues and logs when one deletion fails', async () => {
      const entries = [
        { id: 1, file: '/a.jpg' },
        { id: 2, file: '/b.jpg' }
      ];
      deleteSpy.mockRejectedValueOnce(new Error('network error'));
      // Should not throw
      await expect(service.deleteAllProductMedia('TEST-SKU', entries)).resolves.not.toThrow();
      // Both deletions attempted
      expect(deleteSpy).toHaveBeenCalledTimes(2);
    });

    it('URL-encodes SKUs with special characters', async () => {
      const entries = [{ id: 5, file: '/x.jpg' }];
      await service.deleteAllProductMedia('SKU/001', entries);
      expect(deleteSpy).toHaveBeenCalledWith('/rest/V1/products/SKU%2F001/media/5');
    });
  });
});
