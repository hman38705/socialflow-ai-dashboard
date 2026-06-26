/**
 * Search org-scoping tests — Closes #7
 *
 * Verifies that search results are always scoped to req.activeOrgId and that
 * a user from org B cannot see posts belonging to org A.
 */
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import searchRouter from '../routes/search';
import * as SearchService from '../services/SearchService';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../middleware/authenticate', () => ({
  authenticate: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../middleware/orgMiddleware', () => ({
  orgMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../middleware/validate', () => ({
  validate: () => (req: any, _res: Response, next: NextFunction) => {
    req.query.limit = req.query.limit ?? 20;
    req.query.offset = req.query.offset ?? 0;
    next();
  },
}));

jest.mock('../services/SearchService', () => ({
  searchPosts: jest.fn(),
}));

jest.mock('../config/config', () => ({
  config: { MEILISEARCH_SEARCH_KEY: 'test-key', MEILISEARCH_HOST: 'http://localhost:7700' },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function buildApp(activeOrgId: string) {
  const app = express();
  app.use((req: any, _res: Response, next: NextFunction) => {
    req.activeOrgId = activeOrgId;
    next();
  });
  app.use('/search', searchRouter);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Search org-scoping (Closes #7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SearchService.searchPosts as jest.Mock).mockResolvedValue({ hits: [] });
  });

  it('always passes req.activeOrgId to searchPosts, ignoring any user-supplied organizationId', async () => {
    const app = buildApp(ORG_A);

    // Attacker supplies ORG_B in the query string.
    await request(app)
      .get(`/search/posts?q=hello&organizationId=${ORG_B}`)
      .expect(200);

    expect(SearchService.searchPosts).toHaveBeenCalledWith(
      'hello',
      expect.objectContaining({ organizationId: ORG_A }),
    );
    expect(SearchService.searchPosts).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ organizationId: ORG_B }),
    );
  });

  it('org B user cannot see org A posts', async () => {
    const orgAPost = { id: 'post-1', organizationId: ORG_A, content: 'secret' };
    const orgBPost = { id: 'post-2', organizationId: ORG_B, content: 'public' };

    (SearchService.searchPosts as jest.Mock).mockImplementation(
      (_q: string, opts: { organizationId: string }) =>
        Promise.resolve({
          hits: opts.organizationId === ORG_B ? [orgBPost] : [orgAPost],
        }),
    );

    const app = buildApp(ORG_B);
    const res = await request(app).get('/search/posts?q=secret').expect(200);

    expect(res.body.hits).toEqual([orgBPost]);
    expect(res.body.hits).not.toContainEqual(orgAPost);
  });

  it('searchPosts is always called with organizationId as a required field', async () => {
    const app = buildApp(ORG_A);
    await request(app).get('/search/posts?q=test').expect(200);

    const [, opts] = (SearchService.searchPosts as jest.Mock).mock.calls[0];
    expect(opts.organizationId).toBe(ORG_A);
  });
});
