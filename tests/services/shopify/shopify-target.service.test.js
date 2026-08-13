'use strict';

const ShopifyTargetService = require('../../../src/services/shopify/shopify-target.service');
const axios = require('axios');

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

  describe('updateProductFields', () => {
    it('calls productUpdate mutation with all provided fields', async () => {
      service.query = jest.fn().mockResolvedValue({
        data: {
          productUpdate: {
            product: { id: 'gid://shopify/Product/123', title: 'New Name' },
            userErrors: []
          }
        }
      });

      const fields = {
        title: 'New Name',
        vendor: 'BrandCo',
        descriptionHtml: '<p>desc</p>',
        productType: 'Accessories',
        seoTitle: 'SEO Title',
        seoDescription: 'SEO Desc',
        tags: ['kw1', 'kw2']
      };

      await service.updateProductFields('gid://shopify/Product/123', fields);

      const callArgs = service.query.mock.calls[0];
      expect(callArgs[0]).toContain('productUpdate');
      expect(callArgs[1].input).toMatchObject({
        id: 'gid://shopify/Product/123',
        title: 'New Name',
        vendor: 'BrandCo',
        descriptionHtml: '<p>desc</p>',
        productType: 'Accessories',
        seo: { title: 'SEO Title', description: 'SEO Desc' },
        tags: ['kw1', 'kw2']
      });
    });

    it('omits vendor from input when it is null', async () => {
      service.query = jest.fn().mockResolvedValue({
        data: { productUpdate: { product: { id: 'gid://shopify/Product/123' }, userErrors: [] } }
      });

      await service.updateProductFields('gid://shopify/Product/123', {
        title: 'Test',
        vendor: null,
        descriptionHtml: '',
        productType: '',
        seoTitle: null,
        seoDescription: null,
        tags: []
      });

      const input = service.query.mock.calls[0][1].input;
      expect(input.vendor).toBeUndefined();
    });

    it('omits seo.title when seoTitle is null', async () => {
      service.query = jest.fn().mockResolvedValue({
        data: { productUpdate: { product: { id: 'gid://shopify/Product/123' }, userErrors: [] } }
      });

      await service.updateProductFields('gid://shopify/Product/123', {
        title: 'T', vendor: 'B', descriptionHtml: '', productType: '',
        seoTitle: null, seoDescription: 'desc', tags: []
      });

      const input = service.query.mock.calls[0][1].input;
      expect(input.seo.title).toBeUndefined();
      expect(input.seo.description).toBe('desc');
    });

    it('omits seo entirely when both seoTitle and seoDescription are null', async () => {
      service.query = jest.fn().mockResolvedValue({
        data: { productUpdate: { product: { id: 'gid://shopify/Product/123' }, userErrors: [] } }
      });

      await service.updateProductFields('gid://shopify/Product/123', {
        title: 'T', vendor: 'B', descriptionHtml: '', productType: '',
        seoTitle: null, seoDescription: null, tags: []
      });

      const input = service.query.mock.calls[0][1].input;
      expect(input.seo).toBeUndefined();
    });

    it('throws when userErrors are returned', async () => {
      service.query = jest.fn().mockResolvedValue({
        data: {
          productUpdate: {
            product: null,
            userErrors: [{ field: 'title', message: 'is blank' }]
          }
        }
      });

      await expect(
        service.updateProductFields('gid://shopify/Product/123', {
          title: '', vendor: null, descriptionHtml: '', productType: '',
          seoTitle: null, seoDescription: null, tags: []
        })
      ).rejects.toThrow('is blank');
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

  describe('staged image uploads', () => {
    it('derives safe filenames and normalizes image MIME types', () => {
      expect(service.buildImageFilename('https://source.test/media/My%20Photo.JPG?x=1')).toBe('My_Photo.JPG');
      expect(service.buildImageFilename('not a url')).toBe('not_a_url');
      expect(service.normalizeImageMimeType('IMAGE/PNG; charset=binary', 'photo.bin')).toBe('image/png');
      expect(service.normalizeImageMimeType('application/octet-stream', 'photo.webp')).toBe('image/webp');
      expect(service.normalizeImageMimeType(undefined, 'photo.unknown')).toBe('image/jpeg');
    });

    it('requests a PRODUCT_IMAGE staged target with byte size', async () => {
      service.query = jest.fn().mockResolvedValue({
        data: { stagedUploadsCreate: { stagedTargets: [{ url: 'https://upload.test', resourceUrl: 'https://cdn.test/staged.jpg', parameters: [] }], userErrors: [] } }
      });

      const target = await service.createStagedUpload('photo.jpg', 'image/jpeg', 123);

      expect(target.resourceUrl).toBe('https://cdn.test/staged.jpg');
      expect(service.query).toHaveBeenCalledWith(
        expect.stringContaining('stagedUploadsCreate'),
        { input: [{ resource: 'PRODUCT_IMAGE', filename: 'photo.jpg', mimeType: 'image/jpeg', httpMethod: 'POST', fileSize: '123' }] }
      );
    });

    it('fails when Shopify returns no staged target', async () => {
      service.query = jest.fn().mockResolvedValue({
        data: { stagedUploadsCreate: { stagedTargets: [], userErrors: [] } }
      });
      await expect(service.createStagedUpload('photo.jpg', 'image/jpeg', 123))
        .rejects.toThrow('did not return a staged upload target');
    });

    it('adds every returned parameter and the image bytes to multipart form data', async () => {
      const postSpy = jest.spyOn(axios, 'post').mockResolvedValue({ status: 204 });
      await service.uploadToStagedTarget({
        url: 'https://upload.test/signed',
        parameters: [{ name: 'key', value: 'uploads/photo.jpg' }, { name: 'policy', value: 'secret-policy' }]
      }, Buffer.from('image-bytes'), 'photo.jpg', 'image/jpeg');

      const [url, form, options] = postSpy.mock.calls[0];
      expect(url).toBe('https://upload.test/signed');
      const body = form.getBuffer().toString();
      expect(body).toContain('uploads/photo.jpg');
      expect(body).toContain('secret-policy');
      expect(body).toContain('image-bytes');
      expect(options.headers['content-type']).toContain('multipart/form-data');
      postSpy.mockRestore();
    });

    it('propagates a staged HTTP upload failure', async () => {
      const postSpy = jest.spyOn(axios, 'post').mockRejectedValue(new Error('upload rejected'));
      await expect(service.uploadToStagedTarget(
        { url: 'https://upload.test/signed', parameters: [] },
        Buffer.from('bytes'),
        'photo.jpg',
        'image/jpeg'
      )).rejects.toThrow('upload rejected');
      postSpy.mockRestore();
    });

    it('runs Magento download → staging → fileCreate(resourceUrl) → READY', async () => {
      const magentoUrl = 'https://magento.test/media/catalog/product/photo.jpg';
      const loader = jest.fn().mockResolvedValue({ buffer: Buffer.from('bytes'), contentType: 'image/jpeg' });
      jest.spyOn(axios, 'post').mockResolvedValue({ status: 204 });
      service.query = jest.fn().mockImplementation(async query => {
        if (query.includes('stagedUploadsCreate')) return { data: { stagedUploadsCreate: { stagedTargets: [{ url: 'https://upload.test', resourceUrl: 'https://staged.test/photo.jpg', parameters: [] }], userErrors: [] } } };
        if (query.includes('mutation fileCreate')) return { data: { fileCreate: { files: [{ id: 'gid://shopify/MediaImage/1', fileStatus: 'UPLOADED' }], userErrors: [] } } };
        return { data: { node: { id: 'gid://shopify/MediaImage/1', fileStatus: 'READY' } } };
      });

      const files = await service.uploadAndWaitForFiles([{ url: magentoUrl, alt: 'Photo', sku: 'SKU-1' }], loader);

      expect(loader).toHaveBeenCalledWith(magentoUrl);
      const fileCreateVariables = service.query.mock.calls.find(([query]) => query.includes('mutation fileCreate'))[1];
      expect(fileCreateVariables.files[0].originalSource).toBe('https://staged.test/photo.jpg');
      expect(fileCreateVariables.files[0].originalSource).not.toBe(magentoUrl);
      expect(files).toEqual([{ id: 'gid://shopify/MediaImage/1', alt: 'Photo', sku: 'SKU-1' }]);
      axios.post.mockRestore();
    });

    it('preserves null positions when one staged upload fails', async () => {
      jest.spyOn(service, 'stageImage')
        .mockRejectedValueOnce(new Error('download failed'))
        .mockResolvedValueOnce({ resourceUrl: 'https://staged.test/second.jpg' });
      jest.spyOn(service, 'createFile').mockResolvedValue({ id: 'gid://shopify/MediaImage/2', fileStatus: 'UPLOADED' });
      jest.spyOn(service, 'waitForFileReady').mockResolvedValue({ fileStatus: 'READY' });

      const result = await service.uploadAndWaitForFiles([
        { url: 'https://magento.test/first.jpg', sku: 'SKU-1' },
        { url: 'https://magento.test/second.jpg', sku: 'SKU-2' }
      ], jest.fn());

      expect(result).toEqual([null, { id: 'gid://shopify/MediaImage/2', alt: undefined, sku: 'SKU-2' }]);
      expect(service.createFile).toHaveBeenCalledWith('https://staged.test/second.jpg', undefined);
    });

    it('stages existing-product media and retains SKU ordering', async () => {
      jest.spyOn(service, 'stageImage')
        .mockResolvedValueOnce({ resourceUrl: 'https://staged.test/one.jpg' })
        .mockRejectedValueOnce(new Error('bad image'))
        .mockResolvedValueOnce({ resourceUrl: 'https://staged.test/three.jpg' });
      service.query = jest.fn().mockResolvedValue({
        data: { productCreateMedia: { media: [{ id: 'media-1' }, { id: 'media-3' }], mediaUserErrors: [] } }
      });
      jest.spyOn(service, 'waitForMediaReady').mockResolvedValue({ status: 'READY' });

      const result = await service.createProductMedia('product-1', [
        { url: 'magento-1', sku: 'SKU-1' },
        { url: 'magento-2', sku: 'SKU-2' },
        { url: 'magento-3', sku: 'SKU-3' }
      ], jest.fn());

      expect(service.query.mock.calls[0][1].media.map(media => media.originalSource)).toEqual([
        'https://staged.test/one.jpg', 'https://staged.test/three.jpg'
      ]);
      expect(result).toEqual([{ id: 'media-1', sku: 'SKU-1' }, { id: 'media-3', sku: 'SKU-3' }]);
    });
  });
});
