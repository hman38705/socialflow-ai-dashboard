import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AnalyticsPage } from '../AnalyticsPage';
import { analytics } from '../../services/analyticsClient';

vi.mock('../../services/analyticsClient', () => ({
  analytics: {
    getOverview: vi.fn(),
    getTimeSeries: vi.fn(),
    getPlatformBreakdown: vi.fn(),
    getEngagementByHour: vi.fn(),
    getTopPosts: vi.fn(),
  },
}));

const metrics = {
  likes: 2,
  comments: 1,
  shares: 1,
  views: 100,
  clicks: 10,
  posts: 2,
  engagement: 20,
  engagementRate: 0.2,
  deltas: {},
};

describe('AnalyticsPage', () => {
  beforeEach(() => {
    vi.mocked(analytics.getOverview).mockResolvedValue({ ...metrics, metrics });
    vi.mocked(analytics.getTimeSeries).mockResolvedValue([{ ...metrics, date: '2026-01-01' }]);
    vi.mocked(analytics.getPlatformBreakdown).mockResolvedValue([
      { ...metrics, platform: 'twitter' },
    ]);
    vi.mocked(analytics.getEngagementByHour).mockResolvedValue([{ ...metrics, hour: 9 }]);
    vi.mocked(analytics.getTopPosts).mockResolvedValue([
      { ...metrics, id: 'post-1', platform: 'twitter' },
    ]);
  });

  it('shows a whole-page skeleton before the initial panels resolve', () => {
    vi.mocked(analytics.getOverview).mockReturnValue(new Promise(() => undefined));
    render(<AnalyticsPage />);
    expect(screen.getByTestId('page-skeleton')).toBeInTheDocument();
  });

  it('keeps other panels rendered when one endpoint fails', async () => {
    vi.mocked(analytics.getTimeSeries).mockRejectedValue(new Error('chart unavailable'));
    render(<AnalyticsPage />);

    expect(await screen.findByText('Key performance indicators')).toBeInTheDocument();
    expect(await screen.findByText('Platform breakdown')).toBeInTheDocument();
    expect(await screen.findByText('Top posts')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/unable to load/i);
  });

  it('passes one changed platform and range filter to every panel', async () => {
    render(<AnalyticsPage />);
    await screen.findByText('Top posts');
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: '7d' } });
    fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'linkedin' } });

    await waitFor(() =>
      expect(vi.mocked(analytics.getOverview)).toHaveBeenCalledWith({
        range: '7d',
        platform: 'linkedin',
      }),
    );
    expect(vi.mocked(analytics.getTimeSeries)).toHaveBeenCalledWith({
      range: '7d',
      platform: 'linkedin',
    });
    expect(vi.mocked(analytics.getPlatformBreakdown)).toHaveBeenCalledWith({
      range: '7d',
      platform: 'linkedin',
    });
    expect(vi.mocked(analytics.getEngagementByHour)).toHaveBeenCalledWith({
      range: '7d',
      platform: 'linkedin',
    });
    expect(vi.mocked(analytics.getTopPosts)).toHaveBeenCalledWith({
      range: '7d',
      platform: 'linkedin',
    });
  });
});
