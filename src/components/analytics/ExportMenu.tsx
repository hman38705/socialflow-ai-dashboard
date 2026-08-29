import React, { useRef, useState } from 'react';
import type { PostAnalytics } from '../../services/AnalyticsService';
import { analyticsFilename, exportCsv } from '../../lib/exportCsv';

export function ExportMenu({
  rows,
  filename,
  from = 'all-time',
  to = 'now',
  platform = 'all-platforms',
}: {
  rows: PostAnalytics[];
  filename?: string;
  from?: string;
  to?: string;
  platform?: string;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const controller = useRef<AbortController | undefined>(undefined);
  const start = async () => {
    controller.current = new AbortController();
    setProgress(0);
    try {
      await exportCsv(
        rows,
        filename ?? analyticsFilename(from, to, platform),
        setProgress,
        controller.current.signal,
      );
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') throw error;
    } finally {
      setProgress(null);
    }
  };
  return (
    <span>
      <button onClick={start} disabled={progress !== null}>
        Export CSV
      </button>
      {progress !== null && (
        <>
          <span role="status"> {progress}%</span>
          <button onClick={() => controller.current?.abort()}>Cancel</button>
        </>
      )}
    </span>
  );
}
