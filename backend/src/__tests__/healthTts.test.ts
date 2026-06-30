/**
 * Tests for the /health endpoint's `features.tts` field (#1035).
 * Verifies the top-level ES import of config is used correctly.
 */
import request from 'supertest';

describe('GET /health — tts feature flag', () => {
  const originalElevenLabs = process.env.ELEVENLABS_API_KEY;
  const originalGoogleTts = process.env.GOOGLE_TTS_API_KEY;

  afterEach(() => {
    // Restore original env values
    process.env.ELEVENLABS_API_KEY = originalElevenLabs;
    process.env.GOOGLE_TTS_API_KEY = originalGoogleTts;
    jest.resetModules();
  });

  it('returns tts: "available" when ELEVENLABS_API_KEY is set', async () => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
    delete process.env.GOOGLE_TTS_API_KEY;
    jest.resetModules();
    const app = (await import('../app')).default;
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.features.tts).toBe('available');
  });

  it('returns tts: "available" when GOOGLE_TTS_API_KEY is set', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    process.env.GOOGLE_TTS_API_KEY = 'test-key';
    jest.resetModules();
    const app = (await import('../app')).default;
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.features.tts).toBe('available');
  });

  it('returns tts: "unavailable" when neither TTS key is set', async () => {
    delete process.env.ELEVENLABS_API_KEY;
    delete process.env.GOOGLE_TTS_API_KEY;
    jest.resetModules();
    const app = (await import('../app')).default;
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.features.tts).toBe('unavailable');
  });
});
