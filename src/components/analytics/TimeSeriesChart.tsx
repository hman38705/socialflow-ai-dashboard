import React, { useMemo } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface TimeSeriesPoint {
  timestamp: number; // Unix ms
  [metricKey: string]: number;
}

export interface MetricConfig {
  key: string;
  label: string;
  formatter?: (value: number) => string;
}

export interface TimeSeriesChartProps {
  data: TimeSeriesPoint[];
  comparisonData?: TimeSeriesPoint[];
  metrics: MetricConfig[];
  selectedMetric: string;
  onMetricChange: (metric: string) => void;
  dateRange: { from: Date; to: Date };
  loading?: boolean;
  error?: string | null;
}

// ─── Chart dimensions ─────────────────────────────────────────────────────────
const CHART_HEIGHT = 320;

// ─── Color palette (Tailwind token–aligned, grayscale-distinguishable) ────────
// Primary series: solid
const PRIMARY_COLOR = '#4f83ff'; // electric blue
const COMPARE_COLOR = '#f43f5e'; // rose — distinct in grayscale as well (different lightness)

// Legend shape markers: recharts supports legendType on each series
// We use "circle" for primary and "diamond" for comparison.

// ─── Tick strategy ────────────────────────────────────────────────────────────
export interface TickConfig {
  format: 'HH:mm' | 'MMM D' | 'MMM D (week)';
  intervalMs: number;
}

export function getTickConfig(from: Date, to: Date): TickConfig {
  const rangeMs = to.getTime() - from.getTime();
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  if (rangeMs < 3 * DAY) {
    return { format: 'HH:mm', intervalMs: HOUR };
  }
  if (rangeMs <= 90 * DAY) {
    return { format: 'MMM D', intervalMs: DAY };
  }
  return { format: 'MMM D (week)', intervalMs: 7 * DAY };
}

