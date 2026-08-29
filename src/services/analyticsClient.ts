import { AnalyticsService as GeneratedAnalyticsService } from '../api/services/AnalyticsService';

export type Platform = 'twitter' | 'linkedin' | 'instagram' | 'tiktok';
export type AnalyticsRange = string | { from: number; to: number };

export interface AnalyticsQuery {
  range?: AnalyticsRange;
  from?: number;
  to?: number;
  platform?: Platform;
  organizationId?: string;
  orgId?: string;
}

export interface AnalyticsMetricSet {
  likes: number;
  comments: number;
  shares: number;
  views: number;
  clicks: number;
  posts: number;
  engagement: number;
  engagementRate: number;
  deltas: Record<string, number>;
}

export interface AnalyticsOverview extends AnalyticsMetricSet {
  metrics: AnalyticsMetricSet;
}

export interface AnalyticsTimeSeriesPoint extends AnalyticsMetricSet {
  date: string;
}

export interface PlatformBreakdown extends AnalyticsMetricSet {
  platform: Platform | string;
}

export interface TopPost extends AnalyticsMetricSet {
  id: string;
  platform?: Platform | string;
}

export interface EngagementByHour extends AnalyticsMetricSet {
  hour: number;
}

type Payload = Record<string, unknown>;
type NumericMetric = 'likes' | 'comments' | 'shares' | 'views' | 'clicks' | 'posts' | 'engagement';
const METRICS: NumericMetric[] = ['likes', 'comments', 'shares', 'views', 'clicks', 'posts', 'engagement'];
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { expiresAt: number; payload: Payload }>();

