import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyticsService, type Platform, type PostAnalytics } from '../services/AnalyticsService';

export interface AnalyticsFilters { from?: number; to?: number; platform?: Platform; org?: string }
type Entry = { data: PostAnalytics[]; updated: number };
const cache = new Map<string, Entry>();
const TTL = 5 * 60 * 1000;

export function useAnalyticsQuery(filters: AnalyticsFilters = {}) {
  const key = useMemo(() => JSON.stringify(filters), [filters.from, filters.to, filters.platform, filters.org]);
  const [entry, setEntry] = useState<Entry | null>(() => cache.get(key) ?? null);
  const [loading, setLoading] = useState(!cache.has(key));
  const [error, setError] = useState<Error | null>(null);
  const generation = useRef(0);
  const lastFocus = useRef(0);
  const load = useCallback(async (force = false) => {
    const requestId = ++generation.current;
    const cached = cache.get(key);
    if (cached && !force && Date.now() - cached.updated < TTL) { setEntry(cached); return; }
    setLoading(!cached); setError(null);
    try {
      const rows = filters.from !== undefined && filters.to !== undefined ? await analyticsService.getByDateRange(filters.from, filters.to) : await analyticsService.getAll();
      if (requestId !== generation.current) return;
      const data = filters.platform ? rows.filter(row => row.platform === filters.platform) : rows;
      const next = { data, updated: Date.now() }; cache.set(key, next); setEntry(next);
    } catch (cause) { setError(cause instanceof Error ? cause : new Error('Analytics unavailable')); }
    finally { setLoading(false); }
  }, [key, filters.from, filters.to, filters.platform]);
  useEffect(() => { setEntry(cache.get(key) ?? null); load(); }, [key, load]);
  useEffect(() => {
    const onFocus = () => { if (Date.now() - lastFocus.current >= 60_000) { lastFocus.current = Date.now(); load(true); } };
    window.addEventListener('focus', onFocus); return () => window.removeEventListener('focus', onFocus);
  }, [load]);
  return { data: entry?.data ?? [], updatedAt: entry?.updated ?? null, stale: !!entry && Date.now() - entry.updated >= TTL, loading, error, refresh: () => load(true) };
}
