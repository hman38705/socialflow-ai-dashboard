/**
 * Deterministic sample analytics for the Analytics page when no real synced
 * data exists (frontend-only / offline mode). Values are seeded so charts stay
 * stable across renders.
 */

export interface DailyPoint {
  day: string;
  reach: number;
  engagement: number;
  followers: number;
}

export interface PlatformShare {
  platform: string;
  value: number;
  color: string;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Simple seeded pseudo-random so output is identical every run.
const seeded = (seed: number) => {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
};

export const buildDailySeries = (weeks = 4): DailyPoint[] => {
  const rand = seeded(42);
  const points: DailyPoint[] = [];
  let followers = 41000;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const base = 8000 + rand() * 6000 + w * 900;
      followers += Math.round(rand() * 260 + 40);
      points.push({
        day: `${DAYS[d]} W${w + 1}`,
        reach: Math.round(base),
        engagement: Math.round(base * (0.045 + rand() * 0.03)),
        followers,
      });
    }
  }
  return points;
};

export const platformShare: PlatformShare[] = [
  { platform: 'Instagram', value: 38, color: '#f43f5e' },
  { platform: 'TikTok', value: 27, color: '#22d3ee' },
  { platform: 'X', value: 18, color: '#4f83ff' },
  { platform: 'LinkedIn', value: 11, color: '#8b5cf6' },
  { platform: 'Facebook', value: 6, color: '#64748b' },
];