function formatTickLabel(ts: number, format: TickConfig['format']): string {
  const d = new Date(ts);
  if (format === 'HH:mm') {
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  // Both MMM D and MMM D (week) use the same display
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
  formatter?: (value: number) => string;
  _metricLabel?: string;
}

function CustomTooltip({ active, payload, label, formatter }: CustomTooltipProps) {
  if (!active || !payload?.length || label == null) return null;

  const dateStr = new Date(label).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const fmt = formatter ?? ((v: number) => v.toLocaleString('en-US'));

  return (
    <div
      style={{
        background: '#0C1122',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 8,
        padding: '10px 14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        fontSize: 12,
        color: '#e2e8f0',
        minWidth: 160,
      }}
      data-testid="ts-tooltip"
    >
      <div style={{ color: '#94a3b8', marginBottom: 8, fontWeight: 500 }}>{dateStr}</div>
      {payload.map((entry, i) => (
        <div
          key={i}
          style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 4 }}
        >
          <span style={{ color: entry.color, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: entry.color,
              }}
            />
            {entry.name}
          </span>
          <span style={{ fontFamily: 'Fira Code, ui-monospace, monospace', color: '#e2e8f0' }}>
            {fmt(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Metric selector ──────────────────────────────────────────────────────────
interface MetricSelectorProps {
  metrics: MetricConfig[];
  selected: string;
  onChange: (key: string) => void;
}

function MetricSelector({ metrics, selected, onChange }: MetricSelectorProps) {
  return (
    <div
      role="tablist"
      aria-label="Select metric"
      style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}
    >
      {metrics.map((m) => {
        const isActive = m.key === selected;
        return (
          <button
            key={m.key}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(m.key)}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              border: isActive ? '1px solid #4f83ff' : '1px solid rgba(255,255,255,0.08)',
              background: isActive ? 'rgba(79,131,255,0.15)' : 'transparent',
              color: isActive ? '#4f83ff' : '#94a3b8',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: isActive ? 600 : 400,
              transition: 'all 0.15s',
            }}
          >
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── Empty / Error states ─────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <div
      data-testid="ts-empty-state"
      style={{
        height: CHART_HEIGHT,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#64748b',
        fontSize: 14,
        background: 'rgba(18,23,40,0.72)',
        borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      {message}
    </div>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────
const SHIMMER_STYLE = `
@keyframes ts-shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
`;

function ChartSkeleton() {
  return (
    <>
      <style>{SHIMMER_STYLE}</style>
      <div
        data-testid="ts-skeleton"
        style={{
          height: CHART_HEIGHT,
          background: 'rgba(18,23,40,0.72)',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.06)',
          overflow: 'hidden',
          position: 'relative',
        }}
        aria-hidden="true"
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.04) 50%, transparent 100%)',
            animation: 'ts-shimmer 1.5s infinite',
          }}
        />
      </div>
    </>
  );
}

// ─── Tick generator ───────────────────────────────────────────────────────────
function buildTicks(data: TimeSeriesPoint[], intervalMs: number): number[] {
  if (data.length === 0) return [];
  const ticks: number[] = [];
  const start = data[0].timestamp;
  const end = data[data.length - 1].timestamp;
  for (let t = start; t <= end; t += intervalMs) {
    ticks.push(t);
  }
  return ticks;
}

// ─── Main chart ───────────────────────────────────────────────────────────────
export function TimeSeriesChart({
  data,
  comparisonData,
  metrics,
  selectedMetric,
  onMetricChange,
  dateRange,
  loading,
  error,
}: TimeSeriesChartProps) {
  const activeMetric = metrics.find((m) => m.key === selectedMetric) ?? metrics[0];
  const formatter = activeMetric?.formatter;

  const tickConfig = useMemo(() => getTickConfig(dateRange.from, dateRange.to), [dateRange]);

  const ticks = useMemo(
    () => buildTicks(data, tickConfig.intervalMs),
    [data, tickConfig.intervalMs],
  );

  // Build combined data: primary + comparison keyed by timestamp
  const chartData = useMemo(() => {
    return data.map((point) => ({
      timestamp: point.timestamp,
      primary: point[selectedMetric] ?? 0,
    }));
  }, [data, selectedMetric]);

  const compChartData = useMemo(() => {
    if (!comparisonData?.length) return [];
    return comparisonData.map((point) => ({
      timestamp: point.timestamp,
      comparison: point[selectedMetric] ?? 0,
    }));
  }, [comparisonData, selectedMetric]);

  // Merge primary + comparison for ComposedChart (align by index)
  const mergedData = useMemo(() => {
    const maxLen = Math.max(chartData.length, compChartData.length);
    return Array.from({ length: maxLen }, (_, i) => ({
      timestamp: chartData[i]?.timestamp ?? compChartData[i]?.timestamp ?? 0,
      primary: chartData[i]?.primary,
      comparison: compChartData[i]?.comparison,
    }));
  }, [chartData, compChartData]);

  const cardStyle: React.CSSProperties = {
    background: 'rgba(18,23,40,0.72)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 12,
    padding: 20,
    overflow: 'hidden',
    boxSizing: 'border-box',
  };

  return (
    <div style={cardStyle}>
      {/* Card header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 16,
          gap: 12,
          flexWrap: 'wrap' as const,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#e2e8f0' }}>
          Performance over time
        </h3>
        <MetricSelector metrics={metrics} selected={selectedMetric} onChange={onMetricChange} />
      </div>

      {/* Chart body */}
      {loading ? (
        <ChartSkeleton />
      ) : error ? (
        <EmptyState message={error} />
      ) : data.length === 0 ? (
        <EmptyState message="No data for this period" />
      ) : (
        <div style={{ width: '100%', overflow: 'hidden' }}>
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <ComposedChart data={mergedData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="rgba(255,255,255,0.06)"
                vertical={false}
              />

              <XAxis
                dataKey="timestamp"
                type="number"
                domain={['dataMin', 'dataMax']}
                scale="time"
                ticks={ticks}
                tickFormatter={(ts) => formatTickLabel(ts, tickConfig.format)}
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                tickLine={false}
                minTickGap={40}
              />

              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={formatter ?? ((v) => v.toLocaleString('en-US'))}
                width={48}
              />

              <Tooltip content={<CustomTooltip formatter={formatter} />} />

              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: 12, color: '#94a3b8', paddingTop: 12 }}
              />

              {/* Area fill + primary line */}
              <Area
                type="monotone"
                dataKey="primary"
                name={activeMetric?.label ?? selectedMetric}
                stroke={PRIMARY_COLOR}
                fill={PRIMARY_COLOR}
                fillOpacity={0.12}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: PRIMARY_COLOR }}
                legendType="circle"
                connectNulls
                isAnimationActive={false}
              />

              {/* Comparison period — dashed line */}
              {comparisonData && comparisonData.length > 0 && (
                <Line
                  type="monotone"
                  dataKey="comparison"
                  name="Previous period"
                  stroke={COMPARE_COLOR}
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  dot={false}
                  activeDot={{ r: 3, fill: COMPARE_COLOR }}
                  legendType="diamond"
                  connectNulls
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default TimeSeriesChart;
