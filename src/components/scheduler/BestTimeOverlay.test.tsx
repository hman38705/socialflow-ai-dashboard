import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AnalyticsService } from '../../api/services/AnalyticsService';
import BestTimeOverlay from './BestTimeOverlay';

vi.mock('../../api/services/AnalyticsService', () => ({
  AnalyticsService: { getAnalytics: vi.fn() },
}));

const getAnalytics = vi.mocked(AnalyticsService.getAnalytics);

describe('BestTimeOverlay', () => {
  beforeEach(() => {
    localStorage.clear();
    getAnalytics.mockReset();
  });

  it('explains when there is less than four weeks of history', async () => {
    getAnalytics.mockResolvedValue({ historyWeeks: 3, engagementByDayAndHour: [] });
    render(<BestTimeOverlay />);

    fireEvent.click(screen.getByRole('checkbox'));

    expect(await screen.findByText(/at least 4 weeks/i)).toBeTruthy();
  });

  it('persists the toggle state', async () => {
    getAnalytics.mockResolvedValue({ historyWeeks: 4, engagementByDayAndHour: [] });
    const first = render(<BestTimeOverlay storageKey="test-best-time" />);
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(screen.getByRole('grid')).toBeTruthy());
    first.unmount();

    render(<BestTimeOverlay storageKey="test-best-time" />);

    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('renders a text legend for heatmap intensity', async () => {
    getAnalytics.mockResolvedValue({
      historyWeeks: 4,
      engagementByDayAndHour: [{ day: 'Mon', hour: 9, engagement: 10 }],
    });
    render(<BestTimeOverlay />);
    fireEvent.click(screen.getByRole('checkbox'));

    const legend = await screen.findByLabelText('Heatmap legend');
    expect(legend.textContent).toContain('Low');
    expect(legend.textContent).toContain('Moderate');
    expect(legend.textContent).toContain('High');
  });
});
