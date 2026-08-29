import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { formatCompact, KpiTiles } from '../KpiTiles';
import type { KpiData } from '../KpiTiles';

// ─── formatCompact unit tests ─────────────────────────────────────────────────
describe('formatCompact', () => {
  it('999 stays as "999"', () => expect(formatCompact(999)).toBe('999'));
  it('1000 → "1K"', () => expect(formatCompact(1000)).toBe('1K'));
  it('1050 → "1.1K"', () => expect(formatCompact(1050)).toBe('1.1K'));
  it('1500 → "1.5K"', () => expect(formatCompact(1500)).toBe('1.5K'));
  it('999999 → "1000K" OR handled as near-1M', () => {
    // 999999 / 1000 = 999.999 → rounds to 1000K or stays 1000K
    // Depends on rounding: toFixed(1) → "1000.0" → parseFloat → 1000, then "1000K"
    const result = formatCompact(999999);
    expect(result).toMatch(/999\.9K|1000K/);
  });
  it('1000000 → "1M"', () => expect(formatCompact(1_000_000)).toBe('1M'));
  it('1050000 → "1.1M"', () => expect(formatCompact(1_050_000)).toBe('1.1M'));
  it('1234567 → "1.2M"', () => expect(formatCompact(1_234_567)).toBe('1.2M'));
  it('0 → "0"', () => expect(formatCompact(0)).toBe('0'));
  it('negative 1500 → "-1.5K"', () => expect(formatCompact(-1500)).toBe('-1.5K'));
});

// ─── KpiTiles rendering ───────────────────────────────────────────────────────
const makeData = (override: Partial<KpiData> = {}): KpiData => ({
  impressions: { value: 1_234_567, previousValue: 1_000_000, sparkline: [10, 20, 15, 30, 25] },
  engagements: { value: 45_000, previousValue: 40_000, sparkline: [5, 8, 7, 10, 9] },
  engagementRate: { value: 3.6, previousValue: 4.0, sparkline: [3, 4, 3.5, 3.8, 3.6] },
  followerChange: { value: 500, previousValue: 0, sparkline: [100, 200, 100, 50, 50] },
  postsPublished: { value: 12, previousValue: 10, sparkline: [2, 3, 2, 2, 3] },
  ...override,
});

describe('KpiTiles', () => {
  it('renders 5 skeleton tiles when loading=true', () => {
    render(<KpiTiles data={null} loading={true} />);
    expect(screen.getAllByTestId('kpi-skeleton-tile')).toHaveLength(5);
  });

  it('renders 5 loaded tiles when loading=false and data is provided', () => {
    render(<KpiTiles data={makeData()} loading={false} />);
    expect(screen.getByTestId('kpi-tile-impressions')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-tile-engagements')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-tile-engagementRate')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-tile-followerChange')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-tile-postsPublished')).toBeInTheDocument();
  });

  it('shows compact value "1.2M" for 1,234,567 impressions', () => {
    render(<KpiTiles data={makeData()} loading={false} />);
    // The displayed text should show compact format
    const tile = screen.getByTestId('kpi-tile-impressions');
    expect(tile).toHaveTextContent('1.2M');
  });

  it('has exact value in aria-label for large numbers', () => {
    render(<KpiTiles data={makeData()} loading={false} />);
    // aria-label should include the exact formatted number
    const tile = screen.getByTestId('kpi-tile-impressions');
    const valueEl = tile.querySelector('[aria-label*="1,234,567"]');
    expect(valueEl).toBeInTheDocument();
  });

  it('shows N/A badge when previousValue is 0 (no divide-by-zero)', () => {
    render(<KpiTiles data={makeData()} loading={false} />);
    // followerChange has previousValue=0, so badge should show N/A
    const tile = screen.getByTestId('kpi-tile-followerChange');
    expect(tile).toHaveTextContent('N/A');
  });

  it('shows positive delta badge for impressions (23.5%)', () => {
    render(<KpiTiles data={makeData()} loading={false} />);
    // 1234567 vs 1000000 = +23.5%
    const tile = screen.getByTestId('kpi-tile-impressions');
    expect(tile).toHaveTextContent('+23.5%');
  });

  it('shows negative delta badge for engagementRate (drop from 4.0 to 3.6)', () => {
    render(<KpiTiles data={makeData()} loading={false} />);
    const tile = screen.getByTestId('kpi-tile-engagementRate');
    // -10% drop
    expect(tile).toHaveTextContent('-10.0');
  });

  it('skeleton and loaded tiles have the same container height (no CLS)', () => {
    const { rerender, getAllByTestId } = render(<KpiTiles data={null} loading={true} />);
    const skeletonTiles = getAllByTestId('kpi-skeleton-tile');
    const skeletonHeight = skeletonTiles[0].style.height;

    rerender(<KpiTiles data={makeData()} loading={false} />);
    // Loaded tiles should have same height style
    const loadedTile = screen.getByTestId('kpi-tile-impressions');
    expect(loadedTile.style.height).toBe(skeletonHeight);
  });
});
