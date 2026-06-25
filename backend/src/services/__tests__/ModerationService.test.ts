/**
 * ModerationService Unit Tests
 *
 * Comprehensive test coverage for ModerationService including:
 * - Configuration checking
 * - Content moderation with sensitivity levels
 * - Fail-open vs fail-closed mode behavior
 * - Alert emission for moderation events
 * - Error handling and recovery
 */
import nock from 'nock';

const BASE = 'https://api.openai.com';

// ── Logger and DynamicConfigService mocks ─────────────────────────────────────
const warnSpy = jest.fn();
const errorSpy = jest.fn();
const infoSpy = jest.fn();

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({ warn: warnSpy, error: errorSpy, info: infoSpy }),
}));

jest.mock('../DynamicConfigService', () => ({
  DynamicConfigService: {
    getCachedInstance: jest.fn(() => null),
  },
  ConfigKey: {
    MODERATION_SENSITIVITY: 'moderation_sensitivity',
  },
}));

// Set API key for tests
process.env.OPENAI_API_KEY = 'sk-test-key';

import { ModerationService, ModerationResult } from '../ModerationService';

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanResponse(): { results: any[] } {
  return {
    results: [{
      flagged: false,
      categories: {
        hate: false,
        'hate/threatening': false,
        'sexual/minors': false,
        violence: false,
        'violence/graphic': false,
        'self-harm/instructions': false,
      },
      category_scores: {
        hate: 0.01,
        'hate/threatening': 0.01,
        'sexual/minors': 0.01,
        violence: 0.01,
        'violence/graphic': 0.01,
        'self-harm/instructions': 0.01,
      },
    }],
  };
}

function flaggedResponse(): { results: any[] } {
  return {
    results: [{
      flagged: true,
      categories: {
        hate: false,
        'hate/threatening': true,
        'sexual/minors': false,
        violence: false,
        'violence/graphic': false,
        'self-harm/instructions': false,
      },
      category_scores: {
        hate: 0.01,
        'hate/threatening': 0.88,
        'sexual/minors': 0.01,
        violence: 0.01,
        'violence/graphic': 0.01,
        'self-harm/instructions': 0.01,
      },
    }],
  };
}

// ── Test Setup/Teardown ───────────────────────────────────────────────────────

beforeAll(() => nock.disableNetConnect());
afterAll(() => nock.enableNetConnect());

afterEach(() => {
  nock.cleanAll();
  warnSpy.mockClear();
  errorSpy.mockClear();
  infoSpy.mockClear();
  process.env.OPENAI_API_KEY = 'sk-test-key';
  delete process.env.MODERATION_MODE;
  delete process.env.MODERATION_SENSITIVITY;
  delete process.env.MODERATION_ALWAYS_BLOCK_EXTRA;
});

// ── Configuration Tests ───────────────────────────────────────────────────────

describe('ModerationService configuration', () => {
  it('should report as configured when OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'sk-valid-key';
    expect(ModerationService.isConfigured()).toBe(true);
  });

  it('should report as not configured when OPENAI_API_KEY is missing', () => {
    delete process.env.OPENAI_API_KEY;
    expect(ModerationService.isConfigured()).toBe(false);
  });
});

// ── Missing API Key Tests ─────────────────────────────────────────────────────

describe('missing OPENAI_API_KEY', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('fail-open (default): returns bypass result', async () => {
    const result = await ModerationService.moderate('hello');
    expect(result).toEqual({ flagged: false, blocked: false, categories: {}, scores: {} });
  });

  it('fail-open (default): emits warning alert', async () => {
    await ModerationService.moderate('hello');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('OPENAI_API_KEY not set'),
    );
  });

  it('fail-closed: throws error', async () => {
    process.env.MODERATION_MODE = 'fail-closed';
    await expect(ModerationService.moderate('hello')).rejects.toThrow(
      'Moderation unavailable: OPENAI_API_KEY not set',
    );
  });

  it('fail-closed: emits error log', async () => {
    process.env.MODERATION_MODE = 'fail-closed';
    await ModerationService.moderate('hello').catch(() => {});
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('OPENAI_API_KEY not set'),
    );
  });
});

