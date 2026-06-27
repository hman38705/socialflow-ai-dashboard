/**
 * Unit tests for PostController — create/update/delete operations,
 * org scoping, and media URL attachment. Closes #1068
 */
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockCreate = jest.fn();
const mockFindFirst = jest.fn();
const mockUpdate = jest.fn();
const mockPrismaDelete = jest.fn();

jest.mock('../lib/prisma', () => ({
  prisma: {
    post: {
      create: (...args: any[]) => mockCreate(...args),
      findFirst: (...args: any[]) => mockFindFirst(...args),
      update: (...args: any[]) => mockUpdate(...args),
      delete: (...args: any[]) => mockPrismaDelete(...args),
    },
  },
}));

const mockModerate = jest.fn();
jest.mock('../services/ModerationService', () => ({
  ModerationService: { moderate: (...args: any[]) => mockModerate(...args) },
}));

const mockIndexPost = jest.fn();
const mockDeleteSearchPost = jest.fn();
jest.mock('../services/SearchService', () => ({
  indexPost: (...args: any[]) => mockIndexPost(...args),
  deletePost: (...args: any[]) => mockDeleteSearchPost(...args),
}));

jest.mock('../lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const FIXED_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
jest.mock('crypto', () => ({
  ...jest.requireActual('crypto'),
  randomUUID: () => FIXED_UUID,
}));

import { createPost, updatePost, deletePost } from '../controllers/PostController';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ORG_A = 'org-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'org-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const POST_ID = 'post-1111-1111-1111-111111111111';

function makeReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    body: {},
    params: {},
    user: { id: 'user-1' },
    activeOrgId: ORG_A,
    ...overrides,
  } as unknown as AuthRequest;
}

function makeRes(): jest.Mocked<Response> {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    end: jest.fn().mockReturnThis(),
  } as unknown as jest.Mocked<Response>;
}

const next: NextFunction = jest.fn();

const cleanModeration = { flagged: false, blocked: false, categories: {}, scores: {} };

