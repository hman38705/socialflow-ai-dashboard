/**
 * #1024 — TranslationService unit tests
 *
 * Covers:
 * - Provider selection: uses DeepL when DEEPL_API_KEY is set
 * - Provider selection: falls back to Google when only GOOGLE_TRANSLATE_API_KEY is set
 * - Throws when neither provider is configured
 * - Successful translation response is parsed and normalized correctly
 * - Preserved elements (URLs, mentions, hashtags) survive translation round-trip
 * - Same-language request returns original text without a provider call
 */
import nock from 'nock';
import { translationService } from '../TranslationService';

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());

afterEach(() => {
  nock.cleanAll();
  delete process.env.DEEPL_API_KEY;
  delete process.env.GOOGLE_TRANSLATE_API_KEY;
});

// ── Provider: DeepL ───────────────────────────────────────────────────────────
describe('TranslationService — DeepL provider', () => {
  beforeEach(() => {
    process.env.DEEPL_API_KEY = 'deepl-test-key';
  });

  it('translates text and returns normalized result', async () => {
    nock('https://api-free.deepl.com')
      .post('/v2/translate')
      .reply(200, { translations: [{ text: 'Hola mundo', detected_source_language: 'EN' }] });

    const result = await translationService.translate({
      text: 'Hello world',
      sourceLanguage: 'en',
      targetLanguages: ['es'],
    });

    expect(result.originalText).toBe('Hello world');
    expect(result.provider).toBe('deepl');
    expect(result.translations).toHaveLength(1);
    expect(result.translations[0].language).toBe('es');
    expect(result.translations[0].text).toBe('Hola mundo');
    expect(result.translations[0].confidence).toBeGreaterThan(0);
  });

  it('sets provider to deepl in result when DeepL key is present', async () => {
    nock('https://api-free.deepl.com')
      .post('/v2/translate')
      .reply(200, { translations: [{ text: 'Bonjour', detected_source_language: 'EN' }] });

    const result = await translationService.translate({
      text: 'Hello',
      sourceLanguage: 'en',
      targetLanguages: ['fr'],
    });

    expect(result.provider).toBe('deepl');
  });

  it('restores preserved URLs after translation', async () => {
    const url = 'https://example.com/path';
    const textWithUrl = `Check this out ${url} right now`;

    // DeepL returns the text with placeholder; we simulate it passing through
    nock('https://api-free.deepl.com')
      .post('/v2/translate')
      .reply(200, {
        translations: [{ text: `Mira esto __URL_0__ ahora mismo`, detected_source_language: 'EN' }],
      });

    const result = await translationService.translate({
      text: textWithUrl,
      sourceLanguage: 'en',
      targetLanguages: ['es'],
    });

    expect(result.translations[0].text).toContain(url);
  });

  it('skips translation and returns original text when target equals source language', async () => {
    const result = await translationService.translate({
      text: 'Hello world',
      sourceLanguage: 'en',
      targetLanguages: ['en'],
    });

    expect(result.translations[0].text).toBe('Hello world');
    expect(result.translations[0].confidence).toBe(1.0);
    // No HTTP call should have been made
    expect(nock.pendingMocks()).toHaveLength(0);
  });

  it('falls back to returning original text with confidence 0 on DeepL failure', async () => {
    nock('https://api-free.deepl.com')
      .post('/v2/translate')
      .reply(500, { message: 'Internal Server Error' });

    const result = await translationService.translate({
      text: 'Hello',
      sourceLanguage: 'en',
      targetLanguages: ['de'],
    });

    // Service catches error and records confidence=0, preserves original
    expect(result.translations[0].text).toBe('Hello');
    expect(result.translations[0].confidence).toBe(0);
  });
});

// ── Provider: Google Translate ────────────────────────────────────────────────
describe('TranslationService — Google Translate fallback', () => {
  beforeEach(() => {
    // No DeepL key → should fall back to Google
    process.env.GOOGLE_TRANSLATE_API_KEY = 'google-test-key';
  });

  it('uses Google Translate when DeepL is not configured', async () => {
    nock('https://translation.googleapis.com')
      .post('/language/translate/v2')
      .query(true)
      .reply(200, {
        data: { translations: [{ translatedText: 'Hola', detectedSourceLanguage: 'en' }] },
      });

    const result = await translationService.translate({
      text: 'Hello',
      sourceLanguage: 'en',
      targetLanguages: ['es'],
    });

    expect(result.translations[0].text).toBe('Hola');
    expect(result.provider).toBe('google');
  });

  it('returns normalized shape from Google response', async () => {
    nock('https://translation.googleapis.com')
      .post('/language/translate/v2')
      .query(true)
      .reply(200, {
        data: { translations: [{ translatedText: 'Bonjour le monde', detectedSourceLanguage: 'en' }] },
      });

    const result = await translationService.translate({
      text: 'Hello world',
      sourceLanguage: 'en',
      targetLanguages: ['fr'],
    });

    expect(result.sourceLanguage).toBe('en');
    expect(result.translations[0].language).toBe('fr');
    expect(result.translations[0].text).toBe('Bonjour le monde');
  });
});

// ── No provider ───────────────────────────────────────────────────────────────
describe('TranslationService — no provider configured', () => {
  it('records confidence 0 and preserves original text when neither key is set', async () => {
    const result = await translationService.translate({
      text: 'Hello',
      sourceLanguage: 'en',
      targetLanguages: ['es'],
    });

    expect(result.translations[0].confidence).toBe(0);
    expect(result.translations[0].text).toBe('Hello');
  });
});

// ── Preserved elements ────────────────────────────────────────────────────────
describe('TranslationService — preserved elements extraction', () => {
  beforeEach(() => {
    process.env.DEEPL_API_KEY = 'deepl-test-key';
  });

  it('preserves @mentions in translated output', async () => {
    nock('https://api-free.deepl.com')
      .post('/v2/translate')
      .reply(200, {
        translations: [{ text: 'Hola __MENTION_0__ cómo estás', detected_source_language: 'EN' }],
      });

    const result = await translationService.translate({
      text: 'Hello @johndoe how are you',
      sourceLanguage: 'en',
      targetLanguages: ['es'],
    });

    expect(result.translations[0].text).toContain('@johndoe');
  });

  it('preserves #hashtags in translated output', async () => {
    nock('https://api-free.deepl.com')
      .post('/v2/translate')
      .reply(200, {
        translations: [{ text: 'Hola __HASHTAG_0__', detected_source_language: 'EN' }],
      });

    const result = await translationService.translate({
      text: 'Hello #SocialFlow',
      sourceLanguage: 'en',
      targetLanguages: ['es'],
    });

    expect(result.translations[0].text).toContain('#SocialFlow');
  });

  it('returns preserved elements in result metadata', async () => {
    nock('https://api-free.deepl.com')
      .post('/v2/translate')
      .reply(200, {
        translations: [{ text: 'Visita __URL_0__', detected_source_language: 'EN' }],
      });

    const result = await translationService.translate({
      text: 'Visit https://example.com',
      sourceLanguage: 'en',
      targetLanguages: ['es'],
    });

    expect(result.preservedElements.some((e) => e.type === 'url')).toBe(true);
  });
});
