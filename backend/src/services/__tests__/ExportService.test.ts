/**
 * Unit tests for ExportService
 *
 * Covers:
 *  1. CSV generation — correct headers, CSV header row, value formatting, quote escaping
 *  2. JSON streaming — NDJSON headers, one JSON object per line format
 *  3. Org-scoped query validation — organizationId always threaded into the DB where clause
 */

import { Readable } from 'stream';
import { ExportService } from '../ExportService';
import { Response } from 'express';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// replicaClient is used for CSV streams (read-only path)
const mockReplicaAnalyticsFindMany = jest.fn();
const mockReplicaPostFindMany = jest.fn();

jest.mock('../../lib/readReplica', () => ({
  replicaClient: {
    analyticsEntry: { findMany: mockReplicaAnalyticsFindMany },
    post: { findMany: mockReplicaPostFindMany },
  },
  applyReadWriteSplitting: jest.fn(),
}));

// prisma is used for JSON streams
const mockPrismaAnalyticsFindMany = jest.fn();
const mockPrismaPostFindMany = jest.fn();

jest.mock('../../lib/prisma', () => ({
  prisma: {
    analyticsEntry: { findMany: mockPrismaAnalyticsFindMany },
    post: { findMany: mockPrismaPostFindMany },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture all chunks pushed to a Readable that is piped into a mock Response. */
function captureStream(mockRes: Partial<Response>): string[] {
  const chunks: string[] = [];
  (mockRes.pipe as jest.Mock).mockImplementation((stream: Readable) => {
    stream.on('data', (chunk: Buffer | string) => chunks.push(chunk.toString()));
  });
  return chunks;
}

function makeMockRes(): Partial<Response> {
  return {
    setHeader: jest.fn(),
    pipe: jest.fn(),
    on: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  };
}

const START = new Date('2025-01-01');
const END = new Date('2025-12-31');
const ORG = 'org-test-123';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mockReplicaAnalyticsFindMany.mockResolvedValue([]);
  mockReplicaPostFindMany.mockResolvedValue([]);
  mockPrismaAnalyticsFindMany.mockResolvedValue([]);
  mockPrismaPostFindMany.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// 1. CSV generation — streamAnalyticsAsCSV
// ---------------------------------------------------------------------------

describe('ExportService.streamAnalyticsAsCSV — CSV generation', () => {
  it('sets Content-Type to text/csv with charset', async () => {
    const res = makeMockRes();
    await ExportService.streamAnalyticsAsCSV(ORG, START, END, res as Response);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
  });

  it('sets Content-Disposition to attachment with analytics.csv filename', async () => {
    const res = makeMockRes();
    await ExportService.streamAnalyticsAsCSV(ORG, START, END, res as Response);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="analytics.csv"',
    );
  });

  it('sets Transfer-Encoding: chunked', async () => {
    const res = makeMockRes();
    await ExportService.streamAnalyticsAsCSV(ORG, START, END, res as Response);
    expect(res.setHeader).toHaveBeenCalledWith('Transfer-Encoding', 'chunked');
  });

  it('pipes a Readable stream to the response', async () => {
    const res = makeMockRes();
    await ExportService.streamAnalyticsAsCSV(ORG, START, END, res as Response);
    expect(res.pipe).toHaveBeenCalledWith(expect.any(Readable));
  });

  it('includes CSV header row as first chunk', async () => {
    const res = makeMockRes();
    const chunks = captureStream(res);
    await ExportService.streamAnalyticsAsCSV(ORG, START, END, res as Response);
    expect(chunks[0]).toContain('id,organizationId,platform,metric,value,recordedAt');
  });

  it('serializes an analytics row to a correctly formatted CSV line', async () => {
    const row = {
      id: 'entry-1',
      organizationId: ORG,
      platform: 'twitter',
      metric: 'impressions',
      value: 420,
      recordedAt: new Date('2025-06-15T00:00:00.000Z'),
    };
    mockReplicaAnalyticsFindMany.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);

    const res = makeMockRes();
    const chunks = captureStream(res);
    await ExportService.streamAnalyticsAsCSV(ORG, START, END, res as Response);

    const csvLine = chunks.join('');
    expect(csvLine).toContain('entry-1');
    expect(csvLine).toContain('twitter');
    expect(csvLine).toContain('impressions');
    expect(csvLine).toContain('420');
    expect(csvLine).toContain('2025-06-15');
  });

  it('uses cursor-based pagination — second batch uses cursor from first', async () => {
    const batch1 = Array.from({ length: 1001 }, (_, i) => ({
      id: `id-${String(i).padStart(4, '0')}`,
      organizationId: ORG,
      platform: 'twitter',
      metric: 'impressions',
      value: i,
      recordedAt: new Date('2025-06-15'),
    }));

    mockReplicaAnalyticsFindMany
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce([]);

    const res = makeMockRes();
    await ExportService.streamAnalyticsAsCSV(ORG, START, END, res as Response);

    expect(mockReplicaAnalyticsFindMany).toHaveBeenCalledTimes(2);
    expect(mockReplicaAnalyticsFindMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        cursor: { id: 'id-0999' },
        skip: 1,
      }),
    );
  });

  it('completes without error on empty result set', async () => {
    const res = makeMockRes();
    await expect(
      ExportService.streamAnalyticsAsCSV(ORG, START, END, res as Response),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. JSON streaming — streamAnalyticsAsJSON
// ---------------------------------------------------------------------------

describe('ExportService.streamAnalyticsAsJSON — JSON streaming', () => {
  it('sets Content-Type to application/x-ndjson', async () => {
    const res = makeMockRes();
    await ExportService.streamAnalyticsAsJSON(ORG, START, END, res as Response);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/x-ndjson; charset=utf-8',
    );
  });

  it('sets Content-Disposition to attachment with analytics.jsonl filename', async () => {
    const res = makeMockRes();
    await ExportService.streamAnalyticsAsJSON(ORG, START, END, res as Response);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="analytics.jsonl"',
    );
  });

  it('sets Transfer-Encoding: chunked', async () => {
    const res = makeMockRes();
    await ExportService.streamAnalyticsAsJSON(ORG, START, END, res as Response);
    expect(res.setHeader).toHaveBeenCalledWith('Transfer-Encoding', 'chunked');
  });

  it('emits one JSON object per line (NDJSON format)', async () => {
    const rows = [
      {
        id: 'a-1',
        organizationId: ORG,
        platform: 'instagram',
        metric: 'likes',
        value: 10,
        recordedAt: new Date('2025-03-01T00:00:00.000Z'),
      },
      {
        id: 'a-2',
        organizationId: ORG,
        platform: 'youtube',
        metric: 'views',
        value: 200,
        recordedAt: new Date('2025-03-02T00:00:00.000Z'),
      },
    ];
    mockPrismaAnalyticsFindMany.mockResolvedValueOnce(rows).mockResolvedValueOnce([]);

    const res = makeMockRes();
    const chunks = captureStream(res);
    await ExportService.streamAnalyticsAsJSON(ORG, START, END, res as Response);

    const output = chunks.join('');
    const lines = output.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);

    const parsed0 = JSON.parse(lines[0]);
    expect(parsed0.id).toBe('a-1');
    expect(parsed0.platform).toBe('instagram');

    const parsed1 = JSON.parse(lines[1]);
    expect(parsed1.id).toBe('a-2');
    expect(parsed1.metric).toBe('views');
  });

  it('emits no lines for empty result set', async () => {
    const res = makeMockRes();
    const chunks = captureStream(res);
    await ExportService.streamAnalyticsAsJSON(ORG, START, END, res as Response);

    const output = chunks.join('').trim();
    expect(output).toBe('');
  });
});

// ---------------------------------------------------------------------------
// 3. Org-scoped query validation — analytics
// ---------------------------------------------------------------------------

describe('ExportService — org-scoped query validation (analytics)', () => {
  it('CSV stream filters by organizationId', async () => {
    const res = makeMockRes();
    await ExportService.streamAnalyticsAsCSV('org-abc', START, END, res as Response);
    expect(mockReplicaAnalyticsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-abc' }),
      }),
    );
  });

  it('JSON stream filters by organizationId', async () => {
    const res = makeMockRes();
    await ExportService.streamAnalyticsAsJSON('org-xyz', START, END, res as Response);
    expect(mockPrismaAnalyticsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-xyz' }),
      }),
    );
  });

  it('CSV stream never leaks data from another org', async () => {
    const otherOrgRow = {
      id: 'other-1',
      organizationId: 'org-other',
      platform: 'facebook',
      metric: 'reach',
      value: 99,
      recordedAt: new Date('2025-05-01'),
    };
    // Return rows only when queried for org-other, not for org-abc
    mockReplicaAnalyticsFindMany.mockImplementation(({ where }: any) => {
      if (where.organizationId === 'org-abc') return Promise.resolve([]);
      return Promise.resolve([otherOrgRow]);
    });

    const res = makeMockRes();
    const chunks = captureStream(res);
    await ExportService.streamAnalyticsAsCSV('org-abc', START, END, res as Response);

    const output = chunks.join('');
    expect(output).not.toContain('other-1');
    expect(output).not.toContain('org-other');
  });

  it('CSV stream applies both gte and lte date range filters', async () => {
    const res = makeMockRes();
    const start = new Date('2025-03-01');
    const end = new Date('2025-03-31');
    await ExportService.streamAnalyticsAsCSV(ORG, start, end, res as Response);

    expect(mockReplicaAnalyticsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recordedAt: { gte: start, lte: end },
        }),
      }),
    );
  });

  it('JSON stream applies both gte and lte date range filters', async () => {
    const res = makeMockRes();
    const start = new Date('2025-04-01');
    const end = new Date('2025-04-30');
    await ExportService.streamAnalyticsAsJSON(ORG, start, end, res as Response);

    expect(mockPrismaAnalyticsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recordedAt: { gte: start, lte: end },
        }),
      }),
    );
  });

  it('different org IDs produce distinct queries', async () => {
    const resA = makeMockRes();
    const resB = makeMockRes();
    await ExportService.streamAnalyticsAsCSV('org-A', START, END, resA as Response);
    await ExportService.streamAnalyticsAsCSV('org-B', START, END, resB as Response);

    const calls = (mockReplicaAnalyticsFindMany as jest.Mock).mock.calls;
    const orgIds = calls.map((c: any) => c[0].where.organizationId);
    expect(orgIds).toContain('org-A');
    expect(orgIds).toContain('org-B');
  });
});