function makePost(overrides: Record<string, unknown> = {}) {
  return {
    id: POST_ID,
    organizationId: ORG_A,
    content: 'Hello world',
    platform: 'twitter',
    scheduledAt: null,
    moderationStatus: 'pending',
    mediaUrls: [],
    createdAt: new Date('2025-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  (next as jest.Mock).mockReset();
  mockModerate.mockResolvedValue(cleanModeration);
  mockCreate.mockResolvedValue(makePost());
  mockFindFirst.mockResolvedValue(makePost());
  mockUpdate.mockResolvedValue(makePost());
  mockPrismaDelete.mockResolvedValue(makePost());
});

// ── createPost ────────────────────────────────────────────────────────────────

describe('createPost', () => {
  it('creates a post and responds with 201', async () => {
    const req = makeReq({ body: { content: 'Hello world', platform: 'twitter', organizationId: ORG_A } });
    const res = makeRes();

    await createPost(req, res, next);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          id: FIXED_UUID,
          organizationId: ORG_A,
          content: 'Hello world',
          platform: 'twitter',
        }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ id: POST_ID, moderation: { flagged: false } }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('attaches mediaUrls to create data when provided', async () => {
    const mediaUrls = ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'];
    const req = makeReq({
      body: { content: 'With media', platform: 'instagram', organizationId: ORG_A, mediaUrls },
    });
    const res = makeRes();

    await createPost(req, res, next);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mediaUrls }) }),
    );
  });

  it('omits mediaUrls from create data when not provided', async () => {
    const req = makeReq({ body: { content: 'No media', platform: 'twitter', organizationId: ORG_A } });
    const res = makeRes();

    await createPost(req, res, next);

    const callData = mockCreate.mock.calls[0][0].data;
    expect(callData).not.toHaveProperty('mediaUrls');
  });

  it('blocks creation and passes BadRequestError to next when content is moderated-blocked', async () => {
    mockModerate.mockResolvedValue({
      flagged: true,
      blocked: true,
      categories: { hate: true },
      scores: { hate: 0.95 },
      reason: 'hate speech detected',
    });
    const req = makeReq({ body: { content: 'Bad content', platform: 'twitter', organizationId: ORG_A } });
    const res = makeRes();

    await createPost(req, res, next);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONTENT_BLOCKED' }));
  });

  it('includes moderation flag in response when content is flagged but not blocked', async () => {
    mockModerate.mockResolvedValue({
      flagged: true,
      blocked: false,
      categories: { violence: true },
      scores: { violence: 0.5 },
      reason: 'mild violence',
    });
    const req = makeReq({ body: { content: 'Flagged content', platform: 'twitter', organizationId: ORG_A } });
    const res = makeRes();

    await createPost(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ moderation: { flagged: true, reason: 'mild violence' } }),
    );
  });

  it('fails open and still creates the post when ModerationService throws', async () => {
    mockModerate.mockRejectedValue(new Error('OpenAI API unavailable'));
    const req = makeReq({ body: { content: 'Hello', platform: 'twitter', organizationId: ORG_A } });
    const res = makeRes();

    await createPost(req, res, next);

    expect(mockCreate).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('fires indexPost with the new post data after creation', async () => {
    const post = makePost({ createdAt: new Date('2025-06-01T12:00:00Z') });
    mockCreate.mockResolvedValue(post);
    const req = makeReq({ body: { content: 'Hello world', platform: 'twitter', organizationId: ORG_A } });
    const res = makeRes();

    await createPost(req, res, next);

    expect(mockIndexPost).toHaveBeenCalledWith(
      expect.objectContaining({ id: POST_ID, organizationId: ORG_A, content: 'Hello world' }),
    );
  });

  it('sets scheduledAt to the parsed Date when provided', async () => {
    const scheduledAt = '2026-12-01T10:00:00.000Z';
    const req = makeReq({
      body: { content: 'Scheduled', platform: 'linkedin', organizationId: ORG_A, scheduledAt },
    });
    const res = makeRes();

    await createPost(req, res, next);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scheduledAt: new Date(scheduledAt) }) }),
    );
  });

  it('sets scheduledAt to null when not provided', async () => {
    const req = makeReq({ body: { content: 'Immediate', platform: 'twitter', organizationId: ORG_A } });
    const res = makeRes();

    await createPost(req, res, next);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scheduledAt: null }) }),
    );
  });

  it('forwards errors to next when prisma.post.create throws', async () => {
    const dbError = new Error('DB connection lost');
    mockCreate.mockRejectedValue(dbError);
    const req = makeReq({ body: { content: 'Hello', platform: 'twitter', organizationId: ORG_A } });
    const res = makeRes();

    await createPost(req, res, next);

    expect(next).toHaveBeenCalledWith(dbError);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('org scoping: uses organizationId from request body, not req.activeOrgId', async () => {
    // Caller's auth context is ORG_B but the body explicitly requests ORG_A
    const req = makeReq({
      activeOrgId: ORG_B,
      body: { content: 'Hello', platform: 'twitter', organizationId: ORG_A },
    });
    const res = makeRes();

    await createPost(req, res, next);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG_A }) }),
    );
  });
});

// ── updatePost ────────────────────────────────────────────────────────────────

