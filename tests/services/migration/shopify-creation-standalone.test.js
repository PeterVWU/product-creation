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

describe('ShopifyCreationService.createStandaloneProduct — VaporDNA enrichment', () => {
  let service;
  let mockShopifyTargetService;
  let mockCategoryMappingService;
  let mockStoreDescriptionService;

  const baseExtractedData = {
    parent: {
      sku: 'VDNA-001',
      name: 'Geek Bar Pulse Disposable',
      price: 19.99
    },
    images: { parent: [], children: {} },
    categories: [{ id: 5, name: 'Disposables' }],
    translations: {
      attributes: {},
      attributeValues: {},
      customAttributes: {},
      brandLabel: 'Geek Bar'
    },
    children: [],
    childLinks: []
  };

  beforeEach(() => {
    mockShopifyTargetService = {
      uploadAndWaitForFiles: jest.fn().mockResolvedValue([]),
      createProductWithVariants: jest.fn().mockResolvedValue({
        id: 'gid://shopify/Product/900',
        handle: 'geek-bar-pulse-disposable',
        variants: {
          edges: [{
            node: {
              id: 'gid://shopify/ProductVariant/901',
              title: 'Default Title',
              inventoryItem: { sku: 'VDNA-001' }
            }
          }]
        }
      }),
      publishProduct: jest.fn().mockResolvedValue({}),
      searchCollections: jest.fn().mockResolvedValue([
        { id: 'gid://shopify/Collection/1', title: 'Geek Bar', handle: 'geek-bar', onlineStoreUrl: 'https://vapordna.com/collections/geek-bar' }
      ]),
      searchProductsByTitle: jest.fn().mockResolvedValue([])
    };

    mockCategoryMappingService = {
      getShopifyProductType: jest.fn().mockReturnValue('Disposable Vapes')
    };

    mockStoreDescriptionService = {
      generate: jest.fn().mockResolvedValue({
        descriptionHtml: '<div><p>AI-generated description for VaporDNA.</p></div>',
        keywords: 'vape,disposable,geek bar'
      })
    };

    const ShopifyCreationService = require('../../../src/services/migration/shopify-creation.service');
    service = new ShopifyCreationService(
      {},
      mockShopifyTargetService,
      mockCategoryMappingService,
      'vapordna',
      mockStoreDescriptionService
    );
  });

  it('looks up brand collection via Shopify API using brandLabel', async () => {
    await service.createStandaloneProduct(baseExtractedData, 'vapordna');
    expect(mockShopifyTargetService.searchCollections).toHaveBeenCalledWith('Geek Bar', 5);
  });

  it('calls storeDescriptionService.generate with the resolved hyperlinks', async () => {
    await service.createStandaloneProduct(baseExtractedData, 'vapordna');
    expect(mockStoreDescriptionService.generate).toHaveBeenCalledWith(
      'vapordna',
      expect.objectContaining({
        title: 'Geek Bar Pulse Disposable',
        brandCollectionUrl: 'https://vapordna.com/collections/geek-bar',
        homepageUrl: 'https://vapordna.com/',
        disposablesUrl: 'https://vapordna.com/collections/disposable-vapes',
        partnerUrl: null
      })
    );
  });

  it('falls back to homepage when brand collection is not found', async () => {
    mockShopifyTargetService.searchCollections.mockResolvedValueOnce([]);
    await service.createStandaloneProduct(baseExtractedData, 'vapordna');
    const generateArgs = mockStoreDescriptionService.generate.mock.calls[0][1];
    expect(generateArgs.brandCollectionUrl).toBe('https://vapordna.com/');
  });

  it('sets seo.title as "{title}" | Only $X.XX and seo.description truncated to ≤160 chars', async () => {
    await service.createStandaloneProduct(baseExtractedData, 'vapordna');
    const [productData] = mockShopifyTargetService.createProductWithVariants.mock.calls[0];
    expect(productData.seo.title).toBe('"Geek Bar Pulse Disposable" | Only $19.99');
    expect(productData.seo.description.length).toBeLessThanOrEqual(160);
    expect(productData.seo.description).toContain('AI-generated description for VaporDNA');
  });

  it('uses AI-generated descriptionHtml when available', async () => {
    await service.createStandaloneProduct(baseExtractedData, 'vapordna');
    const [productData] = mockShopifyTargetService.createProductWithVariants.mock.calls[0];
    expect(productData.descriptionHtml).toContain('AI-generated description for VaporDNA');
  });

  it('searches for kit partner when product title contains "Pod"', async () => {
    const podData = {
      ...baseExtractedData,
      parent: { ...baseExtractedData.parent, name: 'Geek Bar Mate 60K Refill Pod' }
    };
    mockShopifyTargetService.searchProductsByTitle.mockResolvedValueOnce([
      { id: 'gid://shopify/Product/500', title: 'Geek Bar Mate 60K Kit', handle: 'geek-bar-mate-60k-kit', onlineStoreUrl: 'https://vapordna.com/products/geek-bar-mate-60k-kit' }
    ]);
    await service.createStandaloneProduct(podData, 'vapordna');
    expect(mockShopifyTargetService.searchProductsByTitle).toHaveBeenCalled();
    const generateArgs = mockStoreDescriptionService.generate.mock.calls[0][1];
    expect(generateArgs.partnerUrl).toBe('https://vapordna.com/products/geek-bar-mate-60k-kit');
  });

  it('skips partner link silently when no partner found', async () => {
    const kitData = {
      ...baseExtractedData,
      parent: { ...baseExtractedData.parent, name: 'Acme Mystery Kit' }
    };
    mockShopifyTargetService.searchProductsByTitle.mockResolvedValueOnce([]);
    await service.createStandaloneProduct(kitData, 'vapordna');
    const generateArgs = mockStoreDescriptionService.generate.mock.calls[0][1];
    expect(generateArgs.partnerUrl).toBeNull();
  });

  it('does not pass tags for VaporDNA products', async () => {
    await service.createStandaloneProduct(baseExtractedData, 'vapordna');
    const [productData] = mockShopifyTargetService.createProductWithVariants.mock.calls[0];
    expect(productData.tags).toEqual([]);
  });
});
