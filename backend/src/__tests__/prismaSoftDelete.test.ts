// ── Logger spy — must be in place before the middleware module is imported ────
const logErrorSpy = jest.fn();

jest.mock('../lib/logger', () => ({
  createLogger: () => ({ error: logErrorSpy, warn: jest.fn(), info: jest.fn() }),
}));

// ── SearchService stub ────────────────────────────────────────────────────────
const mockDeletePost = jest.fn().mockResolvedValue(undefined);

jest.mock('../services/SearchService', () => ({
  deletePost: (...args: any[]) => mockDeletePost(...args),
}));

// ── Meilisearch stub ──────────────────────────────────────────────────────────
const mockDeleteDocuments = jest.fn().mockResolvedValue(undefined);
const mockMeiliIndex = { deleteDocuments: mockDeleteDocuments };
const mockGetMeiliClient = jest.fn().mockReturnValue({ index: jest.fn().mockReturnValue(mockMeiliIndex) });

jest.mock('../lib/meilisearch', () => ({
  getMeiliClient: (...args: any[]) => mockGetMeiliClient(...args),
}));

import { softDeleteMiddleware } from '../middleware/prismaSoftDelete';

type MiddlewareParams = {
  model?: string;
  action: string;
  args: any;
  dataPath: string[];
  runInTransaction: boolean;
};

afterEach(() => {
  jest.clearAllMocks();
});

function makeNext(transform?: (p: MiddlewareParams) => void) {
  return jest.fn(async (p: MiddlewareParams) => {
    transform?.(p);
    return { id: '1' };
  });
}

function params(overrides: Partial<MiddlewareParams>): MiddlewareParams {
  return {
    model: 'User',
    action: 'findMany',
    args: {},
    dataPath: [],
    runInTransaction: false,
    ...overrides,
  };
}

