import React, { useEffect, useState } from 'react';
import { ChevronDown, Loader2, X } from 'lucide-react';
import { useJobs } from '../../contexts/JobsContext';

const AUTO_DISMISS_MS = 10000;

/** Compact, collapsible list of active/recent background jobs, mounted once in the app layout. */
export const JobProgressPanel: React.FC = () => {
  const { jobs, jobEvents, removeJob } = useJobs();
  const [collapsed, setCollapsed] = useState(false);

  // Completed jobs auto-dismiss after 10s; failed jobs stay until the user dismisses them.
  useEffect(() => {
    const timers = jobs
      .filter((job) => jobEvents[job.id]?.status === 'completed')
      .map((job) => setTimeout(() => removeJob(job.id), AUTO_DISMISS_MS));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobEvents]);

  if (jobs.length === 0) return null;

  const runningCount = jobs.filter((j) => {
    const s = jobEvents[j.id]?.status;
    return s !== 'completed' && s !== 'failed';
  }).length;

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed bottom-4 left-4 z-40 bg-dark-card border border-white/10 rounded-full px-4 py-2 text-sm text-white flex items-center gap-2 shadow-lg hover:bg-white/5"
      >
        <Loader2 size={14} className="animate-spin text-primary-blue" />
        {runningCount} job{runningCount === 1 ? '' : 's'} running
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-40 w-80 bg-dark-card border border-white/10 rounded-xl shadow-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <span className="text-xs font-semibold text-white/70 uppercase tracking-wide">Background jobs</span>
        <button onClick={() => setCollapsed(true)} aria-label="Collapse job panel" className="text-white/50 hover:text-white">
          <ChevronDown size={16} />
        </button>
      </div>
      <ul className="max-h-72 overflow-y-auto divide-y divide-white/5">
        {jobs.map((job) => {
          const evt = jobEvents[job.id];
          const status = evt?.status ?? 'queued';
          const progress = evt?.progress ?? null;
          const isTerminal = status === 'completed' || status === 'failed';
          const indeterminate = progress == null && status !== 'failed';

          return (
            <li key={job.id} className="px-3 py-2 flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span className="truncate text-white">{job.label}</span>
                <span className="text-white/40 text-[10px] uppercase">{job.type}</span>
              </div>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={indeterminate ? undefined : progress ?? 0}
                aria-busy={indeterminate || undefined}
                aria-label={`${job.label} progress`}
                className="h-1.5 rounded-full bg-white/10 overflow-hidden"
              >
                {status === 'failed' ? (
                  <div className="h-full w-full bg-red-500" />
                ) : indeterminate ? (
                  <div className="h-full w-1/3 bg-primary-blue animate-pulse" />
                ) : (
                  <div className="h-full bg-primary-blue transition-all" style={{ width: `${progress ?? 0}%` }} />
                )}
              </div>
              <div className="flex items-center justify-between text-xs">
                {status === 'failed' ? (
                  <span className="text-red-400 truncate pr-2">{evt?.error ?? 'Job failed'}</span>
                ) : (
                  <span className="text-white/40 capitalize">{status}</span>
                )}
                <button
                  onClick={() => removeJob(job.id)}
                  aria-label={isTerminal ? `Dismiss ${job.label}` : `Cancel ${job.label}`}
                  title={isTerminal ? 'Dismiss' : 'Cancel'}
                  className="text-white/40 hover:text-white shrink-0"
                >
                  <X size={14} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
