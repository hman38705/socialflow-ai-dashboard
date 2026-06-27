import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate';

function makeReq(body?: unknown, query?: unknown, params?: unknown): Request {
  return {
    body: body ?? {},
    query: query ?? {},
    params: params ?? {},
  } as unknown as Request;
}

function makeRes() {
  let statusCode: number;
  let body: unknown;
  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(data: unknown) {
      body = data;
      return res;
    },
    getStatus: () => statusCode,
    getBody: () => body,
  };
  return res;
}

const userSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().positive(),
});

describe('validate middleware', () => {
  describe('Zod schema error formatting', () => {
    it('responds 422 when body fails schema validation', () => {
      const mw = validate(userSchema);
      const req = makeReq({ name: '', age: -1 });
      const res = makeRes();
      const next = jest.fn();

      mw(req, res as Response, next as NextFunction);

      expect(res.getStatus()).toBe(422);
      expect(next).not.toHaveBeenCalled();
    });

    it('response body contains an errors array', () => {
      const mw = validate(userSchema);
      const req = makeReq({ name: 123, age: 'bad' });
      const res = makeRes();

      mw(req, res as Response, jest.fn() as NextFunction);

      const body = res.getBody() as { errors: unknown[] };
      expect(body).toHaveProperty('errors');
      expect(Array.isArray(body.errors)).toBe(true);
      expect(body.errors.length).toBeGreaterThan(0);
    });

    it('each error has a field and message string', () => {
      const mw = validate(userSchema);
      const req = makeReq({ name: 123, age: 'bad' });
      const res = makeRes();

      mw(req, res as Response, jest.fn() as NextFunction);

      const { errors } = res.getBody() as { errors: { field: string; message: string }[] };
      for (const err of errors) {
        expect(typeof err.field).toBe('string');
        expect(typeof err.message).toBe('string');
      }
    });

    it('error field matches the failing schema path', () => {
      const mw = validate(userSchema);
      const req = makeReq({ name: 'Alice' }); // missing age
      const res = makeRes();

      mw(req, res as Response, jest.fn() as NextFunction);

      const { errors } = res.getBody() as { errors: { field: string }[] };
      expect(errors.some((e) => e.field === 'age')).toBe(true);
    });

    it('formats nested field paths with dot notation', () => {
      const nestedSchema = z.object({ user: z.object({ email: z.string().email() }) });
      const mw = validate(nestedSchema);
      const req = makeReq({ user: { email: 'not-an-email' } });
      const res = makeRes();

      mw(req, res as Response, jest.fn() as NextFunction);

      const { errors } = res.getBody() as { errors: { field: string }[] };
      expect(errors.some((e) => e.field === 'user.email')).toBe(true);
    });

    it('reports multiple errors for multiple invalid fields', () => {
      const mw = validate(userSchema);
      const req = makeReq({}); // both name and age missing
      const res = makeRes();

      mw(req, res as Response, jest.fn() as NextFunction);

      const { errors } = res.getBody() as { errors: { field: string }[] };
      expect(errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('request passthrough on success', () => {
    it('calls next() when validation passes', () => {
      const mw = validate(userSchema);
      const req = makeReq({ name: 'Alice', age: 30 });
      const res = makeRes();
      const next = jest.fn();

      mw(req, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('does not send a response on successful validation', () => {
      const mw = validate(userSchema);
      const req = makeReq({ name: 'Alice', age: 30 });
      const res = makeRes();

      mw(req, res as Response, jest.fn() as NextFunction);

      expect(res.getStatus()).toBeUndefined();
    });

    it('replaces req.body with the parsed (coerced) value', () => {
      const schema = z.object({ count: z.coerce.number() });
      const mw = validate(schema);
      const req = makeReq({ count: '42' });

      mw(req, makeRes() as Response, jest.fn() as NextFunction);

      expect((req as any).body).toEqual({ count: 42 });
    });

    it('strips unknown fields from req.body', () => {
      const mw = validate(userSchema);
      const req = makeReq({ name: 'Alice', age: 25, extra: 'unwanted' });

      mw(req, makeRes() as Response, jest.fn() as NextFunction);

      expect((req as any).body).toEqual({ name: 'Alice', age: 25 });
      expect((req as any).body).not.toHaveProperty('extra');
    });

    it('validates req.query when target is "query"', () => {
      const schema = z.object({ page: z.coerce.number().default(1) });
      const mw = validate(schema, 'query');
      const req = makeReq({}, { page: '3' });
      const next = jest.fn();

      mw(req, makeRes() as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      expect((req as any).query).toEqual({ page: 3 });
    });

    it('validates req.params when target is "params"', () => {
      const schema = z.object({ id: z.string().uuid() });
      const mw = validate(schema, 'params');
      const req = makeReq({}, {}, { id: '550e8400-e29b-41d4-a716-446655440000' });
      const next = jest.fn();

      mw(req, makeRes() as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('defaults target to "body" when not specified', () => {
      const schema = z.object({ title: z.string() });
      const mw = validate(schema);
      const req = makeReq({ title: 'Hello' });
      const next = jest.fn();

      mw(req, makeRes() as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
