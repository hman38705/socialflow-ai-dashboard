import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate as authMiddleware } from '../middleware/authenticate';
import { orgMiddleware } from '../middleware/orgMiddleware';
import { validate } from '../middleware/validate';
import { searchPosts } from '../services/SearchService';
import { config } from '../config/config';
import { AuthRequest } from '../middleware/authMiddleware';

const router = Router();

const searchQuerySchema = z.object({
  q: z.string().min(1),
  platform: z.enum(['twitter', 'linkedin', 'instagram', 'tiktok', 'facebook', 'youtube']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** GET /api/v1/search/posts — authenticated full-text search scoped to the active org */
router.get(
  '/posts',
  authMiddleware,
  orgMiddleware,
  validate(searchQuerySchema, 'query'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { q, platform, limit, offset } = req.query as unknown as z.infer<typeof searchQuerySchema>;
      const results = await searchPosts(q, { organizationId: req.activeOrgId!, platform, limit, offset });
      res.json(results);
    } catch (err) {
      next(err);
    }
  },
);

/** GET /api/v1/search/key — returns the public search-only API key for frontend use */
router.get('/key', authMiddleware, (_req: AuthRequest, res: Response) => {
  res.json({ searchKey: config.MEILISEARCH_SEARCH_KEY, host: config.MEILISEARCH_HOST });
});

export default router;
