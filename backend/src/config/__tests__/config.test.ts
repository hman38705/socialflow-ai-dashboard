import { validateEnv, config } from '../config';

const REQUIRED_ENV: Record<string, string> = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'super-secret-jwt-value-at-least-32-chars',
  JWT_REFRESH_SECRET: 'super-secret-refresh-value-at-least-32-chars',
  TWITTER_API_KEY: 'twitter-key',
  TWITTER_API_SECRET: 'twitter-secret',
};

describe('config proxy', () => {
  beforeAll(() => {
    Object.assign(process.env, REQUIRED_ENV);
  });

  afterAll(() => {
    for (const key of Object.keys(REQUIRED_ENV)) {
      delete process.env[key];
    }
  });

  it('reads validated values through the config proxy', () => {
    expect(config.JWT_SECRET).toBe(REQUIRED_ENV.JWT_SECRET);
    expect(config.TWITTER_API_KEY).toBe(REQUIRED_ENV.TWITTER_API_KEY);
    expect(config.BACKEND_PORT).toBe(3001);
  });

  it('returns the same value on repeated access (singleton)', () => {
    expect(config.NODE_ENV).toBe(config.NODE_ENV);
  });
});

describe('validateEnv', () => {
  describe('valid environment', () => {
    it('parses all required variables', () => {
      const result = validateEnv(REQUIRED_ENV);
      expect(result.DATABASE_URL).toBe(REQUIRED_ENV.DATABASE_URL);
      expect(result.JWT_SECRET).toBe(REQUIRED_ENV.JWT_SECRET);
      expect(result.JWT_REFRESH_SECRET).toBe(REQUIRED_ENV.JWT_REFRESH_SECRET);
      expect(result.TWITTER_API_KEY).toBe(REQUIRED_ENV.TWITTER_API_KEY);
      expect(result.TWITTER_API_SECRET).toBe(REQUIRED_ENV.TWITTER_API_SECRET);
    });

    it('applies default values', () => {
      const result = validateEnv(REQUIRED_ENV);
      expect(result.NODE_ENV).toBe('development');
      expect(result.BACKEND_PORT).toBe(3001);
      expect(result.REDIS_HOST).toBe('127.0.0.1');
      expect(result.REDIS_PORT).toBe(6379);
      expect(result.REDIS_DB).toBe(0);
      expect(result.JWT_EXPIRES_IN).toBe('15m');
      expect(result.JWT_REFRESH_EXPIRES_IN).toBe('7d');
      expect(result.LOG_LEVEL).toBe('info');
      expect(result.OTEL_SERVICE_NAME).toBe('socialflow-backend');
      expect(result.OTEL_EXPORTER).toBe('jaeger');
    });

    it('coerces BACKEND_PORT string to number', () => {
      const result = validateEnv({ ...REQUIRED_ENV, BACKEND_PORT: '4000' });
      expect(result.BACKEND_PORT).toBe(4000);
    });

    it('coerces REDIS_PORT string to number', () => {
      const result = validateEnv({ ...REQUIRED_ENV, REDIS_PORT: '6380' });
      expect(result.REDIS_PORT).toBe(6380);
    });

    it('coerces REDIS_DB string to number', () => {
      const result = validateEnv({ ...REQUIRED_ENV, REDIS_DB: '2' });
      expect(result.REDIS_DB).toBe(2);
    });

    it('transforms OTEL_DEBUG "true" to boolean true', () => {
      const result = validateEnv({ ...REQUIRED_ENV, OTEL_DEBUG: 'true' });
      expect(result.OTEL_DEBUG).toBe(true);
    });

    it('transforms OTEL_DEBUG "false" to boolean false', () => {
      const result = validateEnv({ ...REQUIRED_ENV, OTEL_DEBUG: 'false' });
      expect(result.OTEL_DEBUG).toBe(false);
    });

    it('transforms DATA_PRUNING_ENABLED "false" to false', () => {
      const result = validateEnv({ ...REQUIRED_ENV, DATA_PRUNING_ENABLED: 'false' });
      expect(result.DATA_PRUNING_ENABLED).toBe(false);
    });

    it('transforms DATA_PRUNING_ENABLED "0" to false', () => {
      const result = validateEnv({ ...REQUIRED_ENV, DATA_PRUNING_ENABLED: '0' });
      expect(result.DATA_PRUNING_ENABLED).toBe(false);
    });

    it('transforms DATA_PRUNING_ENABLED "true" to true', () => {
      const result = validateEnv({ ...REQUIRED_ENV, DATA_PRUNING_ENABLED: 'true' });
      expect(result.DATA_PRUNING_ENABLED).toBe(true);
    });

    it('transforms DATA_PRUNING_ENABLED "1" to true', () => {
      const result = validateEnv({ ...REQUIRED_ENV, DATA_PRUNING_ENABLED: '1' });
      expect(result.DATA_PRUNING_ENABLED).toBe(true);
    });

    it('rejects DATA_PRUNING_ENABLED "no" (not an accepted value)', () => {
      expect(() => validateEnv({ ...REQUIRED_ENV, DATA_PRUNING_ENABLED: 'no' })).toThrow(
        'Environment validation failed',
      );
    });

    it('accepts valid NODE_ENV values', () => {
      expect(validateEnv({ ...REQUIRED_ENV, NODE_ENV: 'production' }).NODE_ENV).toBe('production');
      expect(validateEnv({ ...REQUIRED_ENV, NODE_ENV: 'test' }).NODE_ENV).toBe('test');
      expect(validateEnv({ ...REQUIRED_ENV, NODE_ENV: 'development' }).NODE_ENV).toBe('development');
    });

    it('accepts valid OTEL_EXPORTER values', () => {
      expect(validateEnv({ ...REQUIRED_ENV, OTEL_EXPORTER: 'honeycomb' }).OTEL_EXPORTER).toBe('honeycomb');
      expect(validateEnv({ ...REQUIRED_ENV, OTEL_EXPORTER: 'otlp' }).OTEL_EXPORTER).toBe('otlp');
      expect(validateEnv({ ...REQUIRED_ENV, OTEL_EXPORTER: 'jaeger' }).OTEL_EXPORTER).toBe('jaeger');
    });

    it('accepts valid LOG_LEVEL values', () => {
      for (const level of ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'] as const) {
        expect(validateEnv({ ...REQUIRED_ENV, LOG_LEVEL: level }).LOG_LEVEL).toBe(level);
      }
    });

    it('accepts valid DATA_RETENTION_MODE values', () => {
      expect(validateEnv({ ...REQUIRED_ENV, DATA_RETENTION_MODE: 'archive' }).DATA_RETENTION_MODE).toBe('archive');
      expect(validateEnv({ ...REQUIRED_ENV, DATA_RETENTION_MODE: 'delete' }).DATA_RETENTION_MODE).toBe('delete');
    });

    it('treats optional variables as undefined when absent', () => {
      const result = validateEnv(REQUIRED_ENV);
      expect(result.REDIS_PASSWORD).toBeUndefined();
      expect(result.FACEBOOK_APP_ID).toBeUndefined();
      expect(result.STRIPE_SECRET_KEY).toBeUndefined();
      expect(result.DEEPL_API_KEY).toBeUndefined();
      expect(result.HONEYCOMB_API_KEY).toBeUndefined();
      expect(result.SLACK_WEBHOOK_URL).toBeUndefined();
    });

    it('accepts optional variables when provided', () => {
      const result = validateEnv({ ...REQUIRED_ENV, STRIPE_SECRET_KEY: 'sk_test_123' });
      expect(result.STRIPE_SECRET_KEY).toBe('sk_test_123');
    });

    it('coerces numeric alert thresholds', () => {
      const result = validateEnv({
        ...REQUIRED_ENV,
        ALERT_ERROR_RATE_PERCENT: '15',
        ALERT_RESPONSE_TIME_MS: '3000',
        ALERT_CONSECUTIVE_FAILURES: '5',
      });
      expect(result.ALERT_ERROR_RATE_PERCENT).toBe(15);
      expect(result.ALERT_RESPONSE_TIME_MS).toBe(3000);
      expect(result.ALERT_CONSECUTIVE_FAILURES).toBe(5);
    });
  });

  describe('missing required variables', () => {
    it('throws when DATABASE_URL is missing', () => {
      const { DATABASE_URL: _, ...env } = REQUIRED_ENV;
      expect(() => validateEnv(env)).toThrow('Environment validation failed');
    });

    it('throws when JWT_SECRET is missing', () => {
      const { JWT_SECRET: _, ...env } = REQUIRED_ENV;
      expect(() => validateEnv(env)).toThrow('Environment validation failed');
    });

    it('throws when JWT_REFRESH_SECRET is missing', () => {
      const { JWT_REFRESH_SECRET: _, ...env } = REQUIRED_ENV;
      expect(() => validateEnv(env)).toThrow('Environment validation failed');
    });

    it('throws when JWT_SECRET is shorter than 32 characters', () => {
      expect(() => validateEnv({ ...REQUIRED_ENV, JWT_SECRET: 'short-secret' })).toThrow(
        'JWT_SECRET must be at least 32 characters',
      );
    });

    it('throws when JWT_REFRESH_SECRET is shorter than 32 characters', () => {
      expect(() => validateEnv({ ...REQUIRED_ENV, JWT_REFRESH_SECRET: 'short-secret' })).toThrow(
        'JWT_REFRESH_SECRET must be at least 32 characters',
      );
    });

    it('throws when TWITTER_API_KEY is missing', () => {
      const { TWITTER_API_KEY: _, ...env } = REQUIRED_ENV;
      expect(() => validateEnv(env)).toThrow('Environment validation failed');
    });

    it('throws when TWITTER_API_SECRET is missing', () => {
      const { TWITTER_API_SECRET: _, ...env } = REQUIRED_ENV;
      expect(() => validateEnv(env)).toThrow('Environment validation failed');
    });

    it('throws when all required variables are missing', () => {
      expect(() => validateEnv({})).toThrow('Environment validation failed');
    });

    it('error message lists the failing field names', () => {
      const { JWT_SECRET: _, ...env } = REQUIRED_ENV;
      try {
        validateEnv(env);
        fail('Expected validateEnv to throw');
      } catch (err) {
        expect((err as Error).message).toContain('JWT_SECRET');
      }
    });
  });

  describe('invalid variable types / values', () => {
    it('throws on invalid DATABASE_URL format', () => {
      expect(() => validateEnv({ ...REQUIRED_ENV, DATABASE_URL: 'not-a-url' })).toThrow(
        'Environment validation failed',
      );
    });

    it('throws on invalid NODE_ENV value', () => {
      expect(() => validateEnv({ ...REQUIRED_ENV, NODE_ENV: 'staging' })).toThrow(
        'Environment validation failed',
      );
    });

    it('throws on invalid OTEL_EXPORTER value', () => {
      expect(() => validateEnv({ ...REQUIRED_ENV, OTEL_EXPORTER: 'datadog' })).toThrow(
        'Environment validation failed',
      );
    });

    it('throws on invalid LOG_LEVEL value', () => {
      expect(() => validateEnv({ ...REQUIRED_ENV, LOG_LEVEL: 'trace' })).toThrow(
        'Environment validation failed',
      );
    });

    it('throws on invalid DATA_RETENTION_MODE value', () => {
      expect(() => validateEnv({ ...REQUIRED_ENV, DATA_RETENTION_MODE: 'purge' })).toThrow(
        'Environment validation failed',
      );
    });

    it('throws when JWT_SECRET is an empty string', () => {
      expect(() => validateEnv({ ...REQUIRED_ENV, JWT_SECRET: '' })).toThrow(
        'Environment validation failed',
      );
    });

    it('throws when TWITTER_API_KEY is an empty string', () => {
      expect(() => validateEnv({ ...REQUIRED_ENV, TWITTER_API_KEY: '' })).toThrow(
        'Environment validation failed',
      );
    });
  });

  describe('observability env var fuzz cases', () => {
    // ── OTEL_DEBUG boolean transform ────────────────────────────────────────
    it('OTEL_DEBUG defaults to false when absent', () => {
      const result = validateEnv(REQUIRED_ENV);
      expect(result.OTEL_DEBUG).toBe(false);
    });

    it.each(['1', 'yes', 'TRUE', 'on', 'enabled'])(
      'OTEL_DEBUG "%s" is treated as false (only "true" is truthy)',
      (value) => {
        const result = validateEnv({ ...REQUIRED_ENV, OTEL_DEBUG: value });
        expect(result.OTEL_DEBUG).toBe(false);
      },
    );

    // ── DATA_PRUNING_ENABLED boolean transform ──────────────────────────────
    it('DATA_PRUNING_ENABLED defaults to true when absent', () => {
      const result = validateEnv(REQUIRED_ENV);
      expect(result.DATA_PRUNING_ENABLED).toBe(true);
    });

    it.each(['true', '1'])('DATA_PRUNING_ENABLED "%s" enables pruning', (value) => {
      const result = validateEnv({ ...REQUIRED_ENV, DATA_PRUNING_ENABLED: value });
      expect(result.DATA_PRUNING_ENABLED).toBe(true);
    });

    it.each(['false', '0'])('DATA_PRUNING_ENABLED "%s" disables pruning', (value) => {
      const result = validateEnv({ ...REQUIRED_ENV, DATA_PRUNING_ENABLED: value });
      expect(result.DATA_PRUNING_ENABLED).toBe(false);
    });

    it.each(['no', 'yes', 'off', 'on', 'enabled', 'disabled'])(
      'DATA_PRUNING_ENABLED "%s" is rejected (not an accepted value)',
      (value) => {
        expect(() => validateEnv({ ...REQUIRED_ENV, DATA_PRUNING_ENABLED: value })).toThrow(
          'Environment validation failed',
        );
      },
    );

    // ── Malformed URL fields ────────────────────────────────────────────────
    it.each([
      ['JAEGER_ENDPOINT', 'not-a-url'],
      ['JAEGER_ENDPOINT', ''],
      ['OTEL_EXPORTER_OTLP_ENDPOINT', 'not-a-url'],
      ['OTEL_EXPORTER_OTLP_ENDPOINT', ''],
    ])('%s rejects malformed value "%s"', (key, value) => {
      expect(() => validateEnv({ ...REQUIRED_ENV, [key]: value })).toThrow(
        'Environment validation failed',
      );
    });

    it('ELASTICSEARCH_URL accepts a valid URL', () => {
      const result = validateEnv({ ...REQUIRED_ENV, ELASTICSEARCH_URL: 'http://localhost:9200' });
      expect(result.ELASTICSEARCH_URL).toBe('http://localhost:9200');
    });

    it('ELASTICSEARCH_URL is undefined when absent', () => {
      const result = validateEnv(REQUIRED_ENV);
      expect(result.ELASTICSEARCH_URL).toBeUndefined();
    });

    // ── Error message contains field name ───────────────────────────────────
    it('error message names the failing observability field', () => {
      try {
        validateEnv({ ...REQUIRED_ENV, OTEL_EXPORTER: 'datadog' });
        fail('Expected validateEnv to throw');
      } catch (err) {
        expect((err as Error).message).toContain('OTEL_EXPORTER');
      }
    });

    it('error message names the failing LOG_LEVEL field', () => {
      try {
        validateEnv({ ...REQUIRED_ENV, LOG_LEVEL: 'trace' });
        fail('Expected validateEnv to throw');
      } catch (err) {
        expect((err as Error).message).toContain('LOG_LEVEL');
      }
    });

    // ── Defaults not applied when var is explicitly set ─────────────────────
    it('OTEL_SERVICE_NAME default is not used when explicitly set', () => {
      const result = validateEnv({ ...REQUIRED_ENV, OTEL_SERVICE_NAME: 'my-service' });
      expect(result.OTEL_SERVICE_NAME).toBe('my-service');
    });

    it('JAEGER_ENDPOINT default is not used when explicitly set', () => {
      const custom = 'http://jaeger.internal:14268/api/traces';
      const result = validateEnv({ ...REQUIRED_ENV, JAEGER_ENDPOINT: custom });
      expect(result.JAEGER_ENDPOINT).toBe(custom);
    });
  });
});
