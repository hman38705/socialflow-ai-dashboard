import { z } from 'zod';

export const ADMIN_MIGRATIONS_SET_KEY = 'socialflow:admin:migrations:applied';
export const KNOWN_QUEUES_SET_KEY = 'socialflow:admin:known-queues';

// Migration lock and metadata constants
export const ADMIN_MIGRATIONS_LOCK_KEY = 'socialflow:admin:migrations:lock';
export const ADMIN_MIGRATIONS_METADATA_KEY = 'socialflow:admin:migrations:metadata';
export const MIGRATION_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const MIGRATION_LOCK_RETRY_INTERVAL_MS = 100;
export const MIGRATION_LOCK_MAX_RETRIES = 300; // 30 seconds total with 100ms intervals

// Admin numeric parameter bounds and defaults
export const DEFAULT_ADMIN_LIMIT = 100;
export const MAX_ADMIN_LIMIT = 1000;
export const DEFAULT_BATCH_SIZE = 100;
export const MAX_BATCH_SIZE = 1000;

/**
 * Coerces a query/body value to an integer within [min, max].
 * Rejects non-numeric strings, fractional values and out-of-range numbers.
 */
export const adminNumericSchema = (options: {
  min?: number;
  max?: number;
  default?: number;
} = {}) => {
  const { min = 0, max = MAX_ADMIN_LIMIT, default: defaultValue } = options;

  let schema = z.coerce
    .number({ invalid_type_error: 'Expected a numeric value' })
    .int('Expected an integer value')
    .min(min, `Value must be greater than or equal to ${min}`)
    .max(max, `Value must be less than or equal to ${max}`);

  if (defaultValue !== undefined) {
    schema = schema.default(defaultValue);
  }

  return schema;
};

/**
 * Coerces a query/body value to a boolean.
 * Accepts true/false booleans, "true"/"false" strings and 1/0 numbers.
 */
export const adminBooleanSchema = (options: { default?: boolean } = {}) => {
  const { default: defaultValue } = options;

  let schema = z
    .union([z.boolean(), z.string(), z.number()])
    .transform((value, ctx) => {
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'number') {
        if (value === 1) return true;
        if (value === 0) return false;
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Expected a boolean value',
        });
        return z.NEVER;
      }
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === '0') {
        return false;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected a boolean value',
      });
      return z.NEVER;
    });

  if (defaultValue !== undefined) {
    schema = schema.default(defaultValue);
  }

  return schema;
};