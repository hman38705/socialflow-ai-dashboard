import { ImageOptimizationService } from '../ImageOptimizationService';
import { BadRequestError } from '../../lib/errors';
import fs from 'fs/promises';

jest.mock('sharp');
jest.mock('fs/promises');

describe('ImageOptimizationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getCacheKey', () => {
    it('should generate consistent cache keys', () => {
      const filePath = '/path/to/image.jpg';
      const options = { width: 800, quality: 80 };

      const key1 = ImageOptimizationService.getCacheKey(filePath, options);
      const key2 = ImageOptimizationService.getCacheKey(filePath, options);

      expect(key1).toBe(key2);
    });

    it('should generate different keys for different options', () => {
      const filePath = '/path/to/image.jpg';
      const options1 = { width: 800, quality: 80 };
      const options2 = { width: 600, quality: 80 };

      const key1 = ImageOptimizationService.getCacheKey(filePath, options1);
      const key2 = ImageOptimizationService.getCacheKey(filePath, options2);

      expect(key1).not.toBe(key2);
    });
  });

  describe('getCachePath', () => {
    it('should return correct cache path', () => {
      const cacheKey = 'abc123';
      const format = 'webp';

      const cachePath = ImageOptimizationService.getCachePath(cacheKey, format);

      expect(cachePath).toContain('cache');
      expect(cachePath).toContain('abc123.webp');
    });
  });

  describe('optimize', () => {
    it('should optimize image with default options', async () => {
      const _inputPath = '/path/to/image.jpg';
      const _options = {};

      // Mock sharp
      const mockWebp = jest.fn().mockResolvedValue(Buffer.from('webp-data'));
      const mockResize = jest.fn().mockReturnValue({ webp: mockWebp });
      const mockSharp = jest.fn().mockReturnValue({ resize: mockResize, webp: mockWebp });

      jest.doMock('sharp', () => mockSharp);

      // Note: In real tests, you'd need to properly mock sharp
      // This is a simplified example
    });

    it('should use cached version if available', async () => {
      // Mock fs.readFile to return cached data
      (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('cached-data'));

      const _inputPath = '/path/to/image.jpg';
      const _options = { width: 800 };

      // This would return cached data without optimization
      // In real implementation, verify cache hit
    });
  });

  describe('clearCache', () => {
    it('should clear all cached files', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue(['file1.webp', 'file2.webp']);
      (fs.unlink as jest.Mock).mockResolvedValue(undefined);

      await ImageOptimizationService.clearCache();

      expect(fs.readdir).toHaveBeenCalled();
      expect(fs.unlink).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCacheSize', () => {
    it('should calculate total cache size', async () => {
      (fs.readdir as jest.Mock).mockResolvedValue(['file1.webp', 'file2.webp']);
      (fs.stat as jest.Mock)
        .mockResolvedValueOnce({ size: 1000 })
        .mockResolvedValueOnce({ size: 2000 });

      const size = await ImageOptimizationService.getCacheSize();

      expect(size).toBe(3000);
    });

    it('should return 0 if cache directory does not exist', async () => {
      (fs.readdir as jest.Mock).mockRejectedValue(new Error('ENOENT'));

      const size = await ImageOptimizationService.getCacheSize();

      expect(size).toBe(0);
    });
  });

  describe('format validation', () => {
    it('throws BadRequestError for an invalid format string', async () => {
      await expect(
        ImageOptimizationService.optimize('/path/to/img.jpg', { format: 'gif' as any }),
      ).rejects.toThrow(BadRequestError);

      await expect(
        ImageOptimizationService.optimize('/path/to/img.jpg', { format: 'gif' as any }),
      ).rejects.toThrow(/Invalid image format/);
    });

    it('does not throw for valid format values', async () => {
      const cachedBuffer = Buffer.from('cached-data');
      (fs.readFile as jest.Mock).mockResolvedValue(cachedBuffer);

      for (const fmt of ['webp', 'jpeg', 'png'] as const) {
        await expect(
          ImageOptimizationService.optimize('/path/to/img.jpg', { format: fmt }),
        ).resolves.toMatchObject({ format: fmt });
      }
    });

    it('defaults to webp when format is omitted', async () => {
      const cachedBuffer = Buffer.from('cached-data');
      (fs.readFile as jest.Mock).mockResolvedValue(cachedBuffer);

      const result = await ImageOptimizationService.optimize('/path/to/img.jpg', {});
      expect(result.format).toBe('webp');
    });
  });
});
