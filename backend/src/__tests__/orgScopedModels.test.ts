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
});