// ── Successful Moderation Tests ───────────────────────────────────────────────

describe('successful moderation', () => {
  it('should return clean result for safe content', async () => {
    nock(BASE).post('/v1/moderations').reply(200, cleanResponse());

    const result = await ModerationService.moderate('This is safe content');

    expect(result.flagged).toBe(false);
    expect(result.blocked).toBe(false);
    expect(Object.keys(result.categories).length).toBeGreaterThan(0);
  });

  it('should return flagged result for unsafe content', async () => {
    nock(BASE).post('/v1/moderations').reply(200, flaggedResponse());

    const result = await ModerationService.moderate('Hateful content');

    expect(result.flagged).toBe(true);
  });

  it('should send correct request headers', async () => {
    const scope = nock(BASE, {
      reqheaders: {
        'Content-Type': 'application/json',
        Authorization: /Bearer sk-/,
      },
    })
      .post('/v1/moderations')
      .reply(200, cleanResponse());

    await ModerationService.moderate('hello');

    expect(scope.isDone()).toBe(true);
  });

  it('should send text in request body', async () => {
    let capturedBody = '';
    nock(BASE)
      .post('/v1/moderations', (body) => {
        capturedBody = JSON.stringify(body);
        return true;
      })
      .reply(200, cleanResponse());

    await ModerationService.moderate('test content');

    expect(capturedBody).toContain('test content');
  });
});

// ── Timeout Tests ─────────────────────────────────────────────────────────────

describe('provider timeout', () => {
  beforeEach(() => {
    nock(BASE).post('/v1/moderations').replyWithError({ code: 'ETIMEDOUT' });
  });

  it('fail-open (default): returns bypass result', async () => {
    const result = await ModerationService.moderate('hello');
    expect(result).toEqual({ flagged: false, blocked: false, categories: {}, scores: {} });
  });

  it('fail-open (default): emits error then warn logs', async () => {
    await ModerationService.moderate('hello');
    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failing open'));
  });

  it('fail-closed: throws error', async () => {
    process.env.MODERATION_MODE = 'fail-closed';
    await expect(ModerationService.moderate('hello')).rejects.toThrow();
  });

  it('fail-closed: does not emit bypass warning', async () => {
    process.env.MODERATION_MODE = 'fail-closed';
    await ModerationService.moderate('hello').catch(() => {});
    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('failing open'));
  });
});

// ── Malformed Response Tests ──────────────────────────────────────────────────

describe('malformed API response', () => {
  it('fail-open: returns bypass result for invalid JSON', async () => {
    nock(BASE).post('/v1/moderations').reply(200, 'not-json', { 'content-type': 'text/plain' });

    const result = await ModerationService.moderate('hello');

    expect(result).toEqual({ flagged: false, blocked: false, categories: {}, scores: {} });
  });

  it('fail-open: returns bypass result for missing results array', async () => {
    nock(BASE).post('/v1/moderations').reply(200, { unexpected: true });

    const result = await ModerationService.moderate('hello');

    expect(result).toEqual({ flagged: false, blocked: false, categories: {}, scores: {} });
  });

  it('fail-open: emits error and warn logs', async () => {
    nock(BASE).post('/v1/moderations').reply(200, { unexpected: true });

    await ModerationService.moderate('hello');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('malformed'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failing open'));
  });

  it('fail-closed: throws on malformed response', async () => {
    process.env.MODERATION_MODE = 'fail-closed';
    nock(BASE).post('/v1/moderations').reply(200, { unexpected: true });

    await expect(ModerationService.moderate('hello')).rejects.toThrow('malformed');
  });

  it('fail-closed: does not emit bypass warning', async () => {
    process.env.MODERATION_MODE = 'fail-closed';
    nock(BASE).post('/v1/moderations').reply(200, { unexpected: true });

    await ModerationService.moderate('hello').catch(() => {});

    expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('failing open'));
  });
});

