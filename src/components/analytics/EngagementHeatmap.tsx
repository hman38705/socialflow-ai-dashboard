import React, { useMemo, useState } from 'react';
export type HeatmapCell = { day: string; hour: number; value: number | null };
export function EngagementHeatmap({ data }: { data: HeatmapCell[] }) {
  const [table, setTable] = useState(false); const values = data.map(c => c.value).filter((v): v is number => v !== null); const min = Math.min(0, ...values); const max = Math.max(0, ...values);
  const color = (v: number | null) => v === null ? '#ddd' : `hsl(210 70% ${90 - (max ? (v / max) * 50 : 0)}%)`;
  const cells = useMemo(() => Array.from({ length: 7 * 24 }, (_, i) => data.find(c => c.day === String(Math.floor(i / 24)) && c.hour === i % 24) ?? { day: String(Math.floor(i / 24)), hour: i % 24, value: null }), [data]);
  return <section><button onClick={() => setTable(v => !v)}>View as table</button>{table ? <table><tbody>{cells.map(c => <tr key={`${c.day}-${c.hour}`}><td>{c.day}</td><td>{c.hour}:00</td><td>{c.value ?? 'Empty'}</td></tr>)}</tbody></table> : <div aria-label={`Engagement scale ${min} to ${max}`} style={{ display: 'grid', gridTemplateColumns: 'repeat(24, 1fr)' }}>{cells.map(c => <span key={`${c.day}-${c.hour}`} tabIndex={0} title={`${c.day}, ${c.hour}:00: ${c.value ?? 'empty'}`} aria-label={`${c.day}, ${c.hour}:00, value ${c.value ?? 'empty'}`} style={{ background: color(c.value), minHeight: 16 }} />)}</div>}<small>Legend: {min} (low) – {max} (high); empty cells are gray.</small></section>;
}