const isRecord = (value: unknown): value is Payload => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Malformed analytics payload: ${path} must be a finite number`);
  }
  return value;
}

function optionalNumber(value: unknown, fallback = 0): number {
  return value === undefined || value === null ? fallback : number(value, 'metric');
}

function metricSet(value: unknown, path: string): AnalyticsMetricSet {
  if (!isRecord(value)) throw new Error(`Malformed analytics payload: ${path} must be an object`);
  const result = {} as AnalyticsMetricSet;
  for (const metric of METRICS) result[metric] = optionalNumber(value[metric]);
  result.engagementRate = result.views === 0 ? 0 : result.engagement / result.views;
  result.deltas = {};
  return result;
}

function delta(current: number, previous: number): number {
  return previous === 0 ? (current === 0 ? 0 : 100) : ((current - previous) / Math.abs(previous)) * 100;
}

function withDeltas(current: AnalyticsMetricSet, previous: unknown): AnalyticsMetricSet {
  if (previous === undefined || previous === null) return current;
  const prior = metricSet(previous, 'previousPeriod');
  current.deltas = Object.fromEntries(METRICS.map((metric) => [metric, delta(current[metric] as number, prior[metric] as number)]));
  current.deltas.engagementRate = delta(current.engagementRate, prior.engagementRate);
  return current;
}

function unwrap(payload: Payload): Payload {
  const data = payload.data;
  return isRecord(data) ? data : payload;
}

function list(payload: Payload, key: string): unknown[] {
  const value = payload[key];
  if (!Array.isArray(value)) throw new Error(`Malformed analytics payload: ${key} must be an array`);
  return value;
}

function queryKey(query: AnalyticsQuery): string {
  const range = typeof query.range === 'object' ? `${query.range.from}:${query.range.to}` : query.range ?? `${query.from ?? ''}:${query.to ?? ''}`;
  return `${range}|${query.platform ?? ''}|${query.organizationId ?? query.orgId ?? ''}`;
}

function dates(query: AnalyticsQuery): string[] {
  const range = typeof query.range === 'object' ? query.range : { from: query.from, to: query.to };
  if (range.from === undefined || range.to === undefined) return [];
  const result: string[] = [];
  for (let time = new Date(range.from); time.getTime() <= range.to; time.setUTCDate(time.getUTCDate() + 1)) result.push(time.toISOString().slice(0, 10));
  return result;
}

async function fetchPayload(query: AnalyticsQuery): Promise<Payload> {
  const key = queryKey(query);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.payload;
  const range = typeof query.range === 'object' ? query.range : undefined;
  try {
    const payload = await GeneratedAnalyticsService.getAnalytics({ platform: query.platform, from: range?.from ?? query.from, to: range?.to ?? query.to });
    if (!isRecord(payload)) throw new Error('Malformed analytics payload: response must be an object');
    cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, payload });
    return payload;
  } catch (error) {
    console.error('[Analytics] malformed payload or request failed', error);
    throw error;
  }
}

export const analytics = {
  async getOverview(query: AnalyticsQuery = {}): Promise<AnalyticsOverview> {
    try {
      const payload = unwrap(await fetchPayload(query));
      const current = withDeltas(metricSet(payload.overview ?? payload.metrics ?? payload, 'overview'), payload.previousPeriod);
      return { ...current, metrics: current };
    } catch (error) {
      console.error('[Analytics] malformed overview payload', error);
      throw error;
    }
  },

  async getTimeSeries(query: AnalyticsQuery = {}): Promise<AnalyticsTimeSeriesPoint[]> {
    try {
      const payload = unwrap(await fetchPayload(query));
      const source = new Map<string, AnalyticsTimeSeriesPoint>();
      for (const [index, item] of list(payload, 'timeSeries').entries()) {
        if (!isRecord(item) || typeof (item.date ?? item.day) !== 'string') throw new Error(`Malformed analytics payload: timeSeries[${index}] date`);
        const point = metricSet(item, `timeSeries[${index}]`);
        source.set(String(item.date ?? item.day).slice(0, 10), { ...point, date: String(item.date ?? item.day).slice(0, 10) });
      }
      return dates(query).map((date) => source.get(date) ?? { ...metricSet({}, `timeSeries.${date}`), date });
    } catch (error) {
      console.error('[Analytics] malformed time series payload', error);
      throw error;
    }
  },

  async getPlatformBreakdown(query: AnalyticsQuery = {}): Promise<PlatformBreakdown[]> {
    try {
      const payload = unwrap(await fetchPayload(query));
      return list(payload, 'platformBreakdown').map((item, index) => {
        if (!isRecord(item) || typeof item.platform !== 'string') throw new Error(`Malformed analytics payload: platformBreakdown[${index}] platform`);
        return { ...metricSet(item, `platformBreakdown[${index}]`), platform: item.platform };
      });
    } catch (error) {
      console.error('[Analytics] malformed platform breakdown payload', error);
      throw error;
    }
  },

  async getTopPosts(query: AnalyticsQuery = {}): Promise<TopPost[]> {
    try {
      const payload = unwrap(await fetchPayload(query));
      return list(payload, 'topPosts').map((item, index) => {
        if (!isRecord(item) || (typeof item.id !== 'string' && typeof item.postId !== 'string')) throw new Error(`Malformed analytics payload: topPosts[${index}] id`);
        return { ...metricSet(item, `topPosts[${index}]`), id: String(item.id ?? item.postId), platform: typeof item.platform === 'string' ? item.platform : undefined };
      });
    } catch (error) {
      console.error('[Analytics] malformed top posts payload', error);
      throw error;
    }
  },

  async getEngagementByHour(query: AnalyticsQuery = {}): Promise<EngagementByHour[]> {
    try {
      const payload = unwrap(await fetchPayload(query));
      return list(payload, 'engagementByHour').map((item, index) => {
        if (!isRecord(item) || typeof item.hour !== 'number' || !Number.isInteger(item.hour) || item.hour < 0 || item.hour > 23) throw new Error(`Malformed analytics payload: engagementByHour[${index}] hour`);
        return { ...metricSet(item, `engagementByHour[${index}]`), hour: item.hour };
      });
    } catch (error) {
      console.error('[Analytics] malformed hourly engagement payload', error);
      throw error;
    }
  },

  clearCache(): void { cache.clear(); },
};
