'use strict';

jest.mock('../../../src/services/magento/source.service');
jest.mock('../../../src/services/magento/target.service');
jest.mock('../../../src/services/shopify/shopify-target.service');
jest.mock('../../../src/services/notification/google-chat.service');
jest.mock('../../../src/config', () => ({
  source: { baseUrl: 'http://source.test', token: 'tok' },
  api: {},
  shopify: { stores: {}, apiVersion: '2024-01' },
  priceSync: { storeGroupMapping: {} },
  magentoStores: {},
  errorHandling: { continueOnError: true }
}));

const PriceSyncService = require('../../../src/services/sync/price-sync.service');

describe('PriceSyncService', () => {
  let service;

  beforeEach(() => {
    service = new PriceSyncService();
  });

  describe('extractSpecialPrice', () => {
    it('returns null when product has no custom_attributes', () => {
      expect(service.extractSpecialPrice({})).toBeNull();
    });

    it('returns null when special_price attribute is absent', () => {
      const product = { custom_attributes: [{ attribute_code: 'color', value: 'red' }] };
      expect(service.extractSpecialPrice(product)).toBeNull();
    });

    it('returns null when special_price value is empty string', () => {
      const product = { custom_attributes: [{ attribute_code: 'special_price', value: '' }] };
      expect(service.extractSpecialPrice(product)).toBeNull();
    });

    it('returns null when special_price value is null', () => {
      const product = { custom_attributes: [{ attribute_code: 'special_price', value: null }] };
      expect(service.extractSpecialPrice(product)).toBeNull();
    });

    it('returns null when special_price is 0', () => {
      const product = { custom_attributes: [{ attribute_code: 'special_price', value: '0' }] };
      expect(service.extractSpecialPrice(product)).toBeNull();
    });

    it('returns null when special_price is not parseable as a number', () => {
      const product = { custom_attributes: [{ attribute_code: 'special_price', value: 'abc' }] };
      expect(service.extractSpecialPrice(product)).toBeNull();
    });

    it('returns float when special_price is a valid positive number string', () => {
      const product = { custom_attributes: [{ attribute_code: 'special_price', value: '79.99' }] };
      expect(service.extractSpecialPrice(product)).toBe(79.99);
    });

    it('returns float when special_price is an integer string', () => {
      const product = { custom_attributes: [{ attribute_code: 'special_price', value: '50' }] };
      expect(service.extractSpecialPrice(product)).toBe(50);
    });
  });

  describe('extractPrices', () => {
    // PriceSyncService stores the source service instance as `service.sourceService`.
    // We set mocks directly on that instance rather than the class prototype.

    const mockParentBase = {
      price: 100,
      type_id: 'configurable',
      extension_attributes: {
        configurable_product_link_data: [
          JSON.stringify({ simple_product_sku: 'CHILD-001', simple_product_id: 1 })
        ]
      }
    };

    it('includes specialPrice on each child from custom_attributes', async () => {
      const mockParent = { sku: 'PARENT-001', ...mockParentBase };
      const mockChild = {
        sku: 'CHILD-001',
        price: 99.99,
        tier_prices: [],
        custom_attributes: [{ attribute_code: 'special_price', value: '79.99' }]
      };

      service.sourceService.getProductBySku = jest.fn()
        .mockResolvedValueOnce(mockParent)
        .mockResolvedValueOnce(mockChild);

      const result = await service.extractPrices('PARENT-001');

      expect(result.children).toHaveLength(1);
      expect(result.children[0].specialPrice).toBe(79.99);
    });

    it('sets specialPrice to null when child has no special_price', async () => {
      const mockParent = {
        sku: 'PARENT-002',
        ...mockParentBase,
        extension_attributes: {
          configurable_product_link_data: [
            JSON.stringify({ simple_product_sku: 'CHILD-002', simple_product_id: 2 })
          ]
        }
      };
      const mockChild = {
        sku: 'CHILD-002',
        price: 99.99,
        tier_prices: [],
        custom_attributes: []
      };

      service.sourceService.getProductBySku = jest.fn()
        .mockResolvedValueOnce(mockParent)
        .mockResolvedValueOnce(mockChild);

      const result = await service.extractPrices('PARENT-002');

      expect(result.children[0].specialPrice).toBeNull();
    });

    it('preserves tierPrices from child', async () => {
      const mockParent = { sku: 'PARENT-003', ...mockParentBase };
      const mockChild = {
        sku: 'CHILD-001',
        price: 99.99,
        tier_prices: [{ customer_group_id: 2, qty: 1, value: 85.00 }],
        custom_attributes: []
      };

      service.sourceService.getProductBySku = jest.fn()
        .mockResolvedValueOnce(mockParent)
        .mockResolvedValueOnce(mockChild);

      const result = await service.extractPrices('PARENT-003');

      expect(result.children[0].tierPrices).toEqual([{ customer_group_id: 2, qty: 1, value: 85.00 }]);
    });
  });

  describe('updateMagentoPricesForInstance', () => {
    // updateMagentoPricesForInstance receives a scoped TargetService instance directly.
    // We pass a plain mock object — no need to involve the TargetService class mock.
    let mockScopedService;

    beforeEach(() => {
      mockScopedService = {
        updateProductPrice: jest.fn().mockResolvedValue({})
      };
    });

    it('passes specialPrice to updateProductPrice', async () => {
      const priceData = {
        children: [{ sku: 'CHILD-001', price: 99.99, specialPrice: 79.99, tierPrices: [] }]
      };

      await service.updateMagentoPricesForInstance(priceData, mockScopedService, null, 'store1', 'default');

      expect(mockScopedService.updateProductPrice).toHaveBeenCalledWith('CHILD-001', 99.99, 79.99);
    });

    it('passes null specialPrice to clear it on target', async () => {
      const priceData = {
        children: [{ sku: 'CHILD-001', price: 99.99, specialPrice: null, tierPrices: [] }]
      };

      await service.updateMagentoPricesForInstance(priceData, mockScopedService, null, 'store1', 'default');

      expect(mockScopedService.updateProductPrice).toHaveBeenCalledWith('CHILD-001', 99.99, null);
    });

    it('uses tier price for price but still passes specialPrice', async () => {
      const priceData = {
        children: [{
          sku: 'CHILD-001',
          price: 99.99,
          specialPrice: 60.00,
          tierPrices: [{ customer_group_id: 2, qty: 1, value: 85.00 }]
        }]
      };

      await service.updateMagentoPricesForInstance(priceData, mockScopedService, 2, 'store1', 'default');

      // price becomes tier price (85.00), but specialPrice still flows through
      expect(mockScopedService.updateProductPrice).toHaveBeenCalledWith('CHILD-001', 85.00, 60.00);
    });
  });
});
