import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { createLogger } from '../lib/logger';
import { BadRequestError } from '../lib/errors';

const logger = createLogger('image-optimization');
const CACHE_DIR = path.join(process.cwd(), 'uploads', 'images', 'cache');

const VALID_FORMATS = ['webp', 'jpeg', 'png'] as const;

function isValidImageFormat(value: unknown): value is 'webp' | 'jpeg' | 'png' {
  return typeof value === 'string' && (VALID_FORMATS as readonly string[]).includes(value);
}

interface OptimizationOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png';
}

export const ImageOptimizationService = {
  /**
   * Initialize cache directory
   */
  init: async (): Promise<void> => {
    try {
      await fs.mkdir(CACHE_DIR, { recursive: true });
    } catch (error) {
      logger.error('Failed to create cache directory:', error);
    }
  },

  /**
   * Generate cache key from file path and options
   */
  getCacheKey: (filePath: string, options: OptimizationOptions): string => {
    const hash = crypto
      .createHash('md5')
      .update(filePath + JSON.stringify(options))
      .digest('hex');
    return hash;
  },

  /**
   * Get cached file path
   */
  getCachePath: (cacheKey: string, format: string): string => {
    return path.join(CACHE_DIR, `${cacheKey}.${format}`);
  },

  /**
   * Optimize image to WebP with optional resizing
   */
  optimizeToWebP: async (inputPath: string, options: OptimizationOptions = {}): Promise<Buffer> => {
    const { width, height, quality = 80 } = options;

    let transform = sharp(inputPath);

    if (width || height) {
      transform = transform.resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    return transform.webp({ quality }).toBuffer();
  },

  /**
   * Optimize image with caching
   */
  optimize: async (
    inputPath: string,
    options: OptimizationOptions = {},
  ): Promise<{ buffer: Buffer; format: string; cacheKey: string; etag: string }> => {
    if (options.format !== undefined && !isValidImageFormat(options.format)) {
      throw new BadRequestError(
        `Invalid image format "${options.format}". Allowed formats: webp, jpeg, png`,
      );
    }

    const format = options.format || 'webp';
    const cacheKey = ImageOptimizationService.getCacheKey(inputPath, options);
    const cachePath = ImageOptimizationService.getCachePath(cacheKey, format);

    // Check cache
    try {
      const cached = await fs.readFile(cachePath);
      const etag = `"${crypto.createHash('sha256').update(cached).digest('hex')}"`;
      return { buffer: cached, format, cacheKey, etag };
    } catch {
      // Cache miss, proceed with optimization
    }

    // Optimize
    const { width, height, quality = 80 } = options;
    let transform = sharp(inputPath);

    if (width || height) {
      transform = transform.resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    let buffer: Buffer;
    if (format === 'webp') {
      buffer = await transform.webp({ quality }).toBuffer();
    } else if (format === 'jpeg') {
      buffer = await transform.jpeg({ quality }).toBuffer();
    } else if (format === 'png') {
      buffer = await transform.png({ compressionLevel: 9 }).toBuffer();
    } else {
      buffer = await transform.toBuffer();
    }

    // Cache result
    try {
      await fs.writeFile(cachePath, buffer);
    } catch (error) {
      logger.error('Failed to cache optimized image:', error);
    }

    const etag = `"${crypto.createHash('sha256').update(buffer).digest('hex')}"`;
    return { buffer, format, cacheKey, etag };
  },

  /**
   * Get image metadata
   */
  getMetadata: async (inputPath: string) => {
    return sharp(inputPath).metadata();
  },

  /**
   * Batch optimize images
   */
  optimizeBatch: async (
    inputPaths: string[],
    options: OptimizationOptions = {},
  ): Promise<Array<{ path: string; buffer: Buffer; format: string }>> => {
    return Promise.all(
      inputPaths.map(async (inputPath) => {
        const { buffer, format } = await ImageOptimizationService.optimize(inputPath, options);
        return { path: inputPath, buffer, format };
      }),
    );
  },

  /**
   * Clear cache
   */
  clearCache: async (): Promise<void> => {
    try {
      const files = await fs.readdir(CACHE_DIR);
      await Promise.all(files.map((file) => fs.unlink(path.join(CACHE_DIR, file))));
    } catch (error) {
      logger.error('Failed to clear cache:', error);
    }
  },

  /**
   * Get cache size in bytes
   */
  getCacheSize: async (): Promise<number> => {
    try {
      const files = await fs.readdir(CACHE_DIR);
      const sizes = await Promise.all(
        files.map(async (file) => {
          const stat = await fs.stat(path.join(CACHE_DIR, file));
          return stat.size;
        }),
      );
      return sizes.reduce((a, b) => a + b, 0);
    } catch {
      return 0;
    }
  },
};
