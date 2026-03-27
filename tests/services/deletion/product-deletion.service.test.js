'use strict';

jest.mock('../../../src/services/magento/source.service');
jest.mock('../../../src/services/magento/target.service');
jest.mock('../../../src/services/shopify/shopify-target.service');
jest.mock('../../../src/config', () => ({
  source: { baseUrl: 'http://source.test', token: 'test-token' },
  api: { timeout: 5000 },
  shopify: { stores: { teststore: { url: 'test.myshopify.com', token: 'shpat_test' } } }
}));

const SourceService = require('../../../src/services/magento/source.service');
const TargetService = require('../../../src/services/magento/target.service');
const ShopifyTargetService = require('../../../src/services/shopify/shopify-target.service');
// Re-require after mocks are set up to get the singleton with mocked deps
const deletionService = require('../../../src/services/deletion/product-deletion.service');

describe('ProductDeletionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('simple product deletion from source Magento', () => {
    it('calls deleteProduct with correct SKU and verifies deletion', async () => {
      const mockService = {
        getProductBySku: jest.fn()
          .mockResolvedValueOnce({ sku: 'TEST-001', type_id: 'simple' })
          .mockResolvedValueOnce(null), // verification: not found
        getConfigurableChildren: jest.fn().mockResolvedValue([]),
        deleteProduct: jest.fn().mockResolvedValue(true)
      };
      SourceService.mockImplementation(() => mockService);

      const result = await deletionService.deleteProduct({
        sku: 'TEST-001',
        platform: 'source-magento'
      });

      expect(mockService.deleteProduct).toHaveBeenCalledWith('TEST-001');
      expect(mockService.getProductBySku).toHaveBeenCalledTimes(2);
      expect(result.success).toBe(true);
      expect(result.deletedSkus).toContain('TEST-001');
    });
  });

  describe('simple product deletion from target Magento', () => {
    it('uses getInstanceForStore with correct store name', async () => {
      const mockService = {
        getProductBySku: jest.fn()
          .mockResolvedValueOnce({ sku: 'TARGET-001', type_id: 'simple' })
          .mockResolvedValueOnce(null),
        getConfigurableChildren: jest.fn().mockResolvedValue([]),
        deleteProduct: jest.fn().mockResolvedValue(true)
      };
      TargetService.getInstanceForStore = jest.fn().mockReturnValue(mockService);

      const result = await deletionService.deleteProduct({
        sku: 'TARGET-001',
        platform: 'target-magento',
        storeName: 'mystore'
      });

      expect(TargetService.getInstanceForStore).toHaveBeenCalledWith('mystore');
      expect(mockService.deleteProduct).toHaveBeenCalledWith('TARGET-001');
      expect(result.success).toBe(true);
    });
  });

  describe('simple product deletion from target Shopify', () => {
    it('calls getVariantsBySkus -> getProductById -> deleteProduct flow', async () => {
      const shopifyProductId = 'gid://shopify/Product/123';
      const mockService = {
        getVariantsBySkus: jest.fn()
          .mockResolvedValueOnce([{ sku: 'SHOP-001', product: { id: shopifyProductId } }])
          .mockResolvedValueOnce([]), // verification: not found
        getProductById: jest.fn().mockResolvedValue({
          id: shopifyProductId,
          variants: { edges: [] }
        }),
        deleteProduct: jest.fn().mockResolvedValue(shopifyProductId)
      };
      ShopifyTargetService.mockImplementation(() => mockService);

      const result = await deletionService.deleteProduct({
        sku: 'SHOP-001',
        platform: 'target-shopify',
        storeName: 'teststore'
      });

      expect(mockService.getVariantsBySkus).toHaveBeenCalledWith(['SHOP-001']);
      expect(mockService.getProductById).toHaveBeenCalledWith(shopifyProductId);
      expect(mockService.deleteProduct).toHaveBeenCalledWith(shopifyProductId);
      expect(result.success).toBe(true);
    });
  });

  describe('configurable product deletion (Magento)', () => {
    it('deletes all 3 children before deleting the parent', async () => {
      const children = [
        { sku: 'CHILD-001' },
        { sku: 'CHILD-002' },
        { sku: 'CHILD-003' }
      ];
      const deleteOrder = [];
      const mockService = {
        getProductBySku: jest.fn()
          .mockResolvedValueOnce({ sku: 'PARENT-001', type_id: 'configurable' })
          .mockResolvedValueOnce(null),
        getConfigurableChildren: jest.fn().mockResolvedValue(children),
        deleteProduct: jest.fn().mockImplementation(sku => {
          deleteOrder.push(sku);
          return Promise.resolve(true);
        })
      };
      SourceService.mockImplementation(() => mockService);

      const result = await deletionService.deleteProduct({
        sku: 'PARENT-001',
        platform: 'source-magento'
      });

      expect(mockService.deleteProduct).toHaveBeenCalledTimes(4);
      expect(deleteOrder[0]).toBe('CHILD-001');
      expect(deleteOrder[1]).toBe('CHILD-002');
      expect(deleteOrder[2]).toBe('CHILD-003');
      expect(deleteOrder[3]).toBe('PARENT-001');
      expect(result.success).toBe(true);
      expect(result.deletedSkus).toEqual(['CHILD-001', 'CHILD-002', 'CHILD-003', 'PARENT-001']);
    });
  });

  describe('product not found', () => {
    it('throws error with statusCode 404 when product does not exist', async () => {
      const mockService = {
        getProductBySku: jest.fn().mockResolvedValue(null),
        getConfigurableChildren: jest.fn()
      };
      SourceService.mockImplementation(() => mockService);

      await expect(
        deletionService.deleteProduct({ sku: 'MISSING-001', platform: 'source-magento' })
      ).rejects.toMatchObject({
        message: expect.stringContaining('MISSING-001'),
        statusCode: 404
      });

      expect(mockService.getConfigurableChildren).not.toHaveBeenCalled();
    });
  });

  describe('partial failure stops immediately', () => {
    it('stops on 2nd child failure: 1st in deletedSkus, 2nd in failedSkus, 3rd never attempted, parent not attempted', async () => {
      const children = [
        { sku: 'CHILD-A' },
        { sku: 'CHILD-B' },
        { sku: 'CHILD-C' }
      ];
      const mockService = {
        getProductBySku: jest.fn().mockResolvedValue({ sku: 'PARENT-X', type_id: 'configurable' }),
        getConfigurableChildren: jest.fn().mockResolvedValue(children),
        deleteProduct: jest.fn()
          .mockResolvedValueOnce(true)           // CHILD-A: success
          .mockRejectedValueOnce(new Error('network error')) // CHILD-B: fail
      };
      SourceService.mockImplementation(() => mockService);

      const result = await deletionService.deleteProduct({
        sku: 'PARENT-X',
        platform: 'source-magento'
      });

      expect(result.success).toBe(false);
      expect(result.deletedSkus).toEqual(['CHILD-A']);
      expect(result.failedSkus).toEqual(['CHILD-B']);
      // CHILD-C and PARENT-X never attempted
      expect(mockService.deleteProduct).toHaveBeenCalledTimes(2);
      expect(mockService.deleteProduct).not.toHaveBeenCalledWith('CHILD-C');
      expect(mockService.deleteProduct).not.toHaveBeenCalledWith('PARENT-X');
    });
  });

  describe('verification failure', () => {
    it('returns success=false when product still exists after deletion', async () => {
      const product = { sku: 'VERIFY-001', type_id: 'simple' };
      const mockService = {
        getProductBySku: jest.fn().mockResolvedValue(product), // always returns product
        getConfigurableChildren: jest.fn().mockResolvedValue([]),
        deleteProduct: jest.fn().mockResolvedValue(true)
      };
      SourceService.mockImplementation(() => mockService);

      const result = await deletionService.deleteProduct({
        sku: 'VERIFY-001',
        platform: 'source-magento'
      });

      expect(mockService.deleteProduct).toHaveBeenCalledWith('VERIFY-001');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/still exists/i);
    });
  });

  describe('invalid platform', () => {
    it('throws error for unknown platform', async () => {
      await expect(
        deletionService.deleteProduct({ sku: 'ANY-SKU', platform: 'invalid-platform' })
      ).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('Invalid platform')
      });
    });
  });

  describe('missing store config', () => {
    it('throws error for non-existent Shopify store name', async () => {
      await expect(
        deletionService.deleteProduct({
          sku: 'ANY-SKU',
          platform: 'target-shopify',
          storeName: 'nonexistent-store'
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('nonexistent-store')
      });
    });
  });
});
