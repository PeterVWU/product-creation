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

    it('standalone: children contains one entry using parent sku and price', async () => {
      const mockParent = {
        sku: 'SIMPLE-001',
        type_id: 'simple',
        price: 49.99,
        tier_prices: [],
        custom_attributes: []
      };

      service.sourceService.getProductBySku = jest.fn().mockResolvedValueOnce(mockParent);

      const result = await service.extractPrices('SIMPLE-001');

      expect(result.children).toHaveLength(1);
      expect(result.children[0].sku).toBe('SIMPLE-001');
      expect(result.children[0].price).toBe(49.99);
      expect(result.children[0].specialPrice).toBeNull();
      expect(result.children[0].tierPrices).toEqual([]);
    });

    it('standalone: specialPrice is populated from parent custom_attributes', async () => {
      const mockParent = {
        sku: 'SIMPLE-002',
        type_id: 'simple',
        price: 49.99,
        tier_prices: [],
        custom_attributes: [{ attribute_code: 'special_price', value: '39.99' }]
      };

      service.sourceService.getProductBySku = jest.fn().mockResolvedValueOnce(mockParent);

      const result = await service.extractPrices('SIMPLE-002');

      expect(result.children[0].specialPrice).toBe(39.99);
    });

    it('standalone: getProductBySku is called exactly once — no child fetches', async () => {
      const mockParent = {
        sku: 'SIMPLE-003',
        type_id: 'simple',
        price: 29.99,
        tier_prices: [],
        custom_attributes: []
      };

      service.sourceService.getProductBySku = jest.fn().mockResolvedValueOnce(mockParent);

      await service.extractPrices('SIMPLE-003');

      expect(service.sourceService.getProductBySku).toHaveBeenCalledTimes(1);
      expect(service.sourceService.getProductBySku).toHaveBeenCalledWith('SIMPLE-003');
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

    it('passes undefined specialPrice when child has no specialPrice field', async () => {
      const priceData = {
        children: [{ sku: 'CHILD-001', price: 99.99, tierPrices: [] }] // no specialPrice field
      };

      await service.updateMagentoPricesForInstance(priceData, mockScopedService, null, 'store1', 'default');

      expect(mockScopedService.updateProductPrice).toHaveBeenCalledWith('CHILD-001', 99.99, undefined);
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

  describe('updateShopifyPricesForStore (non-tier store)', () => {
    const ShopifyTargetService = require('../../../src/services/shopify/shopify-target.service');
    const config = require('../../../src/config');

    let mockShopifyService;

    beforeEach(() => {
      // Non-tier store: no groupId mapping
      config.priceSync.storeGroupMapping = {};

      mockShopifyService = {
        getVariantsBySkus: jest.fn(),
        updateVariantPrices: jest.fn().mockResolvedValue({ updatedCount: 1 })
      };

      jest.spyOn(ShopifyTargetService.prototype, 'getVariantsBySkus')
        .mockImplementation((...args) => mockShopifyService.getVariantsBySkus(...args));
      jest.spyOn(ShopifyTargetService.prototype, 'updateVariantPrices')
        .mockImplementation((...args) => mockShopifyService.updateVariantPrices(...args));
    });

    const storeConfig = { url: 'test.myshopify.com', token: 'tok' };
    const existingVariant = {
      id: 'gid://shopify/ProductVariant/1',
      sku: 'CHILD-001',
      price: '95.00',
      compareAtPrice: null,
      product: { id: 'gid://shopify/Product/1' }
    };

    it('sets price=specialPrice and compareAtPrice=regularPrice when child has specialPrice', async () => {
      mockShopifyService.getVariantsBySkus.mockResolvedValue([existingVariant]);

      const priceData = {
        parentSku: 'PARENT-001',
        children: [{ sku: 'CHILD-001', price: 99.99, specialPrice: 79.99 }]
      };

      await service.updateShopifyPricesForStore(priceData, 'teststore', storeConfig);

      const variantPrices = mockShopifyService.updateVariantPrices.mock.calls[0][1];
      expect(variantPrices[0].price).toBe(79.99);
      expect(variantPrices[0].compareAtPrice).toBe(99.99);
    });

    it('sets price=regularPrice and compareAtPrice=null when child has no specialPrice', async () => {
      mockShopifyService.getVariantsBySkus.mockResolvedValue([existingVariant]);

      const priceData = {
        parentSku: 'PARENT-001',
        children: [{ sku: 'CHILD-001', price: 99.99, specialPrice: null }]
      };

      await service.updateShopifyPricesForStore(priceData, 'teststore', storeConfig);

      const variantPrices = mockShopifyService.updateVariantPrices.mock.calls[0][1];
      expect(variantPrices[0].price).toBe(99.99);
      expect(variantPrices[0].compareAtPrice).toBeNull();
    });

    it('treats specialPrice >= regularPrice as no special price (logs warning)', async () => {
      mockShopifyService.getVariantsBySkus.mockResolvedValue([existingVariant]);

      const priceData = {
        parentSku: 'PARENT-001',
        children: [{ sku: 'CHILD-001', price: 79.99, specialPrice: 99.99 }]
      };

      await service.updateShopifyPricesForStore(priceData, 'teststore', storeConfig);

      const variantPrices = mockShopifyService.updateVariantPrices.mock.calls[0][1];
      // specialPrice >= price → treated as no special price
      expect(variantPrices[0].price).toBe(79.99);
      expect(variantPrices[0].compareAtPrice).toBeNull();
    });

    it('treats missing specialPrice (undefined) as no special price', async () => {
      mockShopifyService.getVariantsBySkus.mockResolvedValue([existingVariant]);

      const priceData = {
        parentSku: 'PARENT-001',
        children: [{ sku: 'CHILD-001', price: 99.99 }] // no specialPrice field
      };

      await service.updateShopifyPricesForStore(priceData, 'teststore', storeConfig);

      const variantPrices = mockShopifyService.updateVariantPrices.mock.calls[0][1];
      expect(variantPrices[0].price).toBe(99.99);
      expect(variantPrices[0].compareAtPrice).toBeNull();
    });

    it('uses legacy updateCompareAt shape for tier-mapped stores and ignores specialPrice', async () => {
      // Set up a tier store mapping
      config.priceSync.storeGroupMapping = { tierstore: 2 };

      const variantWithCompareAt = {
        ...existingVariant,
        compareAtPrice: '95.00' // has compare-at price → tier logic will use updateCompareAt
      };
      mockShopifyService.getVariantsBySkus.mockResolvedValue([variantWithCompareAt]);

      const priceData = {
        parentSku: 'PARENT-001',
        children: [{
          sku: 'CHILD-001',
          price: 99.99,
          specialPrice: 79.99,
          tierPrices: [{ customer_group_id: 2, qty: 1, value: 85.00 }]
        }]
      };

      await service.updateShopifyPricesForStore(priceData, 'tierstore', storeConfig);

      const variantPrices = mockShopifyService.updateVariantPrices.mock.calls[0][1];
      // Tier store: uses updateCompareAt flag, not compareAtPrice field
      expect(variantPrices[0].updateCompareAt).toBe(true);
      expect(variantPrices[0]).not.toHaveProperty('compareAtPrice');
    });
  });
});