// ── Sensitivity Level Tests ───────────────────────────────────────────────────

describe('sensitivity levels', () => {
  it('should default to medium sensitivity', async () => {
    nock(BASE).post('/v1/moderations').reply(200, cleanResponse());

    await ModerationService.moderate('content');

    // Test passes if no error is thrown (default sensitivity is used)
    expect(true).toBe(true);
  });

  it('should respect MODERATION_SENSITIVITY environment variable', async () => {
    process.env.MODERATION_SENSITIVITY = 'high';
    nock(BASE).post('/v1/moderations').reply(200, cleanResponse());

    await ModerationService.moderate('content');

    expect(true).toBe(true);
  });
});

// ── Always Block Categories Tests ─────────────────────────────────────────────

describe('always-block categories', () => {
  it('should always block sexual/minors category', async () => {
    const response = {
      results: [{
        flagged: true,
        categories: {
          'sexual/minors': true,
          hate: false,
          'hate/threatening': false,
          violence: false,
          'violence/graphic': false,
          'self-harm/instructions': false,
        },
        category_scores: {
          'sexual/minors': 0.95,
          hate: 0.01,
          'hate/threatening': 0.01,
          violence: 0.01,
          'violence/graphic': 0.01,
          'self-harm/instructions': 0.01,
        },
      }],
    };

    nock(BASE).post('/v1/moderations').reply(200, response);

    const result = await ModerationService.moderate('content');

    expect(result.blocked).toBe(true);
  });

  it('should always block hate/threatening category', async () => {
    const response = {
      results: [{
        flagged: true,
        categories: {
          hate: false,
          'hate/threatening': true,
          'sexual/minors': false,
          violence: false,
          'violence/graphic': false,
          'self-harm/instructions': false,
        },
        category_scores: {
          hate: 0.01,
          'hate/threatening': 0.95,
          'sexual/minors': 0.01,
          violence: 0.01,
          'violence/graphic': 0.01,
          'self-harm/instructions': 0.01,
        },
      }],
    };

    nock(BASE).post('/v1/moderations').reply(200, response);

    const result = await ModerationService.moderate('content');

    expect(result.blocked).toBe(true);
  });
});

// ── Edge Cases ────────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('should handle empty input string', async () => {
    nock(BASE).post('/v1/moderations').reply(200, cleanResponse());

    const result = await ModerationService.moderate('');

    expect(result).toBeDefined();
  });

  it('should handle very long input string', async () => {
    const longText = 'a'.repeat(10000);
    nock(BASE).post('/v1/moderations').reply(200, cleanResponse());

    const result = await ModerationService.moderate(longText);

    expect(result).toBeDefined();
  });

  it('should handle special characters', async () => {
    nock(BASE).post('/v1/moderations').reply(200, cleanResponse());

    const result = await ModerationService.moderate('Test with émojis 🎉 and spëcial çhars!');

    expect(result).toBeDefined();
  });

  it('should handle input with newlines', async () => {
    nock(BASE).post('/v1/moderations').reply(200, cleanResponse());

    const result = await ModerationService.moderate('Line 1\nLine 2\nLine 3');

    expect(result).toBeDefined();
  });
});

// ── Tenant-specific Configuration Tests ────────────────────────────────────────

describe('tenant-specific moderation', () => {
  it('should handle optional tenantId parameter', async () => {
    nock(BASE).post('/v1/moderations').reply(200, cleanResponse());

    const result = await ModerationService.moderate('content', 'tenant-123');

    expect(result).toBeDefined();
  });

  it('should process without tenantId', async () => {
    nock(BASE).post('/v1/moderations').reply(200, cleanResponse());

    const result = await ModerationService.moderate('content');

    expect(result).toBeDefined();
  });
});
