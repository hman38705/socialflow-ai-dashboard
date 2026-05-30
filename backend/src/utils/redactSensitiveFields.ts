/**
 * Sensitive field redaction utility for audit logging.
 *
 * Any field whose key — normalized to lowercase with separators stripped —
 * matches an entry in REDACTED_FIELDS will have its value replaced with
 * '[REDACTED]' before the data is written to an audit log or logger.
 * Nested objects and arrays are redacted recursively.
 */

export const REDACTED_FIELDS: ReadonlySet<string> = new Set([
  'password',
  'passwordhash',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'apikey',
  'apisecret',
  'secret',
  'signingsecret',
  'webhooksecret',
  'privatekey',
  'cardnumber',
  'cvv',
  'cvc',
  'pan',
  'ssn',
  'dob',
  'authorization',
  'cookie',
  'xapikey',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

/**
 * Recursively redact sensitive keys from a plain object or array.
 * Returns a new value — the original is never mutated.
 */
export function redactSensitiveFields(
  data: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (depth > 10) return data; // guard against circular references

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (REDACTED_FIELDS.has(normalizeKey(key))) {
      result[key] = '[REDACTED]';
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? redactSensitiveFields(item as Record<string, unknown>, depth + 1)
          : item,
      );
    } else if (value !== null && typeof value === 'object') {
      result[key] = redactSensitiveFields(value as Record<string, unknown>, depth + 1);
    } else {
      result[key] = value;
    }
  }

  return result;
}
