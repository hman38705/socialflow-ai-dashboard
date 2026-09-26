import { Router, Request, Response } from 'express';
import { translationService } from '../../services/TranslationService';
import { authMiddleware } from '../../middleware/authMiddleware';
import { translationLimiter, TRANSLATION_BATCH_MAX_TEXTS } from '../../shared/middleware/authRateLimiters';

const router = Router();

router.use(authMiddleware, translationLimiter);

/**
 * POST /api/translation/translate
 * Translate content to multiple languages
 */
router.post('/translate', async (req: Request, res: Response) => {
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
 * GET /api/translation/languages
 * Get list of supported languages
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
 * POST /api/translation/detect
 * Detect language of text
 */
router.post('/detect', async (req: Request, res: Response) => {
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
 * POST /api/translation/batch
 * Translate multiple texts at once
 */
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { texts, sourceLanguage, targetLanguages } = req.body;

    if (!Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({ error: 'Texts array is required' });
    }

    if (texts.length > TRANSLATION_BATCH_MAX_TEXTS) {
      return res
        .status(400)
        .json({ error: `texts may contain at most ${TRANSLATION_BATCH_MAX_TEXTS} items` });
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
 * GET /api/translation/providers
 * Get available translation providers and their status
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
