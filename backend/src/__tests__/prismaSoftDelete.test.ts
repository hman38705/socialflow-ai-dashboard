import { softDeleteMiddleware } from '../middleware/prismaSoftDelete';

type MiddlewareParams = {
  model?: string;
  action: string;
  args: any;
  dataPath: string[];
  runInTransaction: boolean;
};

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
});

describe('softDeleteMiddleware – metrics and logging (issue #1129)', () => {
  let counterInc: jest.Mock;
  let loggerDebug: jest.Mock;

  beforeEach(() => {
    // Mock prom-client Counter and logger to capture calls
    counterInc = jest.fn();
    loggerDebug = jest.fn();

    jest.doMock('../lib/metrics', () => ({
      register: { registerMetric: jest.fn() },
    }));

    jest.doMock('../lib/logger', () => ({
      createLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: loggerDebug,
      }),
    }));

    jest.doMock('prom-client', () => ({
      Counter: jest.fn().mockImplementation(() => ({
        inc: counterInc,
        labels: jest.fn().mockReturnThis(),
      })),
    }));
  });

  afterEach(() => jest.resetModules());

  it('increments prisma_soft_delete_total counter on delete interception', async () => {
    // Use the already-imported middleware; counter is module-level so we
    // verify side effects through the exported counter directly.
    const { prismaSoftDeleteTotal } = await import('../middleware/prismaSoftDelete');
    const spy = jest
      .spyOn(prismaSoftDeleteTotal, 'labels')
      .mockReturnValue({ inc: counterInc } as any);

    const next = jest.fn().mockResolvedValue({ id: '42' });
    await softDeleteMiddleware(
      {
        model: 'User',
        action: 'delete',
        args: { where: { id: '42' } },
        dataPath: [],
        runInTransaction: false,
      },
      next,
    );

    expect(spy).toHaveBeenCalledWith('User');
    expect(counterInc).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