describe('updatePost', () => {
  it('updates an existing post and returns 200 with the updated post', async () => {
    const updated = makePost({ content: 'Updated content' });
    mockUpdate.mockResolvedValue(updated);
    const req = makeReq({ params: { id: POST_ID }, body: { content: 'Updated content' }, activeOrgId: ORG_A });
    const res = makeRes();

    await updatePost(req, res, next);

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: POST_ID, organizationId: ORG_A }) }),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: POST_ID },
        data: expect.objectContaining({ content: 'Updated content' }),
      }),
    );
    expect(res.json).toHaveBeenCalledWith(updated);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 when the post does not exist', async () => {
    mockFindFirst.mockResolvedValue(null);
    const req = makeReq({ params: { id: 'ghost-id' }, body: { content: 'Updated' }, activeOrgId: ORG_A });
    const res = makeRes();

    await updatePost(req, res, next);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('org scoping: returns 404 (not 403) when the post belongs to a different org', async () => {
    mockFindFirst.mockResolvedValue(null); // ORG_B scoped query finds nothing
    const req = makeReq({ params: { id: POST_ID }, body: { content: 'Hijack' }, activeOrgId: ORG_B });
    const res = makeRes();

    await updatePost(req, res, next);

    // Lookup must be scoped to ORG_B — no information about ORG_A's post is leaked
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('blocks the update and calls next with CONTENT_BLOCKED when moderation rejects the new content', async () => {
    mockModerate.mockResolvedValue({
      flagged: true, blocked: true, reason: 'policy violation', categories: {}, scores: {},
    });
    const req = makeReq({ params: { id: POST_ID }, body: { content: 'Blocked content' }, activeOrgId: ORG_A });
    const res = makeRes();

    await updatePost(req, res, next);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONTENT_BLOCKED' }));
  });

  it('attaches updated mediaUrls when provided', async () => {
    const mediaUrls = ['https://cdn.example.com/new.jpg'];
    const req = makeReq({ params: { id: POST_ID }, body: { mediaUrls }, activeOrgId: ORG_A });
    const res = makeRes();

    await updatePost(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mediaUrls }) }),
    );
  });

  it('skips moderation when content is not part of the update payload', async () => {
    const req = makeReq({ params: { id: POST_ID }, body: { platform: 'linkedin' }, activeOrgId: ORG_A });
    const res = makeRes();

    await updatePost(req, res, next);

    expect(mockModerate).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('parses scheduledAt to a Date when provided', async () => {
    const scheduledAt = '2027-01-01T09:00:00.000Z';
    const req = makeReq({ params: { id: POST_ID }, body: { scheduledAt }, activeOrgId: ORG_A });
    const res = makeRes();

    await updatePost(req, res, next);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ scheduledAt: new Date(scheduledAt) }) }),
    );
  });

  it('does not include fields that were absent from the update payload', async () => {
    const req = makeReq({ params: { id: POST_ID }, body: { content: 'Only content' }, activeOrgId: ORG_A });
    const res = makeRes();

    await updatePost(req, res, next);

    const updateData = mockUpdate.mock.calls[0][0].data;
    expect(updateData).toHaveProperty('content');
    expect(updateData).not.toHaveProperty('platform');
    expect(updateData).not.toHaveProperty('scheduledAt');
    expect(updateData).not.toHaveProperty('mediaUrls');
  });

  it('forwards errors to next when prisma.post.update throws', async () => {
    const dbError = new Error('DB write failed');
    mockUpdate.mockRejectedValue(dbError);
    const req = makeReq({ params: { id: POST_ID }, body: { content: 'New content' }, activeOrgId: ORG_A });
    const res = makeRes();

    await updatePost(req, res, next);

    expect(next).toHaveBeenCalledWith(dbError);
  });
});

// ── deletePost ────────────────────────────────────────────────────────────────

describe('deletePost', () => {
  it('deletes the post and returns 204', async () => {
    const req = makeReq({ params: { id: POST_ID }, activeOrgId: ORG_A });
    const res = makeRes();

    await deletePost(req, res, next);

    expect(mockPrismaDelete).toHaveBeenCalledWith(expect.objectContaining({ where: { id: POST_ID } }));
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 when the post does not exist', async () => {
    mockFindFirst.mockResolvedValue(null);
    const req = makeReq({ params: { id: 'ghost-id' }, activeOrgId: ORG_A });
    const res = makeRes();

    await deletePost(req, res, next);

    expect(mockPrismaDelete).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('org scoping: returns 404 (not 403) when the post belongs to a different org', async () => {
    mockFindFirst.mockResolvedValue(null); // ORG_B scoped query finds nothing
    const req = makeReq({ params: { id: POST_ID }, activeOrgId: ORG_B });
    const res = makeRes();

    await deletePost(req, res, next);

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }),
    );
    expect(mockPrismaDelete).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('removes the post from the search index after deletion', async () => {
    const req = makeReq({ params: { id: POST_ID }, activeOrgId: ORG_A });
    const res = makeRes();

    await deletePost(req, res, next);

    expect(mockDeleteSearchPost).toHaveBeenCalledWith(POST_ID);
  });

  it('forwards errors to next when prisma.post.delete throws', async () => {
    const dbError = new Error('Constraint violation');
    mockPrismaDelete.mockRejectedValue(dbError);
    const req = makeReq({ params: { id: POST_ID }, activeOrgId: ORG_A });
    const res = makeRes();

    await deletePost(req, res, next);

    expect(next).toHaveBeenCalledWith(dbError);
  });
});