describe('softDeleteMiddleware', () => {
  describe('delete → update', () => {
    it('converts delete to update with deletedAt for soft-delete models', async () => {
      const next = makeNext();
      await softDeleteMiddleware(params({ action: 'delete', args: { where: { id: '1' } } }), next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'update',
          args: expect.objectContaining({
            data: expect.objectContaining({ deletedAt: expect.any(Date) }),
          }),
        }),
      );
    });

    it('converts deleteMany to updateMany with deletedAt', async () => {
      const next = makeNext();
      await softDeleteMiddleware(
        params({ model: 'Listing', action: 'deleteMany', args: { where: { mentorId: 'x' } } }),
        next,
      );

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'updateMany',
          args: expect.objectContaining({
            data: expect.objectContaining({ deletedAt: expect.any(Date) }),
          }),
        }),
      );
    });

    it('does NOT intercept delete for non-soft-delete models', async () => {
      const next = makeNext();
      await softDeleteMiddleware(
        params({ model: 'DynamicConfig', action: 'delete', args: { where: { key: 'k' } } }),
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete' }));
    });
  });

  describe('find queries filter out soft-deleted records', () => {
    it.each(['findMany', 'findFirst', 'findFirstOrThrow'])(
      '%s adds deletedAt: null to where clause',
      async (action: string) => {
        const next = makeNext();
        await softDeleteMiddleware(params({ action, args: {} }), next);

        expect(next).toHaveBeenCalledWith(
          expect.objectContaining({
            action,
            args: expect.objectContaining({ where: { deletedAt: null } }),
          }),
        );
      },
    );

    it.each([
      ['findUnique', 'findFirst'],
      ['findUniqueOrThrow', 'findFirstOrThrow'],
    ])('converts %s to %s and adds deletedAt: null', async (from, to) => {
      const next = makeNext();
      await softDeleteMiddleware(
        params({ action: from as string, args: { where: { id: '1' } } }),
        next,
      );

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          action: to,
          args: expect.objectContaining({ where: { id: '1', deletedAt: null } }),
        }),
      );
    });

    it('preserves existing where conditions alongside deletedAt: null', async () => {
      const next = makeNext();
      await softDeleteMiddleware(
        params({ model: 'Listing', action: 'findMany', args: { where: { mentorId: 'abc' } } }),
        next,
      );

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          args: expect.objectContaining({ where: { mentorId: 'abc', deletedAt: null } }),
        }),
      );
    });

    it('does NOT add deletedAt filter for non-soft-delete models', async () => {
      const next = makeNext();
      await softDeleteMiddleware(
        params({ model: 'DynamicConfig', action: 'findMany', args: { where: {} } }),
        next,
      );

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ args: expect.objectContaining({ where: {} }) }),
      );
    });
  });

  describe('unaffected actions pass through unchanged', () => {
    it('passes create through without modification', async () => {
      const next = makeNext();
      await softDeleteMiddleware(
        params({ action: 'create', args: { data: { email: 'a@b.com' } } }),
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ action: 'create' }));
    });

    it('passes update through without modification', async () => {
      const next = makeNext();
      await softDeleteMiddleware(
        params({ action: 'update', args: { where: { id: '1' }, data: { email: 'new@b.com' } } }),
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ action: 'update' }));
    });
  });

  // ── Search-index cleanup — structured logger (not console.error) ────────────

  describe('search-index cleanup failure logging', () => {
    describe('delete branch (single post)', () => {
      it('logs logger.error via structured logger when deletePost rejects', async () => {
        const cleanupError = new Error('Meilisearch unreachable');
        mockDeletePost.mockRejectedValueOnce(cleanupError);
        const next = makeNext();

        await softDeleteMiddleware(
          params({ model: 'Post', action: 'delete', args: { where: { id: 'post-123' } } }),
          next,
        );

        // The catch handler is fire-and-forget; wait a tick for the promise to settle
        await new Promise((r) => setImmediate(r));

        expect(logErrorSpy).toHaveBeenCalledWith(
          'Failed to remove post from search index',
          expect.objectContaining({ id: 'post-123', error: cleanupError }),
        );
      });

      it('does not log when deletePost succeeds', async () => {
        mockDeletePost.mockResolvedValueOnce(undefined);
        const next = makeNext();

        await softDeleteMiddleware(
          params({ model: 'Post', action: 'delete', args: { where: { id: 'post-ok' } } }),
          next,
        );
        await new Promise((r) => setImmediate(r));

        expect(logErrorSpy).not.toHaveBeenCalledWith(
          'Failed to remove post from search index',
          expect.anything(),
        );
      });

      it('does not call deletePost when model is not Post', async () => {
        const next = makeNext();
        await softDeleteMiddleware(
          params({ model: 'User', action: 'delete', args: { where: { id: 'u-1' } } }),
          next,
        );
        await new Promise((r) => setImmediate(r));
        expect(mockDeletePost).not.toHaveBeenCalled();
      });
    });

    describe('deleteMany branch (bulk posts)', () => {
      it('logs logger.error via structured logger when deleteDocuments rejects', async () => {
        const bulkError = new Error('bulk delete failed');
        mockDeleteDocuments.mockRejectedValueOnce(bulkError);

        // prisma.post.findMany is handled by the moduleNameMapper mock
        const prismaMock = require('../lib/prisma');
        prismaMock.prisma.post = {
          findMany: jest.fn().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]),
        };

        const next = makeNext();
        await softDeleteMiddleware(
          params({ model: 'Post', action: 'deleteMany', args: { where: { authorId: 'u-1' } } }),
          next,
        );
        await new Promise((r) => setImmediate(r));

        expect(logErrorSpy).toHaveBeenCalledWith(
          'Failed to remove posts from search index',
          expect.objectContaining({ count: 2, error: bulkError }),
        );
      });

      it('does not log when deleteDocuments succeeds', async () => {
        mockDeleteDocuments.mockResolvedValueOnce(undefined);

        const prismaMock = require('../lib/prisma');
        prismaMock.prisma.post = {
          findMany: jest.fn().mockResolvedValue([{ id: 'p3' }]),
        };

        const next = makeNext();
        await softDeleteMiddleware(
          params({ model: 'Post', action: 'deleteMany', args: { where: { authorId: 'u-2' } } }),
          next,
        );
        await new Promise((r) => setImmediate(r));

        expect(logErrorSpy).not.toHaveBeenCalledWith(
          'Failed to remove posts from search index',
          expect.anything(),
        );
      });
    });
  });
});