// ---------------------------------------------------------------------------
// 4. CSV generation — streamPostsAsCSV
// ---------------------------------------------------------------------------

describe('ExportService.streamPostsAsCSV — CSV generation', () => {
  it('sets Content-Type to text/csv', async () => {
    const res = makeMockRes();
    await ExportService.streamPostsAsCSV(ORG, START, END, res as Response);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
  });

  it('sets Content-Disposition to attachment with posts.csv filename', async () => {
    const res = makeMockRes();
    await ExportService.streamPostsAsCSV(ORG, START, END, res as Response);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="posts.csv"',
    );
  });

  it('includes CSV header row', async () => {
    const res = makeMockRes();
    const chunks = captureStream(res);
    await ExportService.streamPostsAsCSV(ORG, START, END, res as Response);
    expect(chunks[0]).toContain('id,organizationId,content,platform');
  });

  it('escapes double-quotes in post content per RFC 4180', async () => {
    const post = {
      id: 'p-1',
      organizationId: ORG,
      content: 'She said "hello world"',
      platform: 'twitter',
      scheduledAt: null,
      createdAt: new Date('2025-06-01'),
    };
    mockReplicaPostFindMany.mockResolvedValueOnce([post]).mockResolvedValueOnce([]);

    const res = makeMockRes();
    const chunks = captureStream(res);
    await ExportService.streamPostsAsCSV(ORG, START, END, res as Response);

    const output = chunks.join('');
    // RFC 4180: embedded quotes are doubled
    expect(output).toContain('""hello world""');
  });

  it('handles null scheduledAt gracefully (outputs empty string)', async () => {
    const post = {
      id: 'p-2',
      organizationId: ORG,
      content: 'No schedule',
      platform: 'instagram',
      scheduledAt: null,
      createdAt: new Date('2025-06-02'),
    };
    mockReplicaPostFindMany.mockResolvedValueOnce([post]).mockResolvedValueOnce([]);

    const res = makeMockRes();
    const chunks = captureStream(res);
    await ExportService.streamPostsAsCSV(ORG, START, END, res as Response);

    const output = chunks.join('');
    // scheduledAt column should be an empty quoted string
    expect(output).toContain('""');
  });

  it('filters posts by organizationId', async () => {
    const res = makeMockRes();
    await ExportService.streamPostsAsCSV('org-posts-scope', START, END, res as Response);
    expect(mockReplicaPostFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-posts-scope' }),
      }),
    );
  });

  it('uses createdAt date range for posts query', async () => {
    const res = makeMockRes();
    const start = new Date('2025-02-01');
    const end = new Date('2025-02-28');
    await ExportService.streamPostsAsCSV(ORG, start, end, res as Response);

    expect(mockReplicaPostFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: start, lte: end },
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// 5. JSON streaming — streamPostsAsJSON
// ---------------------------------------------------------------------------

describe('ExportService.streamPostsAsJSON — JSON streaming', () => {
  it('sets Content-Type to application/x-ndjson', async () => {
    const res = makeMockRes();
    await ExportService.streamPostsAsJSON(ORG, START, END, res as Response);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/x-ndjson; charset=utf-8',
    );
  });

  it('sets Content-Disposition to attachment with posts.jsonl filename', async () => {
    const res = makeMockRes();
    await ExportService.streamPostsAsJSON(ORG, START, END, res as Response);
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="posts.jsonl"',
    );
  });

  it('emits one valid JSON object per line', async () => {
    const posts = [
      {
        id: 'post-a',
        organizationId: ORG,
        content: 'Line A',
        platform: 'twitter',
        scheduledAt: null,
        createdAt: new Date('2025-05-10T12:00:00.000Z'),
      },
      {
        id: 'post-b',
        organizationId: ORG,
        content: 'Line B',
        platform: 'facebook',
        scheduledAt: null,
        createdAt: new Date('2025-05-11T12:00:00.000Z'),
      },
    ];
    mockPrismaPostFindMany.mockResolvedValueOnce(posts).mockResolvedValueOnce([]);

    const res = makeMockRes();
    const chunks = captureStream(res);
    await ExportService.streamPostsAsJSON(ORG, START, END, res as Response);

    const output = chunks.join('');
    const lines = output.trim().split('\n').filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).id).toBe('post-a');
    expect(JSON.parse(lines[1]).id).toBe('post-b');
  });

  it('filters posts by organizationId in JSON stream', async () => {
    const res = makeMockRes();
    await ExportService.streamPostsAsJSON('org-json-scope', START, END, res as Response);
    expect(mockPrismaPostFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org-json-scope' }),
      }),
    );
  });
});
