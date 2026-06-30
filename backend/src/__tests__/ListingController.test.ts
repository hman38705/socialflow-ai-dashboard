/**
 * #1115 — Unit tests for ListingController
 * createListing / getListing / deleteListing, org scoping, pagination
 */
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import { listingService } from '../services/ListingService';

// ── Mocks ─────────────────────────────────────────────────────────────────────
jest.mock('../services/ListingService', () => ({
  listingService: {
    createListing: jest.fn(),
    findById: jest.fn(),
    deleteListing: jest.fn(),
    list: jest.fn(),
    toggleVisibility: jest.fn(),
    searchListings: jest.fn(),
  },
}));

jest.mock('../middleware/authenticate', () => ({
  authenticate: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── App builder ────────────────────────────────────────────────────────────────
import listingsRouter from '../routes/listings';
import {
  createListing,
  getListing,
  deleteListing,
  listListings,
} from '../controllers/ListingController';

function buildApp(opts: { userId?: string; orgId?: string } = {}) {
  const app = express();
  app.use(express.json());
  // Inject auth context
  app.use((req: any, _res: Response, next: NextFunction) => {
    if (opts.userId) req.user = { id: opts.userId };
    if (opts.orgId) req.activeOrgId = opts.orgId;
    next();
  });
  app.post('/listings', createListing);
  app.get('/listings/:id', getListing);
  app.delete('/listings/:id', deleteListing);
  app.get('/listings', listListings);
  // Global error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ success: false, message: err.message });
  });
  return app;
}

const MENTOR_ID = 'user-111';
const ORG_A = 'org-aaa';
const ORG_B = 'org-bbb';
const LISTING_ID = 'listing-123';

const sampleListing = {
  id: LISTING_ID,
  title: 'Test Listing',
  description: 'A description',
  price: 99.99,
  isActive: true,
  mentorId: MENTOR_ID,
  organizationId: ORG_A,
};

beforeEach(() => jest.clearAllMocks());

// ── createListing ─────────────────────────────────────────────────────────────
describe('createListing', () => {
  it('creates a listing and returns 201', async () => {
    (listingService.createListing as jest.Mock).mockResolvedValue(sampleListing);
    const app = buildApp({ userId: MENTOR_ID, orgId: ORG_A });

    const res = await request(app).post('/listings').send({
      title: 'Test Listing',
      description: 'A description',
      price: 99.99,
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ title: 'Test Listing' });
    expect(listingService.createListing).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Test Listing', mentorId: MENTOR_ID }),
      ORG_A,
    );
  });

  it('returns 400 with Zod field errors on invalid input', async () => {
    const app = buildApp({ userId: MENTOR_ID });

    const res = await request(app).post('/listings').send({ price: 10 }); // missing title + description

    expect(res.status).toBe(400);
    expect(res.body.errors).toHaveProperty('title');
    expect(res.body.errors).toHaveProperty('description');
    expect(listingService.createListing).not.toHaveBeenCalled();
  });

  it('returns 401 when user is not authenticated', async () => {
    const app = buildApp({}); // no userId

    const res = await request(app).post('/listings').send({
      title: 'X',
      description: 'Y',
    });

    expect(res.status).toBe(401);
  });

  it('propagates ListingService errors to the global error handler', async () => {
    (listingService.createListing as jest.Mock).mockRejectedValue(new Error('DB error'));
    const app = buildApp({ userId: MENTOR_ID });

    const res = await request(app).post('/listings').send({
      title: 'T',
      description: 'D',
    });

    expect(res.status).toBe(500);
    expect(res.body.message).toBe('DB error');
  });
});

// ── getListing ────────────────────────────────────────────────────────────────
describe('getListing', () => {
  it('returns a listing when found', async () => {
    (listingService.findById as jest.Mock).mockResolvedValue(sampleListing);
    const app = buildApp({ userId: MENTOR_ID, orgId: ORG_A });

    const res = await request(app).get(`/listings/${LISTING_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(LISTING_ID);
    expect(listingService.findById).toHaveBeenCalledWith(LISTING_ID, ORG_A);
  });

  it('returns 404 when listing does not belong to the requesting org', async () => {
    // Service returns null when org does not match
    (listingService.findById as jest.Mock).mockResolvedValue(null);
    const app = buildApp({ userId: MENTOR_ID, orgId: ORG_B });

    const res = await request(app).get(`/listings/${LISTING_ID}`);

    expect(res.status).toBe(404);
  });

  it('propagates service errors via next(err)', async () => {
    (listingService.findById as jest.Mock).mockRejectedValue(new Error('lookup failed'));
    const app = buildApp({ userId: MENTOR_ID });

    const res = await request(app).get(`/listings/${LISTING_ID}`);

    expect(res.status).toBe(500);
  });
});

// ── deleteListing ─────────────────────────────────────────────────────────────
describe('deleteListing', () => {
  it('soft-deletes and returns 204', async () => {
    (listingService.deleteListing as jest.Mock).mockResolvedValue(undefined);
    const app = buildApp({ userId: MENTOR_ID, orgId: ORG_A });

    const res = await request(app).delete(`/listings/${LISTING_ID}`);

    expect(res.status).toBe(204);
    expect(listingService.deleteListing).toHaveBeenCalledWith(LISTING_ID, MENTOR_ID, ORG_A);
  });

  it('returns 401 when unauthenticated', async () => {
    const app = buildApp({});

    const res = await request(app).delete(`/listings/${LISTING_ID}`);

    expect(res.status).toBe(401);
    expect(listingService.deleteListing).not.toHaveBeenCalled();
  });

  it('propagates service errors via next(err)', async () => {
    (listingService.deleteListing as jest.Mock).mockRejectedValue(new Error('not found'));
    const app = buildApp({ userId: MENTOR_ID });

    const res = await request(app).delete(`/listings/${LISTING_ID}`);

    expect(res.status).toBe(500);
  });
});

// ── listListings — pagination ─────────────────────────────────────────────────
describe('listListings pagination', () => {
  it('forwards limit and cursor params to ListingService.list', async () => {
    (listingService.list as jest.Mock).mockResolvedValue({ data: [sampleListing], total: 1 });
    const app = buildApp({ userId: MENTOR_ID, orgId: ORG_A });

    const res = await request(app).get('/listings?page=2&limit=5');

    expect(res.status).toBe(200);
    expect(listingService.list).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2, limit: 5 }),
      ORG_A,
    );
    expect(res.body.pagination).toBeDefined();
  });

  it('includes pagination metadata in the response', async () => {
    (listingService.list as jest.Mock).mockResolvedValue({
      data: [sampleListing, sampleListing],
      total: 10,
    });
    const app = buildApp({ orgId: ORG_A });

    const res = await request(app).get('/listings?page=1&limit=2');

    expect(res.body.pagination.total).toBe(10);
    expect(res.body.pagination.hasNext).toBe(true);
  });
});
