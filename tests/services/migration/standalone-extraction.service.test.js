// tests/services/migration/standalone-extraction.service.test.js
'use strict';

const StandaloneExtractionService = require('../../../src/services/migration/standalone-extraction.service');

// Mock the AttributeService — we test StandaloneExtractionService in isolation
jest.mock('../../../src/services/attribute.service');
const AttributeService = require('../../../src/services/attribute.service');

describe('StandaloneExtractionService', () => {
  let service;
  let mockSourceService;
  let mockAttributeServiceInstance;

  const mockProduct = {
    sku: 'SIMPLE-001',
    name: 'Test Simple Product',
    type_id: 'simple',
    visibility: 4,
    price: 29.99,
    attribute_set_id: 10,
    custom_attributes: [
      { attribute_code: 'brand', value: '42' },
      { attribute_code: 'color', value: 'blue' }
    ],
    extension_attributes: {
      category_links: [
        { category_id: '5' },
        { category_id: '8' }
      ],
      stock_item: { qty: 100, is_in_stock: true, manage_stock: true }
    },
    media_gallery_entries: [
      { file: '/img/test.jpg', label: 'Main', position: 1, types: ['image'], disabled: false }
    ]
  };

  beforeEach(() => {
    mockSourceService = {};

    mockAttributeServiceInstance = {
      translateAttributeSet: jest.fn().mockResolvedValue({ id: 10, name: 'Default' }),
      translateCustomAttributes: jest.fn().mockResolvedValue({ brand: 'Vaporesso', color: 'blue' }),
      translateBrandAttribute: jest.fn().mockResolvedValue('Vaporesso'),
      translateCategories: jest.fn().mockResolvedValue({ 5: 'E-Liquids', 8: 'Salts' })
    };

    AttributeService.mockImplementation(() => mockAttributeServiceInstance);

    service = new StandaloneExtractionService(mockSourceService);
  });

  describe('extractProduct', () => {
    it('returns parent, images, categories, translations, children, childLinks', async () => {
      const result = await service.extractProduct('SIMPLE-001', mockProduct);

      expect(result).toMatchObject({
        parent: mockProduct,
        children: [],
        childLinks: []
      });
    });

    it('returns images.parent from media_gallery_entries, images.children as empty object', async () => {
      const result = await service.extractProduct('SIMPLE-001', mockProduct);

      expect(result.images.parent).toHaveLength(1);
      expect(result.images.parent[0].file).toBe('/img/test.jpg');
      expect(result.images.children).toEqual({});
    });

    it('returns categories as array of {id, name} objects from category_links', async () => {
      const result = await service.extractProduct('SIMPLE-001', mockProduct);

      expect(result.categories).toEqual([
        { id: 5, name: 'E-Liquids' },
        { id: 8, name: 'Salts' }
      ]);
      expect(mockAttributeServiceInstance.translateCategories).toHaveBeenCalledWith(['5', '8']);
    });

    it('returns translations.attributeSet from translateAttributeSet', async () => {
      const result = await service.extractProduct('SIMPLE-001', mockProduct);

      expect(result.translations.attributeSet).toEqual({ id: 10, name: 'Default' });
      expect(mockAttributeServiceInstance.translateAttributeSet).toHaveBeenCalledWith(10);
    });

    it('returns translations.attributes and attributeValues as empty objects (no configurable options)', async () => {
      const result = await service.extractProduct('SIMPLE-001', mockProduct);

      expect(result.translations.attributes).toEqual({});
      expect(result.translations.attributeValues).toEqual({});
    });

    it('returns translations.customAttributes from translateCustomAttributes', async () => {
      const result = await service.extractProduct('SIMPLE-001', mockProduct);

      expect(result.translations.customAttributes).toEqual({ brand: 'Vaporesso', color: 'blue' });
    });

    it('returns translations.brandLabel from translateBrandAttribute', async () => {
      const result = await service.extractProduct('SIMPLE-001', mockProduct);

      expect(result.translations.brandLabel).toBe('Vaporesso');
    });

    it('filters out disabled images from media_gallery_entries', async () => {
      const productWithDisabledImage = {
        ...mockProduct,
        media_gallery_entries: [
          { file: '/img/active.jpg', disabled: false, types: [], position: 1 },
          { file: '/img/hidden.jpg', disabled: true, types: [], position: 2 }
        ]
      };

      const result = await service.extractProduct('SIMPLE-001', productWithDisabledImage);

      expect(result.images.parent).toHaveLength(1);
      expect(result.images.parent[0].file).toBe('/img/active.jpg');
    });

    it('handles product with no category_links', async () => {
      const productNoCats = {
        ...mockProduct,
        extension_attributes: { ...mockProduct.extension_attributes, category_links: [] }
      };

      const result = await service.extractProduct('SIMPLE-001', productNoCats);

      expect(result.categories).toEqual([]);
      expect(mockAttributeServiceInstance.translateCategories).not.toHaveBeenCalled();
    });

    it('handles product with no media_gallery_entries', async () => {
      const productNoImages = { ...mockProduct, media_gallery_entries: undefined };

      const result = await service.extractProduct('SIMPLE-001', productNoImages);

      expect(result.images.parent).toEqual([]);
    });

    it('does NOT call getProductBySku — product is passed in pre-fetched', async () => {
      mockSourceService.getProductBySku = jest.fn();

      await service.extractProduct('SIMPLE-001', mockProduct);

      expect(mockSourceService.getProductBySku).not.toHaveBeenCalled();
    });
  });
});
