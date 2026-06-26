import { Router, Request, Response } from 'express';
import { analyzeImage, GeminiServiceError } from '../services/geminiService';
import { authMiddleware } from '../middleware/authMiddleware';
import { checkPermission } from '../middleware/checkPermission';

const router = Router();

/**
 * POST /ai/analyze-image
 * Accepts an image (base64 buffer or URL) and returns an AI-generated social media caption.
 * Requires authentication. Credits are deducted post-call proportional to token usage.
 *
 * Body:
 *   imageData   {string}  Base64-encoded image data or a public image URL (required)
 *   mimeType    {string}  MIME type, e.g. "image/jpeg" (optional, default: "image/jpeg")
 *   context     {string}  Optional prompt context to guide caption style/topic
 */
// Required permission: posts:create
router.post(
  '/analyze-image',
  authMiddleware,
  checkPermission('posts:create'),
  async (req: Request, res: Response) => {
    const { imageData, mimeType, context } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'imageData is required.' });
    }

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
