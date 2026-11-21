import { redactSensitiveFields, REDACTED_FIELDS } from '../utils/redactSensitiveFields';

const SENSITIVE = ['password', 'token', 'cardNumber', 'cvv', 'secret'];

describe('redactSensitiveFields', () => {
  it('redacts all required sensitive fields', () => {
    const input = { password: 'pass123', token: 'tok', cardNumber: '4111', cvv: '123', secret: 'shh' };
    const result = redactSensitiveFields(input);
    for (const field of SENSITIVE) {
      expect(result[field]).toBe('[REDACTED]');
    }
  });

  it('never leaks sensitive values in output', () => {
    const input = { password: 'supersecret', token: 'bearer-abc', cardNumber: '4111111111111111', cvv: '999', secret: 'mysecret' };
    const result = redactSensitiveFields(input);
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('supersecret');
    expect(serialised).not.toContain('bearer-abc');
    expect(serialised).not.toContain('4111111111111111');
    expect(serialised).not.toContain('999');
    expect(serialised).not.toContain('mysecret');
  });

  it('is case-insensitive for field names', () => {
    const result = redactSensitiveFields({ Password: 'x', TOKEN: 'y', CardNumber: 'z' });
    expect(result['Password']).toBe('[REDACTED]');
    expect(result['TOKEN']).toBe('[REDACTED]');
    expect(result['CardNumber']).toBe('[REDACTED]');
  });

  it('redacts sensitive fields nested inside objects', () => {
    const result = redactSensitiveFields({ user: { password: 'nested', name: 'alice' } });
    expect((result['user'] as Record<string, unknown>)['password']).toBe('[REDACTED]');
    expect((result['user'] as Record<string, unknown>)['name']).toBe('alice');
  });

  it('preserves non-sensitive fields unchanged', () => {
    const result = redactSensitiveFields({ username: 'alice', email: 'alice@example.com', age: 30 });
    expect(result).toEqual({ username: 'alice', email: 'alice@example.com', age: 30 });
  });

  it('does not mutate the original object', () => {
    const input = { password: 'original' };
    redactSensitiveFields(input);
    expect(input.password).toBe('original');
  });

  it('REDACTED_FIELDS set contains all required fields', () => {
    for (const field of SENSITIVE) {
      expect(REDACTED_FIELDS.has(field.toLowerCase())).toBe(true);
    }
  });
});

describe('admin mutation audit payload redaction', () => {
  it('redacts sensitive fields in an admin mutation audit payload', () => {
    const payload = {
      adminId: 'admin-1',
      action: 'update-integration',
      targetId: 'integration-42',
      token: 'bearer-admin-secret',
      password: 'admin-pass',
      connectionString: 'postgres://user:pw@host:5432/db',
    };
    const stored = redactSensitiveFields(payload);
    expect(stored['token']).toBe('[REDACTED]');
    expect(stored['password']).toBe('[REDACTED]');
    expect(stored['connectionString']).toBe('[REDACTED]');
    const serialised = JSON.stringify(stored);
    expect(serialised).not.toContain('bearer-admin-secret');
    expect(serialised).not.toContain('admin-pass');
    expect(serialised).not.toContain('postgres://user:pw@host:5432/db');
  });

  it('preserves non-sensitive admin fields unchanged', () => {
    const payload = {
      adminId: 'admin-1',
      action: 'delete-user',
      targetId: 'user-99',
      reason: 'policy violation',
    };
    const stored = redactSensitiveFields(payload);
    expect(stored).toEqual(payload);
  });

  it('redacts nested sensitive fields in an admin payload while keeping siblings', () => {
    const payload = {
      adminId: 'a1',
      action: 'update-config',
      config: {
        credentials: { password: 'nested-secret', username: 'svc-account' },
        endpoint: 'https://api.example.com',
      },
    };
    const stored = redactSensitiveFields(payload);
    expect(stored['adminId']).toBe('a1');
    expect(stored['action']).toBe('update-config');
    const config = stored['config'] as Record<string, unknown>;
    expect(config['endpoint']).toBe('https://api.example.com');
    const credentials = config['credentials'] as Record<string, unknown>;
    expect(credentials['password']).toBe('[REDACTED]');
    expect(credentials['username']).toBe('svc-account');
    expect(JSON.stringify(stored)).not.toContain('nested-secret');
  });
});
