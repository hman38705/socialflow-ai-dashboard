/**
 * #1057 — platformMedianJob unit tests
 * Covers: median computation correctness and cache invalidation on new data.
 */

// ── mock prisma ───────────────────────────────────────────────────────────────
jest.mock('../lib/prisma', () => ({
  prisma: { analyticsEntry: { findMany: jest.fn() } },
}));

// ── mock predictiveService ────────────────────────────────────────────────────
const mockSeedFromMedians = jest.fn();
jest.mock('../services/PredictiveService', () => ({
  predictiveService: { seedFromMedians: mockSeedFromMedians },
}));

// ── mock BullMQ ───────────────────────────────────────────────────────────────
let capturedProcessor: (() => Promise<any>) | null = null;
const mockQueue = { add: jest.fn(), close: jest.fn() };
const mockWorker = { on: jest.fn(), close: jest.fn() };

jest.mock('bullmq', () => ({
  Queue: jest.fn(() => mockQueue),
  Worker: jest.fn((_name: string, processor: () => Promise<any>) => {
    capturedProcessor = processor;
    return mockWorker;
  }),
}));

// ── mock runtime config ───────────────────────────────────────────────────────
jest.mock('../config/runtime', () => ({ getRedisConnection: () => ({}) }));
jest.mock('../lib/logger', () => ({ createLogger: () => ({ info: jest.fn(), error: jest.fn() }) }));

import { computePlatformMedians, startPlatformMedianJob } from '../jobs/platformMedianJob';
import { prisma } from '../lib/prisma';

const mockFindMany = prisma.analyticsEntry.findMany as jest.Mock;

beforeAll(async () => {
  await startPlatformMedianJob();
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── computePlatformMedians ────────────────────────────────────────────────────
describe('computePlatformMedians — median computation correctness', () => {
  it('returns median of odd-count values (middle element)', async () => {
    mockFindMany.mockResolvedValue([
      { platform: 'instagram', metric: 'reach', value: 10 },
      { platform: 'instagram', metric: 'reach', value: 30 },
      { platform: 'instagram', metric: 'reach', value: 20 },
    ]);

    const medians = await computePlatformMedians();

    // sorted: [10, 20, 30] → middle = 20
    expect(medians.instagram.avgReach).toBe(20);
  });

  it('returns average of two middle values for even-count arrays', async () => {
    mockFindMany.mockResolvedValue([
      { platform: 'twitter', metric: 'engagement', value: 2 },
      { platform: 'twitter', metric: 'engagement', value: 8 },
      { platform: 'twitter', metric: 'engagement', value: 4 },
      { platform: 'twitter', metric: 'engagement', value: 6 },
    ]);

    const medians = await computePlatformMedians();

    // sorted: [2, 4, 6, 8] → (4+6)/2 = 5
    expect(medians.twitter.avgEngagement).toBe(5);
  });

  it('returns the single value when only one data point exists', async () => {
    mockFindMany.mockResolvedValue([
      { platform: 'tiktok', metric: 'reach', value: 999 },
    ]);

    const medians = await computePlatformMedians();

    expect(medians.tiktok.avgReach).toBe(999);
  });

  it('computes each platform independently', async () => {
    mockFindMany.mockResolvedValue([
      { platform: 'instagram', metric: 'reach', value: 100 },
      { platform: 'instagram', metric: 'reach', value: 200 },
      { platform: 'instagram', metric: 'reach', value: 300 },
      { platform: 'facebook', metric: 'reach', value: 50 },
      { platform: 'facebook', metric: 'reach', value: 150 },
    ]);

    const medians = await computePlatformMedians();

    expect(medians.instagram.avgReach).toBe(200);  // median of [100,200,300]
    expect(medians.facebook.avgReach).toBe(100);   // median of [50,150]
  });

  it('omits avgReach when no reach rows exist for a platform', async () => {
    mockFindMany.mockResolvedValue([
      { platform: 'linkedin', metric: 'engagement', value: 5 },
      { platform: 'linkedin', metric: 'engagement', value: 15 },
    ]);

    const medians = await computePlatformMedians();

    expect(medians.linkedin.avgEngagement).toBe(10);
    expect(medians.linkedin.avgReach).toBeUndefined();
  });

  it('returns an empty object when no analytics rows exist', async () => {
    mockFindMany.mockResolvedValue([]);

    const medians = await computePlatformMedians();

    expect(medians).toEqual({});
  });

  it('correctly handles unsorted input values', async () => {
    mockFindMany.mockResolvedValue([
      { platform: 'youtube', metric: 'reach', value: 500 },
      { platform: 'youtube', metric: 'reach', value: 100 },
      { platform: 'youtube', metric: 'reach', value: 900 },
      { platform: 'youtube', metric: 'reach', value: 300 },
      { platform: 'youtube', metric: 'reach', value: 700 },
    ]);

    const medians = await computePlatformMedians();

    // sorted: [100,300,500,700,900] → median = 500
    expect(medians.youtube.avgReach).toBe(500);
  });
});

// ── job worker — cache invalidation on new data ───────────────────────────────
describe('platformMedianJob worker — cache invalidation on new data', () => {
  it('calls predictiveService.seedFromMedians with the computed medians', async () => {
    mockFindMany.mockResolvedValue([
      { platform: 'instagram', metric: 'engagement', value: 4 },
      { platform: 'instagram', metric: 'engagement', value: 8 },
    ]);

    await capturedProcessor!();

    expect(mockSeedFromMedians).toHaveBeenCalledTimes(1);
    expect(mockSeedFromMedians).toHaveBeenCalledWith(
      expect.objectContaining({
        instagram: expect.objectContaining({ avgEngagement: 6 }),
      }),
    );
  });

  it('returns the computed medians object from the processor', async () => {
    mockFindMany.mockResolvedValue([
      { platform: 'tiktok', metric: 'reach', value: 1000 },
    ]);

    const result = await capturedProcessor!();

    expect(result).toEqual({ tiktok: { avgReach: 1000 } });
  });

  it('seeds again on subsequent runs reflecting new data', async () => {
    mockFindMany.mockResolvedValueOnce([
      { platform: 'facebook', metric: 'reach', value: 200 },
    ]);
    await capturedProcessor!();
    expect(mockSeedFromMedians).toHaveBeenLastCalledWith(
      expect.objectContaining({ facebook: { avgReach: 200 } }),
    );

    mockFindMany.mockResolvedValueOnce([
      { platform: 'facebook', metric: 'reach', value: 200 },
      { platform: 'facebook', metric: 'reach', value: 400 },
    ]);
    await capturedProcessor!();

    // median of [200,400] = 300 after new data
    expect(mockSeedFromMedians).toHaveBeenLastCalledWith(
      expect.objectContaining({ facebook: { avgReach: 300 } }),
    );
  });

  it('schedules with a 6-hour cron pattern', () => {
    expect(mockQueue.add).toHaveBeenCalledWith(
      'compute-platform-medians',
      {},
      expect.objectContaining({
        repeat: expect.objectContaining({ pattern: '0 */6 * * *' }),
      }),
    );
  });

  it('registers a failed event listener on the worker', () => {
    expect(mockWorker.on).toHaveBeenCalledWith('failed', expect.any(Function));
  });
});
