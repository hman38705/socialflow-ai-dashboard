import { analytics } from './analyticsClient';
import { AnalyticsService as GeneratedAnalyticsService } from '../api/services/AnalyticsService';

vi.mock('../api/services/AnalyticsService', () => ({
  AnalyticsService: { getAnalytics: vi.fn() },
}));

const getAnalytics = vi.mocked(GeneratedAnalyticsService.getAnalytics);

describe('analytics client', () => {
  beforeEach(() => {
    analytics.clearCache();
    getAnalytics.mockReset();
  });

  it('normalizes overview metrics and derives rates and deltas', async () => {
    getAnalytics.mockResolvedValue({
      overview: { likes: 20, comments: 5, shares: 5, views: 100, clicks: 10, posts: 2, engagement: 30 },
      previousPeriod: { likes: 10, comments: 5, shares: 5, views: 100, clicks: 5, posts: 1, engagement: 20 },
    });

    const result = await analytics.getOverview({ range: '7d', organizationId: 'org-1' });

    expect(result.engagementRate).toBe(0.3);
    expect(result.deltas.likes).toBe(100);
    expect(result.deltas.engagement).toBe(50);
    expect(result.metrics.likes).toBe(result.likes);
  });

  it('uses zero-safe delta math and fills missing dates', async () => {
    getAnalytics.mockResolvedValue({
      overview: { likes: 1, comments: 0, shares: 0, views: 0, clicks: 0, posts: 1, engagement: 0 },
      previousPeriod: { likes: 0, comments: 0, shares: 0, views: 0, clicks: 0, posts: 0, engagement: 0 },
      timeSeries: [{ date: '2026-01-01', views: 4, engagement: 2 }],
    });

    const overview = await analytics.getOverview({ from: Date.parse('2026-01-01'), to: Date.parse('2026-01-03') });
    const series = await analytics.getTimeSeries({ from: Date.parse('2026-01-01'), to: Date.parse('2026-01-03') });

    expect(overview.deltas.likes).toBe(100);
    expect(overview.deltas.comments).toBe(0);
    expect(series.map((point) => point.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(series[1].views).toBe(0);
    expect(series[1].engagementRate).toBe(0);
  });

  it('rejects and reports malformed responses', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    getAnalytics.mockResolvedValue({ platformBreakdown: [{ platform: 'twitter', views: 'bad' }] });

    await expect(analytics.getPlatformBreakdown()).rejects.toThrow(/finite number/);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('memoizes requests by range, platform, and organization', async () => {
    getAnalytics.mockResolvedValue({ engagementByHour: [] });
    const query = { range: '30d', platform: 'twitter' as const, organizationId: 'org-1' };

    await analytics.getEngagementByHour(query);
    await analytics.getEngagementByHour(query);
    await analytics.getEngagementByHour({ ...query, organizationId: 'org-2' });

    expect(getAnalytics).toHaveBeenCalledTimes(2);
  });
});
