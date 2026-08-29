import React, { useMemo, useState } from 'react';
export type TopPost = { id: string; content: string; platform: string; publishedAt: string | number; impressions: number; engagements: number; engagementRate: number };
export function TopPostsTable({ posts }: { posts: TopPost[] }) {
  const [sort, setSort] = useState<keyof TopPost>('engagementRate'); const rows = useMemo(() => [...posts].sort((a, b) => Number(b[sort]) - Number(a[sort])), [posts, sort]);
  if (!rows.length) return <p role="status">No published posts in this range.</p>;
  const head = (key: keyof TopPost, label: string) => <th><button onClick={() => setSort(key)}>{label}</button></th>;
  return <table><thead><tr><th>Post</th>{head('platform', 'Platform')}{head('publishedAt', 'Published')}{head('impressions', 'Impressions')}{head('engagements', 'Engagements')}{head('engagementRate', 'Rate')}</tr></thead><tbody>{rows.map(p => <tr key={p.id}><td title={p.content}><a href={`/posts/${p.id}`}>{p.content}</a></td><td>{p.platform}</td><td>{new Date(p.publishedAt).toLocaleDateString()}</td><td>{p.impressions}</td><td>{p.engagements}</td><td>{p.engagementRate}%</td></tr>)}</tbody></table>;
}
