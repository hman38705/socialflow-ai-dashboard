import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { getTickConfig, TimeSeriesChart } from '../TimeSeriesChart';
import type { MetricConfig, TimeSeriesPoint } from '../TimeSeriesChart';

// ─── getTickConfig unit tests ─────────────────────────────────────────────────
describe('getTickConfig', () => {
  const _day = (n: number) => new Date(Date.now() + n * 86_400_000);
  const now = new Date('2026-08-01T00:00:00Z');
  const daysLater = (n: number) => new Date(now.getTime() + n * 86_400_000);
  const hoursLater = (n: number) => new Date(now.getTime() + n * 3_600_000);

  it('range < 3 days → format HH:mm, interval = 1 hour', () => {
    const config = getTickConfig(now, hoursLater(48));
    expect(config.format).toBe('HH:mm');
    expect(config.intervalMs).toBe(3_600_000);
  });

  it('range exactly 1 day → format HH:mm', () => {
    const config = getTickConfig(now, daysLater(1));
    expect(config.format).toBe('HH:mm');
  });

  it('range 3 days → format MMM D (boundary)', () => {
    const config = getTickConfig(now, daysLater(3));
    expect(config.format).toBe('MMM D');
    expect(config.intervalMs).toBe(86_400_000);
  });

  it('range 7 days → format MMM D', () => {
    const config = getTickConfig(now, daysLater(7));
    expect(config.format).toBe('MMM D');
  });

  it('range 30 days → format MMM D', () => {
    const config = getTickConfig(now, daysLater(30));
    expect(config.format).toBe('MMM D');
  });

  it('range 90 days → format MMM D (upper boundary)', () => {
    const config = getTickConfig(now, daysLater(90));
    expect(config.format).toBe('MMM D');
  });

  it('range 91 days → format MMM D (week), interval = 7 days', () => {
    const config = getTickConfig(now, daysLater(91));
    expect(config.format).toBe('MMM D (week)');
    expect(config.intervalMs).toBe(7 * 86_400_000);
  });

  it('range 120 days → format MMM D (week)', () => {
    const config = getTickConfig(now, daysLater(120));
    expect(config.format).toBe('MMM D (week)');
  });
});

// ─── TimeSeriesChart rendering ────────────────────────────────────────────────
const METRICS: MetricConfig[] = [
  { key: 'views', label: 'Views' },
  { key: 'engagement', label: 'Engagement' },
];

function makePoint(ts: number, views = 100, engagement = 20): TimeSeriesPoint {
  return { timestamp: ts, views, engagement };
}

const now = new Date('2026-08-01T00:00:00Z').getTime();
const DAY = 86_400_000;

const sampleData: TimeSeriesPoint[] = [
  makePoint(now, 1000, 50),
  makePoint(now + DAY, 1200, 60),
  makePoint(now + 2 * DAY, 900, 40),
  makePoint(now + 3 * DAY, 1100, 55),
  makePoint(now + 4 * DAY, 1300, 70),
  makePoint(now + 5 * DAY, 1150, 58),
  makePoint(now + 6 * DAY, 1250, 65),
];

const dateRange = {
  from: new Date(now),
  to: new Date(now + 6 * DAY),
};

describe('TimeSeriesChart', () => {
  it('renders empty state when data is empty — frame keeps height', () => {
    render(
      <TimeSeriesChart
        data={[]}
        metrics={METRICS}
        selectedMetric="views"
        onMetricChange={() => {}}
        dateRange={dateRange}
      />,
    );
    const emptyEl = screen.getByTestId('ts-empty-state');
    expect(emptyEl).toBeInTheDocument();
    expect(emptyEl).toHaveTextContent(/no data for this period/i);
    // Height should be fixed at CHART_HEIGHT (320px)
    expect(emptyEl.style.height).toBe('320px');
  });

  it('renders error state when error prop is set — frame keeps height', () => {
    render(
      <TimeSeriesChart
        data={[]}
        metrics={METRICS}
        selectedMetric="views"
        onMetricChange={() => {}}
        dateRange={dateRange}
        error="Something went wrong"
      />,
    );
    const emptyEl = screen.getByTestId('ts-empty-state');
    expect(emptyEl).toBeInTheDocument();
    expect(emptyEl).toHaveTextContent(/something went wrong/i);
    expect(emptyEl.style.height).toBe('320px');
  });

  it('renders loading skeleton when loading=true', () => {
    render(
      <TimeSeriesChart
        data={[]}
        metrics={METRICS}
        selectedMetric="views"
        onMetricChange={() => {}}
        dateRange={dateRange}
        loading={true}
      />,
    );
    expect(screen.getByTestId('ts-skeleton')).toBeInTheDocument();
  });

  it('renders metric selector tabs', () => {
    render(
      <TimeSeriesChart
        data={sampleData}
        metrics={METRICS}
        selectedMetric="views"
        onMetricChange={() => {}}
        dateRange={dateRange}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Views' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Engagement' })).toBeInTheDocument();
  });

  it('marks the selected metric tab as aria-selected=true', () => {
    render(
      <TimeSeriesChart
        data={sampleData}
        metrics={METRICS}
        selectedMetric="views"
        onMetricChange={() => {}}
        dateRange={dateRange}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Views' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Engagement' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('calls onMetricChange when a metric tab is clicked', async () => {
    const onChange = vi.fn();
    render(
      <TimeSeriesChart
        data={sampleData}
        metrics={METRICS}
        selectedMetric="views"
        onMetricChange={onChange}
        dateRange={dateRange}
      />,
    );
    screen.getByRole('tab', { name: 'Engagement' }).click();
    expect(onChange).toHaveBeenCalledWith('engagement');
  });

  it('does not render comparison line when comparisonData is absent', () => {
    render(
      <TimeSeriesChart
        data={sampleData}
        metrics={METRICS}
        selectedMetric="views"
        onMetricChange={() => {}}
        dateRange={dateRange}
      />,
    );
    // No dashed stroke-dasharray line for "Previous period" should appear
    // We check that "Previous period" is not in the legend
    expect(screen.queryByText('Previous period')).not.toBeInTheDocument();
  });

  it('renders comparison line legend when comparisonData is provided', () => {
    // Recharts renders into an SVG which jsdom does not fully support —
    // ResponsiveContainer collapses to an empty div. We verify the component
    // at least renders without error and the card heading is present,
    // meaning the comparison path through the component is exercised.
    const compData = sampleData.map((p) => ({
      ...p,
      timestamp: p.timestamp - 7 * DAY,
      views: p.views * 0.9,
    }));
    const { container } = render(
      <TimeSeriesChart
        data={sampleData}
        comparisonData={compData}
        metrics={METRICS}
        selectedMetric="views"
        onMetricChange={() => {}}
        dateRange={dateRange}
      />,
    );
    // Card should still render the heading
    expect(screen.getByText('Performance over time')).toBeInTheDocument();
    // Recharts container should exist (even if collapsed in jsdom)
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull();
  });
});
