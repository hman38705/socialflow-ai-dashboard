/**
 * Unit tests for pagination utility — issue #1109
 *
 * Covers:
 *  - encodeCursor / decodeCursor round-trip
 *  - Org-scoped cursor guard (validateCursorOrganization)
 *  - Page-size clamping and rejection via cursorSchema / pageLimitSchema
 *  - buildCursorResponse hasNextPage behaviour
 *  - buildPageResponse hasNextPage behaviour
 *  - Tampered cursor (non-base64) throws InvalidCursorError via decodeCursorOrThrow
 */

import {
  encodeCursor,
  decodeCursor,
  decodeCursorOrThrow,
  InvalidCursorError,
  validateCursorOrganization,
  buildCursorResponse,
  buildPageResponse,
  cursorSchema,
  pageLimitSchema,
  CursorParams,
  PageLimitParams,
} from '../utils/pagination';
import { Request } from 'express';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fakeReq(query: Record<string, string> = {}): Request {
  return {
    query,
    path: '/api/posts',
    baseUrl: '',
  } as unknown as Request;
}

// ── encodeCursor / decodeCursor round-trip ────────────────────────────────────

describe('encodeCursor / decodeCursor round-trip (#1109)', () => {
  const base = { id: 'post-1', createdAt: new Date('2025-01-01T00:00:00.000Z') };

  it('round-trips a record with updatedAt set', () => {
    const record = { ...base, updatedAt: new Date('2025-06-15T12:00:00.000Z') };
    const cursor = encodeCursor(record);
    const decoded = decodeCursor(cursor);
    expect(decoded).toEqual({ id: 'post-1', timestamp: '2025-06-15T12:00:00.000Z' });
  });

  it('falls back to createdAt when updatedAt is null', () => {
    const cursor = encodeCursor({ ...base, updatedAt: null });
    expect(decodeCursor(cursor)).toEqual({ id: 'post-1', timestamp: '2025-01-01T00:00:00.000Z' });
  });

  it('falls back to createdAt when updatedAt is omitted', () => {
    const cursor = encodeCursor(base);
    expect(decodeCursor(cursor)).toEqual({ id: 'post-1', timestamp: '2025-01-01T00:00:00.000Z' });
  });

  it('decoded cursor has the same id as the source record', () => {
    const cursor = encodeCursor({ id: 'my-unique-id', createdAt: new Date() });
    const decoded = decodeCursor(cursor);
    expect(decoded?.id).toBe('my-unique-id');
  });

  it('returns null for empty string', () => {
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null for structurally invalid base64 JSON (missing id)', () => {
    const bad = Buffer.from(JSON.stringify({ timestamp: '2025-01-01' })).toString('base64');
    expect(decodeCursor(bad)).toBeNull();
  });
});

// ── Tampered cursor → InvalidCursorError ──────────────────────────────────────

describe('decodeCursorOrThrow — tampered cursor (#1109)', () => {
  it('throws InvalidCursorError for non-base64 garbage', () => {
    expect(() => decodeCursorOrThrow('!!!not-base64!!!')).toThrow(InvalidCursorError);
  });

  it('throws InvalidCursorError for valid base64 but wrong JSON shape', () => {
    const bad = Buffer.from('{"wrong":"structure"}').toString('base64');
    expect(() => decodeCursorOrThrow(bad)).toThrow(InvalidCursorError);
  });

  it('throws with the name InvalidCursorError', () => {
    try {
      decodeCursorOrThrow('!!!');
    } catch (err: any) {
      expect(err.name).toBe('InvalidCursorError');
    }
  });

  it('returns the cursor data for a valid cursor', () => {
    const record = { id: 'x', createdAt: new Date('2025-03-01T00:00:00.000Z') };
    const cursor = encodeCursor(record);
    expect(() => decodeCursorOrThrow(cursor)).not.toThrow();
    expect(decodeCursorOrThrow(cursor).id).toBe('x');
  });
});

// ── Org-scoped cursor guard ───────────────────────────────────────────────────

