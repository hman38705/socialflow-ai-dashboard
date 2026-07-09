/**
 * Unit tests for youtubeSyncJob — pagination cursor handling and quota-exceeded error path.
 *
 * Closes #1059
 */

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({ id: 'test-job-1' }),
    close: jest.fn().mockResolvedValue(undefined),
  })),
  Worker: jest.fn().mockImplementation((_name: string, processor: any) => ({
    processor,
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../config/runtime', () => ({
  getRedisConnection: jest.fn().mockReturnValue({}),
}));

jest.mock('../services/YouTubeService', () => ({
  youTubeService: {
    isConfigured: jest.fn().mockReturnValue(true),
    listChannelVideos: jest.fn(),
    getVideoStats: jest.fn(),
    refreshAccessToken: jest.fn(),
  },
}));

import { Worker, Queue } from 'bullmq';
import { startYouTubeSyncJob, stopYouTubeSyncJob, enqueueYouTubeSync, YouTubeSyncPayload } from '../jobs/youtubeSyncJob';
import { youTubeService } from '../services/YouTubeService';

const mockStats = [
  {
    videoId: 'vid-1',
    title: 'Video One',
    publishedAt: '2026-01-01T00:00:00Z',
    viewCount: 1000,
    likeCount: 50,
    commentCount: 5,
    channelId: 'ch-1',
    channelTitle: 'My Channel',
  },
];

function makePayload(overrides: Partial<YouTubeSyncPayload> = {}): YouTubeSyncPayload {
  return {
    accessToken: 'access-token-123',
    refreshToken: 'refresh-token-456',
    expiresAt: Date.now() + 3_600_000, // 1 hour from now
    ...overrides,
  };
}

function makeJob(data: YouTubeSyncPayload): any {
  return { id: 'yt-job-1', data };
}

function getWorkerProcessor(): (job: any) => Promise<any> {
  const calls = (Worker as unknown as jest.Mock).mock.calls;
  if (!calls.length) throw new Error('Worker constructor was not called');
  return calls[0][1];
}

beforeAll(async () => {
  await startYouTubeSyncJob();
});

afterAll(async () => {
  await stopYouTubeSyncJob();
});

beforeEach(() => {
  jest.clearAllMocks();
  (youTubeService.isConfigured as jest.Mock).mockReturnValue(true);
  (youTubeService.listChannelVideos as jest.Mock).mockResolvedValue(['vid-1', 'vid-2', 'vid-3']);
  (youTubeService.getVideoStats as jest.Mock).mockResolvedValue(mockStats);
  (youTubeService.refreshAccessToken as jest.Mock).mockResolvedValue({
    accessToken: 'refreshed-token',
    refreshToken: 'refresh-token-456',
    expiresAt: Date.now() + 3_600_000,
  });
});

// ── pagination cursor handling ────────────────────────────────────────────────

describe('youtubeSyncJob — pagination cursor handling', () => {
  it('passes all video IDs returned by listChannelVideos to getVideoStats', async () => {
    const processor = getWorkerProcessor();
    const paginatedIds = ['vid-1', 'vid-2', 'vid-3', 'vid-4', 'vid-5'];
    (youTubeService.listChannelVideos as jest.Mock).mockResolvedValue(paginatedIds);

    await processor(makeJob(makePayload()));

    expect(youTubeService.getVideoStats).toHaveBeenCalledWith('access-token-123', paginatedIds);
  });

  it('handles a large paginated result spanning many pages', async () => {
    const processor = getWorkerProcessor();
    const manyIds = Array.from({ length: 150 }, (_, i) => `vid-${i}`);
    (youTubeService.listChannelVideos as jest.Mock).mockResolvedValue(manyIds);
    (youTubeService.getVideoStats as jest.Mock).mockResolvedValue(
      manyIds.map((videoId) => ({ ...mockStats[0], videoId })),
    );

    const result = await processor(makeJob(makePayload()));

    expect(youTubeService.getVideoStats).toHaveBeenCalledWith('access-token-123', manyIds);
    expect(result.synced).toBe(150);
  });

  it('calls getVideoStats with an empty array when listChannelVideos returns no videos', async () => {
    const processor = getWorkerProcessor();
    (youTubeService.listChannelVideos as jest.Mock).mockResolvedValue([]);
    (youTubeService.getVideoStats as jest.Mock).mockResolvedValue([]);

    const result = await processor(makeJob(makePayload()));

    expect(youTubeService.getVideoStats).toHaveBeenCalledWith('access-token-123', []);
    expect(result.synced).toBe(0);
  });

  it('handles a DegradedResponse from listChannelVideos by falling back to empty list', async () => {
    const processor = getWorkerProcessor();
    // DegradedResponse is not a plain array — simulate the degraded shape
    const degradedResponse = { data: [], degraded: true, reason: 'Circuit breaker open' };
    (youTubeService.listChannelVideos as jest.Mock).mockResolvedValue(degradedResponse);
    (youTubeService.getVideoStats as jest.Mock).mockResolvedValue([]);

    const result = await processor(makeJob(makePayload()));

    // Non-array listChannelVideos result → resolvedIds = []
    expect(youTubeService.getVideoStats).toHaveBeenCalledWith('access-token-123', []);
    expect(result.synced).toBe(0);
  });

  it('handles a DegradedResponse from getVideoStats by reporting zero synced', async () => {
    const processor = getWorkerProcessor();
    (youTubeService.listChannelVideos as jest.Mock).mockResolvedValue(['vid-1', 'vid-2']);
    const degradedStats = { data: [], degraded: true, reason: 'YouTube temporarily unavailable' };
    (youTubeService.getVideoStats as jest.Mock).mockResolvedValue(degradedStats);

    const result = await processor(makeJob(makePayload()));

    // Non-array stats → resolvedStats = []
    expect(result.synced).toBe(0);
  });

  it('returns a result with synced count and ISO timestamp', async () => {
    const processor = getWorkerProcessor();
    (youTubeService.listChannelVideos as jest.Mock).mockResolvedValue(['vid-1']);
    (youTubeService.getVideoStats as jest.Mock).mockResolvedValue([mockStats[0]]);

    const result = await processor(makeJob(makePayload()));

    expect(result.synced).toBe(1);
    expect(typeof result.timestamp).toBe('string');
    expect(() => new Date(result.timestamp)).not.toThrow();
  });

  it('uses fresh access token when it has not expired', async () => {
    const processor = getWorkerProcessor();
    const payload = makePayload({ accessToken: 'still-valid-token', expiresAt: Date.now() + 7_200_000 });

    await processor(makeJob(payload));

    expect(youTubeService.refreshAccessToken).not.toHaveBeenCalled();
    expect(youTubeService.listChannelVideos).toHaveBeenCalledWith('still-valid-token');
  });

  it('refreshes the access token when it has expired before calling listChannelVideos', async () => {
    const processor = getWorkerProcessor();
    const expiredPayload = makePayload({
      accessToken: 'expired-token',
      refreshToken: 'my-refresh',
      expiresAt: Date.now() - 1_000, // already expired
    });
    (youTubeService.refreshAccessToken as jest.Mock).mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'my-refresh',
      expiresAt: Date.now() + 3_600_000,
    });

    await processor(makeJob(expiredPayload));

    expect(youTubeService.refreshAccessToken).toHaveBeenCalledWith('my-refresh');
    expect(youTubeService.listChannelVideos).toHaveBeenCalledWith('new-access-token');
  });
});

