import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from '../lib/errors';

type Target = 'body' | 'query' | 'params';

interface ValidateOptions {
  /** HTTP status to use for validation failures. Defaults to 422. */
  status?: number;
  /** Error code to surface via the central error handler. */
  code?: string;
}

/**
 * Returns an Express middleware that validates req[target] against the given
 * Zod schema. On failure it forwards a structured error to the central error
 * handler (default status 422). On success the parsed (coerced + stripped)
 * value is written back to req[target].
 *
 * Pass `{ status: 400 }` to have validation failures surface as 400 through
 * the central error handler (used by admin routes).
 */
export function validate(
  schema: ZodSchema,
  target: Target = 'body',
  options: ValidateOptions = {},
) {
  const { status = 422, code = 'VALIDATION_ERROR' } = options;

  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const errors = formatErrors(result.error);
      const message = errors.length
        ? errors.map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)).join('; ')
        : 'Invalid request';

      const err = new AppError(message, status, code);
      // Attach structured details for the central error handler / clients
      (err as AppError & { errors?: unknown }).errors = errors;
      next(err);
      return;
    }
    // Replace with the parsed value so controllers get typed, coerced data
    (req as unknown as Record<string, unknown>)[target] = result.data;
    next();
  };
}

function formatErrors(error: ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}