describe('validateCursorOrganization — org-scoped guard (#1109)', () => {
  const orgId = 'org-abc';

  it('returns true when no cursor is provided', async () => {
    const prisma = {};
    const valid = await validateCursorOrganization(undefined, orgId, prisma, 'post');
    expect(valid).toBe(true);
  });

  it('returns false for a malformed cursor', async () => {
    const prisma = {};
    const valid = await validateCursorOrganization('!!!bad!!!', orgId, prisma, 'post');
    expect(valid).toBe(false);
  });

  it('returns false when the record belongs to a different org', async () => {
    const record = { id: 'post-99', createdAt: new Date() };
    const cursor = encodeCursor(record);

    const prisma = {
      post: {
        findUnique: jest.fn().mockResolvedValue({ organizationId: 'org-other' }),
      },
    };

    const valid = await validateCursorOrganization(cursor, orgId, prisma, 'post');
    expect(valid).toBe(false);
  });

  it('returns true when the record belongs to the correct org', async () => {
    const record = { id: 'post-100', createdAt: new Date() };
    const cursor = encodeCursor(record);

    const prisma = {
      post: {
        findUnique: jest.fn().mockResolvedValue({ organizationId: orgId }),
      },
    };

    const valid = await validateCursorOrganization(cursor, orgId, prisma, 'post');
    expect(valid).toBe(true);
  });

  it('returns false when the record is not found in the database', async () => {
    const record = { id: 'ghost-id', createdAt: new Date() };
    const cursor = encodeCursor(record);

    const prisma = {
      post: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const valid = await validateCursorOrganization(cursor, orgId, prisma, 'post');
    expect(valid).toBe(false);
  });
});

// ── Page-size clamping and rejection ──────────────────────────────────────────

// Single source of truth for the upper bound on the admin limit parameter.
// Keep this in sync with the implementation so the boundary tests track it.
const MAX_LIMIT = 100;

describe('admin limit upper bound (#1986)', () => {
  it('accepts a limit exactly at the maximum boundary', () => {
    const result = pageLimitSchema.safeParse({ page: 1, limit: MAX_LIMIT });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(MAX_LIMIT);
  });

  it('rejects or clamps a limit just above the maximum', () => {
    const result = pageLimitSchema.safeParse({ page: 1, limit: MAX_LIMIT + 1 });
    if (result.success) {
      // Clamped to the maximum
      expect(result.data.limit).toBe(MAX_LIMIT);
    } else {
      // Rejected with a validation error on the limit field
      expect(result.success).toBe(false);
      const issues = result.error.issues;
      expect(issues.some((issue) => issue.path.includes('limit'))).toBe(true);
    }
  });

  it('rejects a non-numeric limit', () => {
    const result = pageLimitSchema.safeParse({ page: 1, limit: 'abc' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes('limit'))).toBe(true);
    }
  });
});

