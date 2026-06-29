/**
 * #1118 — Unit tests for redactSensitiveFields
 * PII field masking, nested traversal, array handling, allowlist passthrough, immutability
 */
import { redactSensitiveFields, REDACTED_FIELDS } from '../utils/redactSensitiveFields';

describe('redactSensitiveFields', () => {
  // ── Top-level denylist fields ─────────────────────────────────────────────
  describe('top-level sensitive fields', () => {
    it.each([...REDACTED_FIELDS])('redacts "%s" field', (field) => {
      const input = { [field]: 'sensitive-value', safe: 'keep-me' };
      const output = redactSensitiveFields(input);
      expect(output[field]).toBe('[REDACTED]');
      expect(output.safe).toBe('keep-me');
    });

    it('redacts password at top level', () => {
      const output = redactSensitiveFields({ password: 'secret123', name: 'Alice' });
      expect(output.password).toBe('[REDACTED]');
      expect(output.name).toBe('Alice');
    });

    it('redacts token at top level', () => {
      const output = redactSensitiveFields({ token: 'abc.def.ghi' });
      expect(output.token).toBe('[REDACTED]');
    });

    it('redacts secret at top level', () => {
      const output = redactSensitiveFields({ secret: 'shh' });
      expect(output.secret).toBe('[REDACTED]');
    });
  });

  // ── Field name normalization (case + separators) ───────────────────────────
  describe('field name normalization', () => {
    it('redacts camelCase variations (accessToken)', () => {
      const output = redactSensitiveFields({ accessToken: 'tok' });
      expect(output.accessToken).toBe('[REDACTED]');
    });

    it('redacts snake_case variations (api_key → apikey)', () => {
      const output = redactSensitiveFields({ api_key: 'key-val' });
      expect(output.api_key).toBe('[REDACTED]');
    });

    it('redacts kebab-case variations (api-secret → apisecret)', () => {
      const output = redactSensitiveFields({ 'api-secret': 'sec' });
      expect(output['api-secret']).toBe('[REDACTED]');
    });
  });

  // ── Nested object traversal ───────────────────────────────────────────────
  describe('nested object traversal', () => {
    it('redacts sensitive fields in nested objects', () => {
      const input = {
        user: {
          name: 'Bob',
          credentials: {
            password: 'hunter2',
            token: 'xyz',
          },
        },
        platform: 'web',
      };
      const output = redactSensitiveFields(input);
      expect((output.user as any).credentials.password).toBe('[REDACTED]');
      expect((output.user as any).credentials.token).toBe('[REDACTED]');
      expect((output.user as any).name).toBe('Bob');
      expect(output.platform).toBe('web');
    });

    it('handles deeply nested objects', () => {
      const input = { a: { b: { c: { d: { secret: 'deep' } } } } };
      const output = redactSensitiveFields(input);
      expect((output as any).a.b.c.d.secret).toBe('[REDACTED]');
    });
  });

  // ── Array traversal ───────────────────────────────────────────────────────
  describe('arrays of objects', () => {
    it('redacts sensitive fields in each array element', () => {
      const input = {
        users: [
          { name: 'Alice', password: 'pw1' },
          { name: 'Bob', password: 'pw2' },
        ],
      };
      const output = redactSensitiveFields(input);
      const users = output.users as any[];
      expect(users[0].password).toBe('[REDACTED]');
      expect(users[1].password).toBe('[REDACTED]');
      expect(users[0].name).toBe('Alice');
    });

    it('passes through primitive arrays unchanged', () => {
      const input = { tags: ['a', 'b', 'c'] };
      const output = redactSensitiveFields(input);
      expect(output.tags).toEqual(['a', 'b', 'c']);
    });

    it('handles mixed arrays (primitives and objects)', () => {
      const input = { items: [1, { password: 'p' }, 'str'] };
      const output = redactSensitiveFields(input);
      const items = output.items as any[];
      expect(items[0]).toBe(1);
      expect(items[1].password).toBe('[REDACTED]');
      expect(items[2]).toBe('str');
    });
  });

  // ── Allowlist passthrough ─────────────────────────────────────────────────
  describe('allowlist passthrough', () => {
    it('passes through fields not in the denylist unchanged', () => {
      const input = {
        id: '123',
        email: 'alice@example.com',
        role: 'admin',
        createdAt: '2025-01-01',
      };
      const output = redactSensitiveFields(input);
      expect(output).toEqual(input);
    });

    it('passes through null values unchanged', () => {
      const input = { refreshToken: 'tok', nullField: null };
      const output = redactSensitiveFields(input);
      expect(output.refreshToken).toBe('[REDACTED]');
      expect(output.nullField).toBeNull();
    });

    it('passes through numeric values unchanged', () => {
      const input = { count: 42, amount: 9.99 };
      const output = redactSensitiveFields(input);
      expect(output.count).toBe(42);
      expect(output.amount).toBe(9.99);
    });

    it('passes through boolean values unchanged', () => {
      const input = { active: true, deleted: false };
      const output = redactSensitiveFields(input);
      expect(output.active).toBe(true);
      expect(output.deleted).toBe(false);
    });
  });

  // ── Immutability ──────────────────────────────────────────────────────────
  describe('immutability', () => {
    it('does not mutate the original input object', () => {
      const input = { password: 'original', name: 'Alice' };
      const clone = { ...input };
      redactSensitiveFields(input);
      expect(input.password).toBe('original');
      expect(input).toEqual(clone);
    });

    it('does not mutate nested objects', () => {
      const inner = { secret: 'original-secret', value: 42 };
      const input = { nested: inner };
      redactSensitiveFields(input);
      expect(inner.secret).toBe('original-secret');
    });

    it('does not mutate objects inside arrays', () => {
      const item = { password: 'pw', name: 'Bob' };
      const input = { list: [item] };
      redactSensitiveFields(input);
      expect(item.password).toBe('pw');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('handles an empty object', () => {
      expect(redactSensitiveFields({})).toEqual({});
    });

    it('returns the same structure when no sensitive keys are present', () => {
      const input = { a: 1, b: 'hello', c: { d: true } };
      const output = redactSensitiveFields(input);
      expect(output).toEqual(input);
    });
  });
});
