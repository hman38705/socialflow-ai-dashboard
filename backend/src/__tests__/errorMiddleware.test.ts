/**
 * Unit tests for error middleware — issue #1099
 *
 * Covers:
 *  - AppError with custom status code → response uses that status
 *  - ZodError → 400 with field-level validation details
 *  - Unknown error in production → 500, generic message, no stack
 *  - Unknown error in development → 500 with stack included
 *  - statusCode=401 logs at warn level; 500-class errors log at error level
 */

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { z, ZodError } from 'zod';
import { errorHandler } from '../middleware/error';
import { AppError, UnauthorizedError, InternalServerError } from '../lib/errors';

// ── Logger spy setup ──────────────────────────────────────────────────────────

const warnSpy = jest.fn();
const errorSpy = jest.fn();

jest.mock('../lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    warn: (...args: unknown[]) => warnSpy(...args),
    error: (...args: unknown[]) => errorSpy(...args),
  }),
}));

// ── Test app factory ──────────────────────────────────────────────────────────

function makeApp(thrownError: Error, env = 'test') {
  const app = express();
  app.use((req: any, _res: Response, next: NextFunction) => {
    req.requestId = 'test-req-id';
    next();
  });

  app.get('/throw', (_req: Request, _res: Response, next: NextFunction) => {
    next(thrownError);
  });

  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = env;
    errorHandler(err, req, res, next);
    process.env.NODE_ENV = orig;
  });

  return app;
}

beforeEach(() => {
  warnSpy.mockClear();
  errorSpy.mockClear();
});

// ── AppError custom status code ───────────────────────────────────────────────

describe('AppError → custom status code (#1099)', () => {
  it('uses the statusCode from an AppError subclass', async () => {
    const err = new AppError('Teapot', 418, 'IM_A_TEAPOT');
    const res = await request(makeApp(err)).get('/throw');

    expect(res.status).toBe(418);
    expect(res.body).toMatchObject({ success: false, code: 'IM_A_TEAPOT', message: 'Teapot' });
  });

  it('returns the AppError message verbatim in non-production', async () => {
    const err = new AppError('Custom message', 403, 'FORBIDDEN');
    const res = await request(makeApp(err, 'development')).get('/throw');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('Custom message');
  });
});

// ── ZodError → 400 ───────────────────────────────────────────────────────────

describe('ZodError → 400 with field-level details (#1099)', () => {
  function makeZodError(): ZodError {
    const schema = z.object({
      email: z.string().email(),
      age: z.number().int().min(18),
    });
    const result = schema.safeParse({ email: 'not-an-email', age: 'oops' });
    if (!result.success) return result.error;
    throw new Error('Expected ZodError');
  }

  it('returns status 400', async () => {
    const res = await request(makeApp(makeZodError())).get('/throw');
    expect(res.status).toBe(400);
  });

  it('returns VALIDATION_ERROR code', async () => {
    const res = await request(makeApp(makeZodError())).get('/throw');
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('includes field-level errors keyed by path', async () => {
    const res = await request(makeApp(makeZodError())).get('/throw');
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors.email).toBeDefined();
    expect(Array.isArray(res.body.errors.email)).toBe(true);
  });

  it('logs ZodError at warn level', async () => {
    await request(makeApp(makeZodError())).get('/throw');
    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// ── Production: unknown error masked ─────────────────────────────────────────

describe('Unknown error in production (#1099)', () => {
  it('returns 500 with generic message', async () => {
    const err = new Error('Database exploded');
    const res = await request(makeApp(err, 'production')).get('/throw');

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('An unexpected error occurred');
  });

  it('does not include stack trace', async () => {
    const err = new Error('Secret internals');
    const res = await request(makeApp(err, 'production')).get('/throw');

    expect(res.body.stack).toBeUndefined();
  });
});

// ── Development: unknown error surfaced ──────────────────────────────────────

describe('Unknown error in development (#1099)', () => {
  it('returns 500 with the original error message', async () => {
    const err = new Error('Detailed dev error');
    const res = await request(makeApp(err, 'development')).get('/throw');

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('Detailed dev error');
  });

  it('includes a stack trace', async () => {
    const err = new Error('Stack trace test');
    const res = await request(makeApp(err, 'development')).get('/throw');

    expect(res.body.stack).toBeDefined();
    expect(res.body.stack).toContain('Stack trace test');
  });
});

// ── Log levels ────────────────────────────────────────────────────────────────

describe('Log levels by status code (#1099)', () => {
  it('401 UnauthorizedError logs at warn level', async () => {
    const err = new UnauthorizedError('Not authenticated');
    await request(makeApp(err)).get('/throw');

    expect(warnSpy).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('500 InternalServerError logs at error level', async () => {
    const err = new InternalServerError('Boom');
    await request(makeApp(err)).get('/throw');

    expect(errorSpy).toHaveBeenCalled();
  });

  it('unknown plain Error logs at error level', async () => {
    const err = new Error('Mystery failure');
    await request(makeApp(err)).get('/throw');

    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
