import React from 'react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface KpiMetric {
  value: number;
  previousValue: number;
  sparkline: number[];
}

export interface KpiData {
  impressions: KpiMetric;
  engagements: KpiMetric;
  engagementRate: KpiMetric; // 0–100
  followerChange: KpiMetric;
  postsPublished: KpiMetric;
}

export interface KpiTilesProps {
  data: KpiData | null;
  loading: boolean;
}

// ─── Formatting ───────────────────────────────────────────────────────────────
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const compact = value / 1_000_000;
    return `${parseFloat(compact.toFixed(1))}M`;
  }
  if (abs >= 1_000) {
    const compact = value / 1_000;
    return `${parseFloat(compact.toFixed(1))}K`;
  }
  return String(value);
}

function formatExact(value: number): string {
  return value.toLocaleString('en-US');
}

function computeDeltaPct(current: number, previous: number): number | null {
  if (previous === 0) return null; // guard against divide-by-zero
  return ((current - previous) / Math.abs(previous)) * 100;
}

// ─── StatBadge ────────────────────────────────────────────────────────────────
interface StatBadgeProps {
  current: number;
  previous: number;
  isRate?: boolean; // for engagement rate: suffix is "pp" not "%"
}

function StatBadge({ current, previous, isRate }: StatBadgeProps) {
  const delta = computeDeltaPct(current, previous);

  if (delta === null) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 3,
          fontSize: 11,
          color: '#94a3b8',
          background: 'rgba(148,163,184,0.1)',
          borderRadius: 4,
          padding: '2px 6px',
          fontFamily: 'Fira Code, ui-monospace, monospace',
        }}
        aria-label="No previous period data"
      >
        N/A
      </span>
    );
  }

  const isPositive = delta >= 0;
  const color = isPositive ? '#34d399' : '#fb7185';
  const bg = isPositive ? 'rgba(52,211,153,0.1)' : 'rgba(251,113,133,0.1)';
  const arrow = isPositive ? '↑' : '↓';
  const label = `${isPositive ? '+' : ''}${delta.toFixed(1)}% vs previous period`;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontSize: 11,
        color,
        background: bg,
        borderRadius: 4,
        padding: '2px 6px',
        fontFamily: 'Fira Code, ui-monospace, monospace',
      }}
      title={label}
      aria-label={label}
    >
      <span aria-hidden="true">{arrow}</span>
      {isPositive ? '+' : ''}
      {delta.toFixed(1)}
      {isRate ? 'pp' : '%'}
    </span>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ data, color }: { data: number[]; color: string }) {
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <div style={{ width: '100%', height: 40 }} aria-hidden="true">
      <ResponsiveContainer width="100%" height={40}>
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Skeleton tile ────────────────────────────────────────────────────────────
// Must match exactly the same height as a loaded tile to prevent CLS.
// Loaded tile height is determined by its content structure below.
// We use a fixed class-driven height: 120px.
const TILE_HEIGHT = 120;

function SkeletonTile() {
  return (
    <div
      data-testid="kpi-skeleton-tile"
      style={{
        height: TILE_HEIGHT,
        background: 'rgba(18,23,40,0.72)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: '16px',
        overflow: 'hidden',
        position: 'relative',
      }}
      aria-hidden="true"
    >
      {/* Shimmer overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
          animation: 'shimmer 1.5s infinite',
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div
          style={{
            width: '50%',
            height: 12,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 4,
          }}
        />
        <div
          style={{
            width: '70%',
            height: 24,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 4,
          }}
        />
        <div
          style={{
            width: '40%',
            height: 12,
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 4,
          }}
        />
      </div>
    </div>
  );
}

// ─── Single KPI tile ──────────────────────────────────────────────────────────
interface TileConfig {
  key: keyof KpiData;
  label: string;
  color: string;
  isRate?: boolean;
  suffix?: string;
}

const TILE_CONFIGS: TileConfig[] = [
  { key: 'impressions', label: 'Impressions', color: '#4f83ff' },
  { key: 'engagements', label: 'Engagements', color: '#22d3ee' },
  { key: 'engagementRate', label: 'Engagement Rate', color: '#8b5cf6', isRate: true, suffix: '%' },
  { key: 'followerChange', label: 'Follower Change', color: '#34d399' },
  { key: 'postsPublished', label: 'Posts Published', color: '#f43f5e' },
];

interface KpiTileProps {
  config: TileConfig;
  metric: KpiMetric;
}

function KpiTile({ config, metric }: KpiTileProps) {
  const { label, color, isRate, suffix } = config;
  const display = isRate
    ? `${metric.value.toFixed(1)}${suffix ?? ''}`
    : formatCompact(metric.value);
  const exact = isRate ? `${metric.value.toFixed(2)}${suffix ?? ''}` : formatExact(metric.value);

  return (
    <div
      data-testid={`kpi-tile-${config.key}`}
      style={{
        height: TILE_HEIGHT,
        background: 'rgba(18,23,40,0.72)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        overflow: 'hidden',
        boxSizing: 'border-box' as const,
      }}
    >
      {/* Top row: label + badge */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span
          style={{
            fontSize: 12,
            color: '#94a3b8',
            letterSpacing: 0.3,
            textTransform: 'uppercase' as const,
          }}
        >
          {label}
        </span>
        <StatBadge current={metric.value} previous={metric.previousValue} isRate={isRate} />
      </div>

      {/* Value */}
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: '#e2e8f0',
          fontFamily: 'Fira Code, ui-monospace, monospace',
          lineHeight: 1.1,
        }}
        title={exact}
        aria-label={`${label}: ${exact}`}
      >
        {display}
      </div>

      {/* Sparkline */}
      {metric.sparkline.length > 1 && <Sparkline data={metric.sparkline} color={color} />}
    </div>
  );
}

// ─── Shimmer keyframe injection ───────────────────────────────────────────────
const SHIMMER_STYLE = `
@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
`;

function ShimmerStyle() {
  return <style>{SHIMMER_STYLE}</style>;
}

// ─── KpiTiles ─────────────────────────────────────────────────────────────────
export function KpiTiles({ data, loading }: KpiTilesProps) {
  return (
    <>
      <ShimmerStyle />
      <div
        data-testid="kpi-tiles"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 12,
        }}
        // Responsive: we can't use Tailwind classes with inline styles, so we
        // use a style tag approach for the grid. For a Tailwind-based project,
        // swap to className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3"
      >
        {TILE_CONFIGS.map((config) =>
          loading || !data ? (
            <SkeletonTile key={config.key} />
          ) : (
            <KpiTile key={config.key} config={config} metric={data[config.key]} />
          ),
        )}
      </div>
    </>
  );
}

export default KpiTiles;
