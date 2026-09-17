'use strict';

const ImageService = require('../../src/services/image.service');

describe('ImageService.migrateProductImages', () => {
  it('uploads each source file only once per product', async () => {
    const service = new ImageService({}, {});
    jest.spyOn(service, 'downloadImage').mockImplementation(async file => ({
      buffer: Buffer.from(file),
      contentType: 'image/jpeg'
    }));
    jest.spyOn(service, 'uploadToProduct').mockResolvedValue('image-id');

    const result = await service.migrateProductImages('SKU-1', [
      { file: '/a/shared.jpg', label: 'First' },
      { file: '/a/shared.jpg', label: 'Duplicate' },
      { file: '/a/other.jpg', label: 'Other' }
    ]);

    expect(service.downloadImage).toHaveBeenCalledTimes(2);
    expect(service.uploadToProduct).toHaveBeenCalledTimes(2);
    expect(result.success).toHaveLength(2);
  });

  it('skips byte-identical content even when source filenames differ', async () => {
    const service = new ImageService({}, {});
    jest.spyOn(service, 'downloadImage').mockResolvedValue({
      buffer: Buffer.from('same-image'),
      contentType: 'image/jpeg'
    });
    jest.spyOn(service, 'uploadToProduct').mockResolvedValue('image-id');

    const result = await service.migrateProductImages('SKU-1', [
      { file: '/a/first.jpg' },
      { file: '/b/second.jpg' }
    ]);

    expect(service.downloadImage).toHaveBeenCalledTimes(2);
    expect(service.uploadToProduct).toHaveBeenCalledTimes(1);
    expect(result.skippedDuplicates).toEqual([
      { file: '/b/second.jpg', reason: 'duplicate-content' }
    ]);
  });
});
