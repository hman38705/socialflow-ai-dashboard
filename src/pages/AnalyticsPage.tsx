import React, { useEffect, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  analytics,
  type AnalyticsQuery,
  type AnalyticsRange,
  type Platform,
} from '../services/analyticsClient';

const platforms: Array<{ value: Platform | ''; label: string }> = [
  { value: '', label: 'All platforms' },
  { value: 'twitter', label: 'Twitter' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
];

const ranges = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

const panelStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: 20,
};
const metricLabels: Array<[keyof typeof emptyMetrics, string]> = [
  ['views', 'Views'],
  ['engagement', 'Engagement'],
  ['clicks', 'Clicks'],
  ['posts', 'Posts'],
];
const emptyMetrics = {
  likes: 0,
  comments: 0,
  shares: 0,
  views: 0,
  clicks: 0,
  posts: 0,
  engagement: 0,
  engagementRate: 0,
  deltas: {},
};

function Panel({
  title,
  loading,
  error,
  children,
}: {
  title: string;
  loading: boolean;
  error?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} style={panelStyle}>
      <h2 style={{ margin: '0 0 16px', fontSize: 18, color: '#0f172a' }}>{title}</h2>
      {loading ? (
        <div
          data-testid="panel-skeleton"
          style={{ height: 180, background: '#f1f5f9', borderRadius: 6 }}
        />
      ) : error ? (
        <p role="alert" style={{ color: '#b91c1c' }}>
          Unable to load this panel.
        </p>
      ) : (
        children
      )}
    </section>
  );
}

