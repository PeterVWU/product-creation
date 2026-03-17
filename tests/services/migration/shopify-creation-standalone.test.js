'use strict';

const ShopifyCreationService = require('../../../src/services/migration/shopify-creation.service');

describe('ShopifyCreationService.createStandaloneProduct', () => {
  let service;
  let mockSourceService;
  let mockShopifyTargetService;
  let mockCategoryMappingService;

  const mockExtractedData = {
    parent: {
      sku: 'SIMPLE-001',
      name: 'Test Simple Product',
      price: 29.99
    },
    images: {
      parent: [{ file: '/img/test.jpg', label: 'Main', position: 1, types: ['image'], disabled: false }],
      children: {}
    },
    categories: [{ id: 5, name: 'E-Liquids' }],
    translations: {
      attributeSet: { id: 10, name: 'Default' },
      attributes: {},
      attributeValues: {},
      customAttributes: {},
      brandLabel: 'Vaporesso'
    },
    children: [],
    childLinks: []
  };

  beforeEach(() => {
    mockSourceService = {};

    mockShopifyTargetService = {
      uploadAndWaitForFiles: jest.fn().mockResolvedValue(['gid://shopify/MediaImage/123']),
      createProductWithVariants: jest.fn().mockResolvedValue({
        id: 'gid://shopify/Product/456',
        handle: 'test-simple-product',
        variants: {
          edges: [
            {
              node: {
                id: 'gid://shopify/ProductVariant/789',
                title: 'Default Title',
                inventoryItem: { sku: 'SIMPLE-001' }
              }
            }
          ]
        }
      }),
      publishProduct: jest.fn().mockResolvedValue({}),
      buildAdminUrl: jest.fn().mockReturnValue('https://admin.shopify.com/products/456')
    };

    mockCategoryMappingService = {
      getShopifyProductType: jest.fn().mockReturnValue('E-Liquids')
    };

    service = new ShopifyCreationService(
      mockSourceService,
      mockShopifyTargetService,
      mockCategoryMappingService,
      'teststore'
    );
  });

  it('returns parentProductId, shopifyHandle, and createdVariants with one entry', async () => {
    const result = await service.createStandaloneProduct(mockExtractedData, 'teststore');

    expect(result.parentProductId).toBe('gid://shopify/Product/456');
    expect(result.shopifyHandle).toBe('test-simple-product');
    expect(result.createdVariants).toHaveLength(1);
    expect(result.createdVariants[0]).toMatchObject({
      sku: 'SIMPLE-001',
      success: true
    });
  });

  it('calls createProductWithVariants with no productOptions array', async () => {
    await service.createStandaloneProduct(mockExtractedData, 'teststore');

    const [, productOptions] = mockShopifyTargetService.createProductWithVariants.mock.calls[0];
    expect(productOptions).toEqual([]);
  });

  it('calls createProductWithVariants with a single variant that has no optionValues', async () => {
    await service.createStandaloneProduct(mockExtractedData, 'teststore');

    const [, , variants] = mockShopifyTargetService.createProductWithVariants.mock.calls[0];
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({
      sku: 'SIMPLE-001',
      price: '29.99'
    });
    // optionValues must be absent — not an empty array
    expect(variants[0].optionValues).toBeUndefined();
  });

  it('uses getShopifyProductType for productType (store-aware)', async () => {
    await service.createStandaloneProduct(mockExtractedData, 'teststore');

    expect(mockCategoryMappingService.getShopifyProductType).toHaveBeenCalledWith(
      ['E-Liquids'],
      'teststore'
    );
  });

  it('calls publishProduct after creating the product', async () => {
    await service.createStandaloneProduct(mockExtractedData, 'teststore');

    expect(mockShopifyTargetService.publishProduct).toHaveBeenCalledWith('gid://shopify/Product/456');
  });

  it('uploads images and includes fileIds', async () => {
    await service.createStandaloneProduct(mockExtractedData, 'teststore');

    expect(mockShopifyTargetService.uploadAndWaitForFiles).toHaveBeenCalled();
    const [, , , fileIds] = mockShopifyTargetService.createProductWithVariants.mock.calls[0];
    expect(fileIds).toEqual(['gid://shopify/MediaImage/123']);
  });

  it('handles product with no images gracefully', async () => {
    const dataNoImages = {
      ...mockExtractedData,
      images: { parent: [], children: {} }
    };

    await service.createStandaloneProduct(dataNoImages, 'teststore');

    expect(mockShopifyTargetService.uploadAndWaitForFiles).not.toHaveBeenCalled();
  });
});
