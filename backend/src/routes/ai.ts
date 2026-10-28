import { Router, Request, Response } from 'express';
import { analyzeImage, GeminiServiceError } from '../services/geminiService';
import { authenticate } from '../middleware/authenticate';
import { checkPermission } from '../middleware/checkPermission';
import { validate } from '../middleware/validate';
import { aiImageLimiter } from '../middleware/rateLimit';
import { analyzeImageSchema } from '../schemas/ai';

const router = Router();

/**
 * POST /ai/analyze-image
 * Accepts an image (base64 buffer or URL) and returns an AI-generated social media caption.
 * Requires authentication. Credits are deducted post-call proportional to token usage.
 *
 * Body (validated via analyzeImageSchema):
 *   imageData   {string}  Base64-encoded image data or a public image URL (required)
 *   mimeType    {string}  MIME type — image/jpeg | image/png | image/gif | image/webp (default: image/jpeg)
 *   context     {string}  Optional prompt context (max 500 chars) to guide caption style/topic
 */
// Required permission: posts:create
router.post(
  '/analyze-image',
  authenticate,
  aiImageLimiter,
  checkPermission('posts:create'),
  validate(analyzeImageSchema),
  async (req: Request, res: Response) => {
    const { imageData, mimeType, context } = req.body;

    try {
      const caption = await analyzeImage(imageData, mimeType, context);
      return res.json({ caption });
    } catch (error) {
      if (error instanceof GeminiServiceError) {
        return res.status(422).json({ error: error.message, code: error.code });
      }
      return res.status(500).json({ error: 'Internal server error.' });
    }
  },
);

export default router;
