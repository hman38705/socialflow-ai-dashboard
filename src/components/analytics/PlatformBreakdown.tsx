import React from 'react';
export type PlatformMetric = { platform: string; likes: number; shares: number; comments: number; clicks?: number };
export function PlatformBreakdown({ data, stacked = false, onSelect }: { data: PlatformMetric[]; stacked?: boolean; onSelect?: (platform: string) => void }) {
  const rows = [...data].sort((a, b) => (b.likes + b.shares + b.comments) - (a.likes + a.shares + a.comments));
  const max = Math.max(1, ...rows.map(r => r.likes + r.shares + r.comments + (r.clicks ?? 0)));
  return <div aria-label="Platform engagement breakdown">{rows.map(row => <button key={row.platform} title={row.platform} onClick={() => onSelect?.(row.platform)} style={{ display: 'block', width: '100%', textAlign: 'left' }}><span>{row.platform}</span><span style={{ display: 'inline-flex', width: `${(100 * (row.likes + row.shares + row.comments + (row.clicks ?? 0))) / max}%` }}>{stacked ? `${row.likes} likes · ${row.shares} shares · ${row.comments} comments · ${row.clicks ?? 0} clicks` : `${row.likes + row.shares + row.comments + (row.clicks ?? 0)}`}</span></button>)}</div>;
}
