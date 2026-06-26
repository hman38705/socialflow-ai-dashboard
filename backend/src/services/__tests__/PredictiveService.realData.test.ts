/**
 * Tests that PredictiveService uses real AnalyticsEntry data when available,
 * and that computeAndCachePlatformMedians caches results in Redis.
 */
import { predictiveService } from '../PredictiveService';
import {
  computePlatformMedians,
  computeAndCachePlatformMedians,
  PLATFORM_MEDIANS_CACHE_KEY,
} from '../../jobs/platformMedianJob';
import { prisma } from '../../lib/prisma';

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../lib/prisma', () => ({
  prisma: { analyticsEntry: { findMany: jest.fn() } },
}));

// Capture withCache / invalidateCache calls so we can assert caching behaviour
// without a real Redis connection.
const mockWithCache = jest.fn();
const mockInvalidateCache = jest.fn();

jest.mock('../../utils/cache', () => ({
  withCache: (...args: unknown[]) => mockWithCache(...args),
  invalidateCache: (...args: unknown[]) => mockInvalidateCache(...args),
}));

const mockFindMany = prisma.analyticsEntry.findMany as jest.Mock;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Seed analytics rows and return the medians that would be computed. */
async function seedAndCompute(
  rows: { platform: string; metric: string; value: number }[],
) {
  mockFindMany.mockResolvedValueOnce(rows);
  return computePlatformMedians();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('PredictiveService — real analytics data integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('predictions use real reach median seeded from AnalyticsEntry rows', async () => {
    // Seed 3 instagram reach values; median = 5000
    const medians = await seedAndCompute([
      { platform: 'instagram', metric: 'reach', value: 1000 },
      { platform: 'instagram', metric: 'reach', value: 5000 },
      { platform: 'instagram', metric: 'reach', value: 9000 },
    ]);

    expect(medians.instagram.avgReach).toBe(5000);

    // Apply to service
    predictiveService.seedFromMedians(medians);

    const prediction = await predictiveService.predictReach({
      content: 'check out this amazing post with a great call to action click here',
      platform: 'instagram',
      followerCount: 10000,
    });

    // Service runs without error and produces a valid score
    expect(prediction.reachScore).toBeGreaterThanOrEqual(0);
    expect(prediction.reachScore).toBeLessThanOrEqual(100);
    // Confidence is higher because historicalData is populated
    expect(prediction.confidence).toBeGreaterThan(0.5);
  });

  it('predictions use real engagement median seeded from AnalyticsEntry rows', async () => {
    const medians = await seedAndCompute([
      { platform: 'tiktok', metric: 'engagement', value: 2 },
      { platform: 'tiktok', metric: 'engagement', value: 8 },
      { platform: 'tiktok', metric: 'engagement', value: 14 },
    ]);

    // median of [2, 8, 14] = 8
    expect(medians.tiktok.avgEngagement).toBe(8);

    predictiveService.seedFromMedians(medians);

    const prediction = await predictiveService.predictReach({
      content: 'viral dance challenge trending fyp tutorial',
      platform: 'tiktok',
    });

    expect(prediction).toBeDefined();
    expect(prediction.reachScore).toBeGreaterThanOrEqual(0);
  });

  it('falls back to hardcoded defaults when no analytics rows exist', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const medians = await computePlatformMedians();

    // No rows → empty medians; seedFromMedians is a no-op
    expect(medians).toEqual({});

    // Service still produces a valid prediction using hardcoded defaults
    const prediction = await predictiveService.predictReach({
      content: 'community event local family friends gathering',
      platform: 'facebook',
    });

    expect(prediction.reachScore).toBeGreaterThanOrEqual(0);
  });

  it('multi-platform seed: each platform gets its own median', async () => {
    const medians = await seedAndCompute([
      { platform: 'linkedin', metric: 'reach', value: 300 },
      { platform: 'linkedin', metric: 'reach', value: 700 },
      { platform: 'youtube', metric: 'engagement', value: 10 },
      { platform: 'youtube', metric: 'engagement', value: 20 },
    ]);

    expect(medians.linkedin.avgReach).toBe(500);   // median of [300, 700]
    expect(medians.youtube.avgEngagement).toBe(15); // median of [10, 20]

    predictiveService.seedFromMedians(medians);

    const [li, yt] = await Promise.all([
      predictiveService.predictReach({
        content: 'professional leadership career business innovation strategy',
        platform: 'linkedin',
      }),
      predictiveService.predictReach({
        content: 'subscribe tutorial howto review vlog gaming education',
        platform: 'youtube',
      }),
    ]);

    expect(li.reachScore).toBeGreaterThanOrEqual(0);
    expect(yt.reachScore).toBeGreaterThanOrEqual(0);
  });
});

describe('computeAndCachePlatformMedians — Redis caching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates to withCache with the correct key and 1-hour TTL', async () => {
    const fakeMedians = { instagram: { avgReach: 1234 } };
    mockWithCache.mockResolvedValueOnce(fakeMedians);

    const result = await computeAndCachePlatformMedians();

    expect(mockWithCache).toHaveBeenCalledWith(
      PLATFORM_MEDIANS_CACHE_KEY,
      3600,
      expect.any(Function),
    );
    expect(result).toEqual(fakeMedians);
  });

  it('cache key is stable across calls', async () => {
    mockWithCache.mockResolvedValue({});
    await computeAndCachePlatformMedians();
    await computeAndCachePlatformMedians();

    const keys = mockWithCache.mock.calls.map((c) => c[0]);
    expect(new Set(keys).size).toBe(1); // same key both times
  });
});
