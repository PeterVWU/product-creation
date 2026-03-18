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
});
