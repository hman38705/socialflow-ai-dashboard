import { Router, Request, Response } from 'express';
import { authenticate as authMiddleware } from '../middleware/authenticate';
import { checkPermission } from '../middleware/checkPermission';
import { translationService } from '../services/TranslationService';

const router = Router();

/**
 * @openapi
 * /translation/translate:
 *   post:
 *     tags: [Translation]
 *     summary: Translate content to one or more languages
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text, targetLanguages]
 *             properties:
 *               text:
 *                 type: string
 *               sourceLanguage:
 *                 type: string
 *                 description: BCP-47 language code (auto-detected if omitted)
 *               targetLanguages:
 *                 type: array
 *                 items:
 *                   type: string
 *                 minItems: 1
 *               preserveFormatting:
 *                 type: boolean
 *               preserveHashtags:
 *                 type: boolean
 *               preserveMentions:
 *                 type: boolean
 *               preserveUrls:
 *                 type: boolean
 *               preserveEmojis:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Translation result
 *       400:
 *         description: Validation error
 *       500:
 *         description: Translation failed
 */
// Required permission: posts:create
router.post('/translate', authMiddleware, checkPermission('posts:create'), async (req: Request, res: Response) => {
  try {
    const {
      text,
      sourceLanguage,
      targetLanguages,
      preserveFormatting,
      preserveHashtags,
      preserveMentions,
      preserveUrls,
      preserveEmojis,
    } = req.body;

    if (!text || !targetLanguages || !Array.isArray(targetLanguages)) {
      return res.status(400).json({
        error: 'Text and targetLanguages array are required',
      });
    }

    if (targetLanguages.length === 0) {
      return res.status(400).json({
        error: 'At least one target language is required',
      });
    }

    const result = await translationService.translate({
      text,
      sourceLanguage,
      targetLanguages,
      preserveFormatting,
      preserveHashtags,
      preserveMentions,
      preserveUrls,
      preserveEmojis,
    });

    res.json(result);
  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ error: 'Failed to translate content' });
  }
});

/**
 * @openapi
 * /translation/languages:
 *   get:
 *     tags: [Translation]
 *     summary: Get list of supported languages
 *     security: []
 *     responses:
 *       200:
 *         description: Supported languages
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 languages:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       code: { type: string }
 *                       name: { type: string }
 */
router.get('/languages', (req: Request, res: Response) => {
  try {
    const languages = translationService.getSupportedLanguages();
    res.json({ languages });
  } catch (error) {
    console.error('Languages error:', error);
    res.status(500).json({ error: 'Failed to get languages' });
  }
});

/**
 * @openapi
 * /translation/detect:
 *   post:
 *     tags: [Translation]
 *     summary: Detect the language of a text
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *     responses:
 *       200:
 *         description: Detected language
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 detectedLanguage: { type: string }
 *                 languageName: { type: string }
 *       400:
 *         description: Text is required
 */
// Required permission: posts:create
router.post('/detect', authMiddleware, checkPermission('posts:create'), async (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    // Use the translation service's detection logic
    const result = await translationService.translate({
      text,
      targetLanguages: ['en'], // Dummy target to trigger detection
    });

    res.json({
      detectedLanguage: result.sourceLanguage,
      languageName:
        translationService.getSupportedLanguages().find((l) => l.code === result.sourceLanguage)
          ?.name || result.sourceLanguage,
    });
  } catch (error) {
    console.error('Detection error:', error);
    res.status(500).json({ error: 'Failed to detect language' });
  }
});

/**
 * @openapi
 * /translation/batch:
 *   post:
 *     tags: [Translation]
 *     summary: Translate multiple texts at once
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [texts, targetLanguages]
 *             properties:
 *               texts:
 *                 type: array
 *                 items:
 *                   type: string
 *               sourceLanguage:
 *                 type: string
 *               targetLanguages:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Batch translation results
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 translations:
 *                   type: array
 *                 totalTexts: { type: integer }
 *                 duration: { type: integer }
 *       400:
 *         description: Validation error
 */
// Required permission: posts:create
router.post('/batch', authMiddleware, checkPermission('posts:create'), async (req: Request, res: Response) => {
  try {
    const { texts, sourceLanguage, targetLanguages } = req.body;

    if (!Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({ error: 'Texts array is required' });
    }

    if (!Array.isArray(targetLanguages) || targetLanguages.length === 0) {
      return res.status(400).json({ error: 'Target languages array is required' });
    }

    const startTime = Date.now();
    const results = [];

    for (const text of texts) {
      const result = await translationService.translate({
        text,
        sourceLanguage,
        targetLanguages,
      });
      results.push(result);
    }

    const duration = Date.now() - startTime;

    res.json({
      translations: results,
      totalTexts: texts.length,
      duration,
    });
  } catch (error) {
    console.error('Batch translation error:', error);
    res.status(500).json({ error: 'Failed to translate batch' });
  }
});

/**
 * @openapi
 * /translation/providers:
 *   get:
 *     tags: [Translation]
 *     summary: Get available translation providers and their status
 *     security: []
 *     responses:
 *       200:
 *         description: Provider list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 providers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name: { type: string }
 *                       available: { type: boolean }
 *                       characterLimit: { type: integer }
 *                       languages:
 *                         type: array
 *                         items:
 *                           type: string
 */
router.get('/providers', (req: Request, res: Response) => {
  try {
    const providers = [
      {
        name: 'DeepL',
        available: !!process.env.DEEPL_API_KEY,
        characterLimit: 5000,
        languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'zh', 'nl', 'pl'],
      },
      {
        name: 'Google Translate',
        available: !!process.env.GOOGLE_TRANSLATE_API_KEY,
        characterLimit: 100000,
        languages: translationService.getSupportedLanguages().map((l) => l.code),
      },
    ];

    res.json({ providers });
  } catch (error) {
    console.error('Providers error:', error);
    res.status(500).json({ error: 'Failed to get providers' });
  }
});

export default router;
