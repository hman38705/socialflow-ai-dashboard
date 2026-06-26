/**
 * Export org-scoping tests — Closes #8
 *
 * Verifies that the export routes derive organizationId exclusively from
 * req.activeOrgId (set by orgMiddleware) and never from a user-supplied
 * query parameter.
 */
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import exportRouter from '../routes/exports';
import { ExportService } from '../services/ExportService';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../middleware/authenticate', () => ({
  authenticate: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../middleware/orgMiddleware', () => ({
  orgMiddleware: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../middleware/checkPermission', () => ({
  checkPermission: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

jest.mock('../services/ExportService', () => ({
  ExportService: {
    streamAnalyticsAsCSV: jest.fn(),
    streamAnalyticsAsJSON: jest.fn(),
    streamPostsAsCSV: jest.fn(),
    streamPostsAsJSON: jest.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const VALID_QUERY = 'format=csv&startDate=2025-01-01T00:00:00Z&endDate=2025-12-31T23:59:59Z';

/** Build an app where a middleware sets activeOrgId to `orgId`. */
function buildApp(orgId: string | undefined) {
  const app = express();
  app.use((req: any, _res: Response, next: NextFunction) => {
    req.activeOrgId = orgId;
    next();
  });
  app.use('/exports', exportRouter);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Export org-scoping (Closes #8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (ExportService.streamAnalyticsAsCSV as jest.Mock).mockImplementation(
      (_orgId: string, _start: Date, _end: Date, res: Response) => res.status(200).end(),
    );
    (ExportService.streamPostsAsCSV as jest.Mock).mockImplementation(
      (_orgId: string, _start: Date, _end: Date, res: Response) => res.status(200).end(),
    );
  });

  describe('GET /exports/analytics', () => {
    it('uses req.activeOrgId, not a user-supplied organizationId', async () => {
      const app = buildApp(ORG_A);

      // Attacker supplies ORG_B in the query string.
      await request(app)
        .get(`/exports/analytics?organizationId=${ORG_B}&${VALID_QUERY}`)
        .expect(200);

      expect(ExportService.streamAnalyticsAsCSV).toHaveBeenCalledWith(
        ORG_A, // must be the auth-context org, not ORG_B
        expect.any(Date),
        expect.any(Date),
        expect.anything(),
      );
      expect(ExportService.streamAnalyticsAsCSV).not.toHaveBeenCalledWith(
        ORG_B,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('returns 403 when activeOrgId is not set', async () => {
      const app = buildApp(undefined);

      await request(app).get(`/exports/analytics?${VALID_QUERY}`).expect(403);
      expect(ExportService.streamAnalyticsAsCSV).not.toHaveBeenCalled();
    });
  });

  describe('GET /exports/posts', () => {
    it('uses req.activeOrgId, not a user-supplied organizationId', async () => {
      const app = buildApp(ORG_A);

      await request(app)
        .get(`/exports/posts?organizationId=${ORG_B}&${VALID_QUERY}`)
        .expect(200);

      expect(ExportService.streamPostsAsCSV).toHaveBeenCalledWith(
        ORG_A,
        expect.any(Date),
        expect.any(Date),
        expect.anything(),
      );
      expect(ExportService.streamPostsAsCSV).not.toHaveBeenCalledWith(
        ORG_B,
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