// ── quota-exceeded error path ─────────────────────────────────────────────────

describe('youtubeSyncJob — quota-exceeded error path', () => {
  it('propagates an error from listChannelVideos so BullMQ can retry the job', async () => {
    const processor = getWorkerProcessor();
    const quotaError = Object.assign(new Error('YouTube API quota exceeded. Quota resets at ...'), {
      name: 'YouTubeQuotaError',
    });
    (youTubeService.listChannelVideos as jest.Mock).mockRejectedValue(quotaError);

    await expect(processor(makeJob(makePayload()))).rejects.toThrow('YouTube API quota exceeded');
  });

  it('does not call getVideoStats when listChannelVideos throws quota error', async () => {
    const processor = getWorkerProcessor();
    (youTubeService.listChannelVideos as jest.Mock).mockRejectedValue(
      new Error('Quota exceeded'),
    );

    await expect(processor(makeJob(makePayload()))).rejects.toThrow();
    expect(youTubeService.getVideoStats).not.toHaveBeenCalled();
  });

  it('propagates a quota error thrown during getVideoStats', async () => {
    const processor = getWorkerProcessor();
    (youTubeService.listChannelVideos as jest.Mock).mockResolvedValue(['vid-1']);
    (youTubeService.getVideoStats as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Quota exceeded on video stats'), { name: 'YouTubeQuotaError' }),
    );

    await expect(processor(makeJob(makePayload()))).rejects.toThrow('Quota exceeded on video stats');
  });

  it('propagates generic API errors from listChannelVideos', async () => {
    const processor = getWorkerProcessor();
    (youTubeService.listChannelVideos as jest.Mock).mockRejectedValue(
      new Error('YouTube API error: 500 — Internal Server Error'),
    );

    await expect(processor(makeJob(makePayload()))).rejects.toThrow('YouTube API error');
  });

  it('propagates token-refresh errors before even listing videos', async () => {
    const processor = getWorkerProcessor();
    const expiredPayload = makePayload({ expiresAt: Date.now() - 1000 });
    (youTubeService.refreshAccessToken as jest.Mock).mockRejectedValue(
      new Error('Token refresh failed'),
    );

    await expect(processor(makeJob(expiredPayload))).rejects.toThrow('Token refresh failed');
    expect(youTubeService.listChannelVideos).not.toHaveBeenCalled();
  });
});

// ── enqueueYouTubeSync ────────────────────────────────────────────────────────

describe('enqueueYouTubeSync', () => {
  it('adds a one-off job to the queue with the supplied payload', async () => {
    await enqueueYouTubeSync(makePayload());

    const addMock = (Queue as unknown as jest.Mock).mock.results[0].value.add as jest.Mock;
    expect(addMock).toHaveBeenCalledWith(
      'sync-youtube-analytics',
      expect.objectContaining({ accessToken: 'access-token-123' }),
      expect.objectContaining({ removeOnComplete: 10, removeOnFail: 20 }),
    );
  });
});
