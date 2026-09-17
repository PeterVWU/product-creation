'use strict';

process.env.SOURCE_MAGENTO_BASE_URL = 'http://source.test';
process.env.SOURCE_MAGENTO_TOKEN = 'test-token';

const ShopifyCreationService = require('../../../src/services/migration/shopify-creation.service');

describe('ShopifyCreationService image deduplication', () => {
  it('uploads one file and maps every variant when parent and children share it', () => {
    const service = new ShopifyCreationService({}, {}, null, 'eliquidcom');
    const sharedImage = { file: '/c/l/cloud.png', label: 'Cloud' };

    const result = service.buildImageInputs({
      parent: [sharedImage],
      children: {
        'SKU-RED': [sharedImage],
        'SKU-BLUE': [sharedImage]
      }
    }, { name: 'Cloud Product' }, []);

    expect(result.inputs).toEqual([{
      url: expect.stringContaining('/media/catalog/product/c/l/cloud.png'),
      alt: 'Cloud',
      sku: null,
      skus: ['SKU-RED', 'SKU-BLUE']
    }]);
    expect(result.skuToFileIndex).toEqual({
      'SKU-RED': 0,
      'SKU-BLUE': 0
    });
  });

  it('keeps distinct source files and their variant mappings', () => {
    const service = new ShopifyCreationService({}, {}, null, 'eliquidcom');

    const result = service.buildImageInputs({
      parent: [{ file: '/p/parent.png' }],
      children: {
        'SKU-RED': [{ file: '/p/red.png' }],
        'SKU-BLUE': [{ file: '/p/blue.png' }]
      }
    }, { name: 'Product' }, []);

    expect(result.inputs).toHaveLength(3);
    expect(result.skuToFileIndex).toEqual({
      'SKU-RED': 1,
      'SKU-BLUE': 2
    });
  });
});