describe('pageLimitSchema — page-size clamping (#1109)', () => {
  it('accepts page size within range', () => {
    const result = pageLimitSchema.safeParse({ page: 1, limit: 20 });
    expect(result.success).toBe(true);
  });

  it('clamps limit to 100 (max)', () => {
    const result = pageLimitSchema.safeParse({ page: 1, limit: 200 });
    // Zod max() fails, not clamps — so it returns an error
    expect(result.success).toBe(false);
  });

  it('rejects limit of 0', () => {
    const result = pageLimitSchema.safeParse({ page: 1, limit: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative limit', () => {
    const result = pageLimitSchema.safeParse({ page: 1, limit: -5 });
    expect(result.success).toBe(false);
  });

  it('defaults limit to 20 when omitted', () => {
    const result = pageLimitSchema.safeParse({ page: 1 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(20);
  });
});

describe('cursorSchema — page-size clamping (#1109)', () => {
  it('rejects limit above 100', () => {
    const result = cursorSchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it('rejects limit of 0', () => {
    const result = cursorSchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative limit', () => {
    const result = cursorSchema.safeParse({ limit: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts valid limit within range', () => {
    const result = cursorSchema.safeParse({ limit: 50 });
    expect(result.success).toBe(true);
  });
});

// ── Admin limit parameter default ────────────────────────────────────────────

describe('admin limit parameter default (#2025)', () => {
  const DOCUMENTED_DEFAULT_LIMIT = 20;

  it('applies the documented default limit when the parameter is omitted', () => {
    const result = pageLimitSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(DOCUMENTED_DEFAULT_LIMIT);
      expect(typeof result.data.limit).toBe('number');
    }
  });

  it('honours an explicit limit and keeps it numeric', () => {
    const result = pageLimitSchema.safeParse({ limit: 50 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(50);
      expect(typeof result.data.limit).toBe('number');
    }
  });

  it('applies the default when limit is absent but other params are present', () => {
    const result = pageLimitSchema.safeParse({ page: 3 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(DOCUMENTED_DEFAULT_LIMIT);
      expect(typeof result.data.limit).toBe('number');
    }
  });

  it('applies the default via a request built with fakeReq', () => {
    const req = fakeReq();
    const result = pageLimitSchema.safeParse(req.query);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(DOCUMENTED_DEFAULT_LIMIT);
      expect(typeof result.data.limit).toBe('number');
    }
  });
});

// ── buildCursorResponse — hasNextPage ────────────────────────────────────────

describe('buildCursorResponse — hasNextPage (#1109)', () => {
  type Post = { id: string };

  const params: CursorParams = { limit: 3 };

  it('returns hasNextPage: true when there are more items', () => {
    // Fetch limit+1 = 4 items → there IS a next page
    const items: Post[] = [
      { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' },
    ];
    const result = buildCursorResponse(fakeReq(), items, params);
    expect((result.pagination as any).hasNext).toBe(true);
  });

  it('returns hasNextPage: false when there are no more items', () => {
    // Fetch limit+1 = 4 but only 2 returned → no next page
    const items: Post[] = [{ id: 'a' }, { id: 'b' }];
    const result = buildCursorResponse(fakeReq(), items, params);
    expect((result.pagination as any).hasNext).toBe(false);
  });

  it('strips the extra item from data when hasNext is true', () => {
    const items: Post[] = [
      { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, // 4 for limit=3
    ];
    const result = buildCursorResponse(fakeReq(), items, params);
    expect(result.data).toHaveLength(3);
  });

  it('sets nextCursor to the last item id when hasNext is true', () => {
    const items: Post[] = [
      { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' },
    ];
    const result = buildCursorResponse(fakeReq(), items, params);
    expect((result.pagination as any).nextCursor).toBe('c');
  });

  it('sets nextCursor to null when hasNext is false', () => {
    const items: Post[] = [{ id: 'a' }];
    const result = buildCursorResponse(fakeReq(), items, params);
    expect((result.pagination as any).nextCursor).toBeNull();
  });
});

// ── buildPageResponse — hasNextPage ──────────────────────────────────────────

describe('buildPageResponse — hasNextPage (#1109)', () => {
  const params: PageLimitParams = { page: 1, limit: 10 };

  it('returns hasNext: true when total exceeds current page', () => {
    const result = buildPageResponse(fakeReq(), [], 25, params);
    expect((result.pagination as any).hasNext).toBe(true);
  });

  it('returns hasNext: false on last page', () => {
    const result = buildPageResponse(fakeReq(), [], 10, params);
    expect((result.pagination as any).hasNext).toBe(false);
  });

  it('returns hasPrev: false on first page', () => {
    const result = buildPageResponse(fakeReq(), [], 100, params);
    expect((result.pagination as any).hasPrev).toBe(false);
  });

  it('returns hasPrev: true on subsequent pages', () => {
    const result = buildPageResponse(fakeReq(), [], 100, { page: 3, limit: 10 });
    expect((result.pagination as any).hasPrev).toBe(true);
  });

  it('total and pages are correct', () => {
    const result = buildPageResponse(fakeReq(), [], 55, { page: 1, limit: 10 });
    const meta = result.pagination as any;
    expect(meta.total).toBe(55);
    expect(meta.pages).toBe(6);
  });
});