export function AnalyticsPage() {
  const [range, setRange] = useState('30d');
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [overview, setOverview] = useState<typeof emptyMetrics | null>(null);
  const [series, setSeries] = useState<Awaited<ReturnType<typeof analytics.getTimeSeries>>>([]);
  const [breakdown, setBreakdown] = useState<
    Awaited<ReturnType<typeof analytics.getPlatformBreakdown>>
  >([]);
  const [hourly, setHourly] = useState<Awaited<ReturnType<typeof analytics.getEngagementByHour>>>(
    [],
  );
  const [topPosts, setTopPosts] = useState<Awaited<ReturnType<typeof analytics.getTopPosts>>>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const hasLoadedOnceRef = useRef(false);
  const [panelLoading, setPanelLoading] = useState({
    overview: true,
    series: true,
    breakdown: true,
    hourly: true,
    topPosts: true,
  });
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let active = true;
    const isInitialLoad = !hasLoadedOnceRef.current;
    const query: AnalyticsQuery = {
      range: range as AnalyticsRange,
      ...(platform ? { platform } : {}),
    };
    const panels = [
      ['overview', () => analytics.getOverview(query), setOverview],
      ['series', () => analytics.getTimeSeries(query), setSeries],
      ['breakdown', () => analytics.getPlatformBreakdown(query), setBreakdown],
      ['hourly', () => analytics.getEngagementByHour(query), setHourly],
      ['topPosts', () => analytics.getTopPosts(query), setTopPosts],
    ] as const;
    setPanelLoading({
      overview: true,
      series: true,
      breakdown: true,
      hourly: true,
      topPosts: true,
    });
    setErrors({});
    Promise.all(
      panels.map(async ([name, request, setter]) => {
        try {
          const result = await request();
          if (active) setter(result as never);
        } catch {
          if (active) setErrors((current) => ({ ...current, [name]: true }));
        } finally {
          if (active) setPanelLoading((current) => ({ ...current, [name]: false }));
        }
      }),
    ).finally(() => {
      if (active && isInitialLoad) {
        hasLoadedOnceRef.current = true;
        setHasLoadedOnce(true);
      }
    });
    return () => {
      active = false;
    };
  }, [range, platform]);

  return (
    <main
      style={{
        maxWidth: 1280,
        margin: '0 auto',
        padding: '32px 24px 64px',
        color: '#334155',
        fontFamily: 'Georgia, serif',
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 20,
          alignItems: 'end',
          marginBottom: 28,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <p
            style={{
              color: '#0f766e',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 2,
              textTransform: 'uppercase',
            }}
          >
            Performance desk
          </p>
          <h1 style={{ margin: 0, fontSize: 36, color: '#0f172a' }}>Analytics</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, fontFamily: 'sans-serif' }}>
          <label>
            {' '}
            <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
              Date range
            </span>
            <select
              aria-label="Date range"
              value={range}
              onChange={(event) => setRange(event.target.value)}
              style={{ padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 6 }}
            >
              {ranges.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            {' '}
            <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
              Platform
            </span>
            <select
              aria-label="Platform"
              value={platform}
              onChange={(event) => setPlatform(event.target.value as Platform | '')}
              style={{ padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 6 }}
            >
              {platforms.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {!hasLoadedOnce ? (
        <div
          data-testid="page-skeleton"
          style={{ height: 420, background: '#f1f5f9', borderRadius: 8 }}
        />
      ) : (
        <>
          <Panel
            title="Key performance indicators"
            loading={panelLoading.overview}
            error={errors.overview}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 12,
              }}
            >
              {metricLabels.map(([key, label]) => (
                <div key={key} style={{ background: '#f8fafc', padding: 16, borderRadius: 6 }}>
                  <small>{label}</small>
                  <div style={{ fontSize: 26, color: '#0f172a', marginTop: 6 }}>
                    {(overview ?? emptyMetrics)[key].toLocaleString()}
                  </div>
                </div>
              ))}
              <div style={{ background: '#f8fafc', padding: 16, borderRadius: 6 }}>
                <small>Engagement rate</small>
                <div style={{ fontSize: 26, color: '#0f172a', marginTop: 6 }}>
                  {((overview ?? emptyMetrics).engagementRate * 100).toFixed(1)}%
                </div>
              </div>
            </div>
          </Panel>
          <div style={{ display: 'grid', gap: 20, marginTop: 20 }}>
            <Panel
              title="Performance over time"
              loading={panelLoading.series}
              error={errors.series}
            >
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="views"
                      stroke="#0f766e"
                      fill="#99f6e4"
                      fillOpacity={0.55}
                    />
                    <Area
                      type="monotone"
                      dataKey="engagement"
                      stroke="#f97316"
                      fill="#fed7aa"
                      fillOpacity={0.55}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 20,
              }}
            >
              <Panel
                title="Platform breakdown"
                loading={panelLoading.breakdown}
                error={errors.breakdown}
              >
                <div style={{ display: 'grid', gap: 10 }}>
                  {breakdown.map((item) => (
                    <div
                      key={item.platform}
                      style={{ display: 'flex', justifyContent: 'space-between' }}
                    >
                      <span>{item.platform}</span>
                      <strong>{item.views.toLocaleString()} views</strong>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel title="Engagement by hour" loading={panelLoading.hourly} error={errors.hourly}>
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourly}>
                      <XAxis dataKey="hour" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="engagement" fill="#f97316" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </div>
            <Panel title="Top posts" loading={panelLoading.topPosts} error={errors.topPosts}>
              <div style={{ overflowX: 'auto' }}>
                <table
                  style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'sans-serif' }}
                >
                  <thead>
                    <tr>
                      {['Post', 'Platform', 'Views', 'Engagement', 'Clicks'].map((heading) => (
                        <th
                          key={heading}
                          style={{
                            textAlign: 'left',
                            padding: '10px 8px',
                            borderBottom: '1px solid #e2e8f0',
                            fontSize: 12,
                          }}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {topPosts.map((post) => (
                      <tr key={post.id}>
                        {[
                          post.id,
                          post.platform ?? 'All',
                          post.views,
                          post.engagement,
                          post.clicks,
                        ].map((value, index) => (
                          <td
                            key={index}
                            style={{ padding: '12px 8px', borderBottom: '1px solid #f1f5f9' }}
                          >
                            {typeof value === 'number' ? value.toLocaleString() : value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </>
      )}
    </main>
  );
}

export default AnalyticsPage;
