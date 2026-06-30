import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import {
  AppError,
  isAppError,
  ValidationError,
  RateLimitError,
  ServiceUnavailableError,
} from '../lib/errors';
import { createLogger } from '../lib/logger';

const logger = createLogger('ErrorMiddleware');

/**
 * Standard Error Response Format
 */
interface ErrorResponse {
  success: false;
  code: string;
  message: string;
  requestId?: string;
  errors?: Record<string, string[]>;
  retryAfter?: number;
  service?: string;
  stack?: string;
  timestamp: string;
}

/**
 * Global Error Handling Middleware
 *
 * This middleware catches all errors thrown in the application and
 * returns standardized error responses.
 *
 * Features:
 * - Standardized error response format
 * - Proper HTTP status code mapping
 * - Stack traces hidden in production
 * - Request ID included for tracing
 * - Detailed logging for debugging
 *
 * @param err - The error object
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,

  _next: NextFunction,
): void => {
  const isProduction = process.env.NODE_ENV === 'production';
  const requestId = (req as any).requestId;

  // Default error values
  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected error occurred';

  // ZodError → 400 with per-field validation details
  if (err instanceof ZodError) {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';

    const fieldErrors: Record<string, string[]> = {};
    for (const issue of err.issues) {
      const field = issue.path.join('.') || '_root';
      if (!fieldErrors[field]) fieldErrors[field] = [];
      fieldErrors[field].push(issue.message);
    }

    logger.warn('ZodError validation failed', { issues: err.issues.length, requestId, path: req.path });

    const zodResponse: ErrorResponse = {
      success: false,
      code,
      message,
      requestId,
      errors: fieldErrors,
      timestamp: new Date().toISOString(),
    };

    if (!isProduction && err.stack) {
      zodResponse.stack = err.stack;
    }

    res.status(statusCode).json(zodResponse);
    return;
  }

  // If it's our custom AppError, use its properties
  if (isAppError(err)) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;

    // Log operational errors as warnings, programming errors as errors
    if (err.isOperational) {
      logger.warn('Operational error occurred', {
        code: err.code,
        message: err.message,
        statusCode: err.statusCode,
        requestId,
        path: req.path,
        method: req.method,
      });
    } else {
      logger.error('Programming error occurred', {
        code: err.code,
        message: err.message,
        statusCode: err.statusCode,
        stack: err.stack,
        requestId,
        path: req.path,
        method: req.method,
      });
    }
  } else {
    // Unknown error - log with full details
    logger.error('Unexpected error occurred', {
      error: err.message,
      stack: err.stack,
      requestId,
      path: req.path,
      method: req.method,
    });
    // In non-production, surface the original message for easier debugging
    if (!isProduction) {
      message = err.message || message;
    }
  }

  // Build error response
  const errorResponse: ErrorResponse = {
    success: false,
    code,
    message: isProduction && statusCode === 500 ? 'An unexpected error occurred' : message,
    requestId,
    timestamp: new Date().toISOString(),
  };

  // Add validation errors if present
  if (err instanceof ValidationError && err.errors) {
    errorResponse.errors = err.errors;
  }

  // Add retry-after header for rate limit errors
  if (err instanceof RateLimitError && err.retryAfter) {
    errorResponse.retryAfter = err.retryAfter;
    res.setHeader('Retry-After', err.retryAfter);
  }

  // Add retry-after header for service unavailable errors
  if (err instanceof ServiceUnavailableError && err.retryAfter) {
    errorResponse.retryAfter = err.retryAfter;
    res.setHeader('Retry-After', err.retryAfter);
  }

  // Include stack trace only in development
  if (!isProduction && err.stack) {
    errorResponse.stack = err.stack;
  }

  // Send error response
  res.status(statusCode).json(errorResponse);
};

/**
 * 404 Not Found Handler
 *
 * Catches all requests that don't match any routes
 * Must be placed after all route definitions
 */
export const notFoundHandler = (req: Request, res: Response, _next: NextFunction): void => {
  const requestId = (req as any).requestId;

  logger.warn('Route not found', {
    path: req.path,
    method: req.method,
    requestId,
  });

  const errorResponse: ErrorResponse = {
    success: false,
    code: 'NOT_FOUND',
    message: `Cannot ${req.method} ${req.path}`,
    requestId,
    timestamp: new Date().toISOString(),
  };

  res.status(404).json(errorResponse);
};

/**
 * Async Error Wrapper
 *
 * Wraps async route handlers to catch promise rejections
 * and pass them to the error middleware
 *
 * Usage:
 * app.get('/users', asyncHandler(async (req, res) => {
 *   const users = await userService.getAll();
 *   res.json(users);
 * }));
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
