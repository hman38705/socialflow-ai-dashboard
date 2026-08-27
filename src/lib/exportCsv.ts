import type { PostAnalytics } from '../services/AnalyticsService';

const unsafe = /^[=+\-@]/;
export const analyticsFilename = (from: string, to: string, platform = 'all-platforms') => `analytics_${from}_${to}_${platform}.csv`;
const escape = (value: unknown) => {
  let text = String(value ?? '');
  if (unsafe.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
export async function exportCsv(rows: PostAnalytics[], filename: string, onProgress?: (percent: number) => void, signal?: AbortSignal) {
  const fields = ['id', 'platform', 'postId', 'postedAt', 'likes', 'shares', 'views', 'comments', 'syncedAt'] as const;
  const output = [fields.join(',')];
  for (let index = 0; index < rows.length; index++) { const row = rows[index]; if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError'); output.push(fields.map(field => escape(row[field])).join(',')); if (onProgress && (index % 100 === 0 || index === rows.length - 1)) onProgress(Math.round(((index + 1) / rows.length) * 100)); if (index % 100 === 0) await new Promise(resolve => setTimeout(resolve, 0)); }
  const blob = new Blob([`\uFEFF${output.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}
