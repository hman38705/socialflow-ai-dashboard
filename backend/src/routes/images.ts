import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import { authenticate as authMiddleware } from '../middleware/authenticate';
import { checkPermission } from '../middleware/checkPermission';
import { ImageOptimizationService } from '../services/ImageOptimizationService';

const router = Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'images');
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image format'));
    }
  },
});

/**
 * @openapi
 * /images/upload:
 *   post:
 *     tags: [Images]
 *     summary: Upload and optimize an image
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Image file (jpeg, png, webp, gif — max 50 MB)
 *     parameters:
 *       - in: query
 *         name: width
 *         schema:
 *           type: integer
 *       - in: query
 *         name: height
 *         schema:
 *           type: integer
 *       - in: query
 *         name: quality
 *         schema:
 *           type: integer
 *           default: 80
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [webp, jpeg, png]
 *           default: webp
 *     responses:
 *       200:
 *         description: Optimized image binary
 *         content:
 *           image/*:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: No image provided
 */
// Required permission: posts:create
router.post('/upload', authMiddleware, checkPermission('posts:create'), upload.single('image'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const { width, height, quality, format } = req.query;
    const options = {
      width: width ? parseInt(width as string) : undefined,
      height: height ? parseInt(height as string) : undefined,
      quality: quality ? parseInt(quality as string) : 80,
      format: (format as 'webp' | 'jpeg' | 'png') || 'webp',
    };

    const {
      buffer,
      format: resultFormat,
      cacheKey,
      etag,
    } = await ImageOptimizationService.optimize(req.file.path, options);

    res.setHeader('Content-Type', `image/${resultFormat}`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', etag);
    res.setHeader('X-Cache-Key', cacheKey);
    res.send(buffer);
  } catch (error) {
    console.error('Image optimization error:', error);
    res.status(500).json({ error: 'Failed to optimize image' });
  }
});

/**
 * @openapi
 * /images/proxy:
 *   get:
 *     tags: [Images]
 *     summary: Proxy and optimize an image from a file path
 *     parameters:
 *       - in: query
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Relative path under uploads/
 *       - in: query
 *         name: width
 *         schema:
 *           type: integer
 *       - in: query
 *         name: height
 *         schema:
 *           type: integer
 *       - in: query
 *         name: quality
 *         schema:
 *           type: integer
 *           default: 80
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [webp, jpeg, png]
 *           default: webp
 *     responses:
 *       200:
 *         description: Optimized image binary
 *         content:
 *           image/*:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Missing or invalid path
 */
router.get('/proxy', async (req: Request, res: Response) => {
  try {
    const { path: imagePath, width, height, quality, format } = req.query;

    if (!imagePath || typeof imagePath !== 'string') {
      return res.status(400).json({ error: 'path parameter required' });
    }

    // Security: prevent directory traversal
    const normalizedPath = path.normalize(imagePath);
    if (normalizedPath.includes('..')) {
      return res.status(400).json({ error: 'Invalid path' });
    }

    const fullPath = path.join(process.cwd(), 'uploads', normalizedPath);

    const options = {
      width: width ? parseInt(width as string) : undefined,
      height: height ? parseInt(height as string) : undefined,
      quality: quality ? parseInt(quality as string) : 80,
      format: (format as 'webp' | 'jpeg' | 'png') || 'webp',
    };

    const {
      buffer,
      format: resultFormat,
      cacheKey,
      etag,
    } = await ImageOptimizationService.optimize(fullPath, options);

    res.setHeader('Content-Type', `image/${resultFormat}`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', etag);
    res.setHeader('X-Cache-Key', cacheKey);
    res.send(buffer);
  } catch (error) {
    console.error('Image proxy error:', error);
    res.status(500).json({ error: 'Failed to proxy image' });
  }
});

/**
 * @openapi
 * /images/cache/size:
 *   get:
 *     tags: [Images]
 *     summary: Get image cache size
 *     responses:
 *       200:
 *         description: Cache size in bytes and MB
 */
router.get('/cache/size', async (req: Request, res: Response) => {
  try {
    const size = await ImageOptimizationService.getCacheSize();
    res.json({ cacheSize: size, cacheSizeMB: (size / 1024 / 1024).toFixed(2) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get cache size' });
  }
});

/**
 * @openapi
 * /images/cache:
 *   delete:
 *     tags: [Images]
 *     summary: Clear the image optimization cache
 *     responses:
 *       200:
 *         description: Cache cleared
 */
// Required permission: settings:manage
router.delete('/cache', authMiddleware, checkPermission('settings:manage'), async (req: Request, res: Response) => {
  try {
    await ImageOptimizationService.clearCache();
    res.json({ message: 'Cache cleared' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

export default router;
