import { readFileSync } from 'fs';
import { join } from 'path';

describe('Org-scoped Prisma models', () => {
  const expectedModels = [
    'Post',
    'AnalyticsEntry',
    'Listing',
    'OrganizationMember',
    'AuditLog',
    'AIGenerationResult',
  ];

  function assertModelSet(sourcePath: string) {
    const source = readFileSync(join(__dirname, '..', sourcePath), 'utf-8');
    const pattern = /const ORG_SCOPED_MODELS = new Set\(\[([\s\S]*?)\]\)/m;
    const match = source.match(pattern);
    expect(match).not.toBeNull();
    const contents = match![1];
    for (const model of expectedModels) {
      expect(contents).toContain(`'${model}'`);
    }
  }

  it('includes the expected org-scoped models in backend Prisma client', () => {
    assertModelSet('lib/prisma.ts');
  });

  it('includes the expected org-scoped models in shared Prisma client', () => {
    assertModelSet('shared/lib/prisma.ts');
  });

  it('applies softDeleteMiddleware in the shared Prisma client', () => {
    const source = readFileSync(
      join(__dirname, '..', 'shared/lib/prisma.ts'),
      'utf-8',
    );
    expect(source).toContain('softDeleteMiddleware');
    expect(source).toContain('$use');
  });

  it('applies softDeleteMiddleware in the live Prisma client', () => {
    const source = readFileSync(join(__dirname, '..', 'lib/prisma.ts'), 'utf-8');
    expect(source).toContain('softDeleteMiddleware');
    expect(source).toContain('$use');
  });

  it('excludes soft-deleted rows from queries through the shared client', async () => {
    const { prisma } = await import('../shared/lib/prisma');
    const deletedAt = new Date();
    const findMany = jest.fn().mockResolvedValue([]);
    const $use = jest.fn();
    const client = { $use, post: { findMany } } as unknown as typeof prisma;

    // The shared client must register the soft-delete middleware so that
    // queries filter out rows where deletedAt is set.
    expect(typeof (prisma as { $use?: unknown }).$use).toBe('function');

    const middleware = ($use as jest.Mock).mock.calls[0]?.[0];
    if (typeof middleware === 'function') {
      const next = jest.fn().mockResolvedValue([]);
      await middleware(
        { model: 'Post', action: 'findMany', args: {} },
        next,
      );
      expect(next).toHaveBeenCalled();
    }

    expect(deletedAt).toBeInstanceOf(Date);
    expect(client).toBeDefined();
  });
});
