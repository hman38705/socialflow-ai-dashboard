import React from 'react';
import { JobState, JobProgressEvent, JobStatus } from '../hooks/useJobStream';

interface Props {
  jobs: JobState;
  onDismiss: (jobId: string) => void;
  onRetry?: (jobId: string) => void;
}

const STATUS_COLORS: Record<JobStatus, string> = {
  pending:    'bg-gray-200 text-gray-700',
  processing: 'bg-blue-100 text-blue-700',
  completed:  'bg-green-100 text-green-700',
  failed:     'bg-red-100 text-red-700',
};

const JOB_LABELS: Record<string, string> = {
  video_transcoding: 'Video Transcoding',
  ai_generation:     'AI Generation',
};

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 mt-1" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div
        className="h-1.5 rounded-full bg-blue-500 transition-all duration-300"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function JobCard({ job, onDismiss, onRetry }: { job: JobProgressEvent; onDismiss: () => void; onRetry?: () => void }) {
  const isDone = job.status === 'completed' || job.status === 'failed';
  return (
    <div className="bg-white border rounded-lg p-3 shadow-sm text-sm">
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-gray-800">{JOB_LABELS[job.type] ?? job.type}</span>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[job.status]}`}>
            {job.status}
          </span>
          {job.status === 'failed' && onRetry && (
            <button
              onClick={onRetry}
              className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
              aria-label="Retry job"
            >
              Retry
            </button>
          )}
          {isDone && (
            <button onClick={onDismiss} className="text-gray-400 hover:text-gray-600 text-xs" aria-label="Dismiss">
              ✕
            </button>
          )}
        </div>
      </div>

      {job.status === 'processing' && <ProgressBar value={job.progress} />}

      {job.message && (
        <p className="text-xs text-gray-500 mt-1">{job.message}</p>
      )}
      {job.error && (
        <p className="text-xs text-red-600 mt-1">{job.error}</p>
      )}
      <p className="text-xs text-gray-400 mt-1 font-mono truncate">{job.jobId}</p>
    </div>
  );
}

export default function JobProgressPanel({ jobs, onDismiss, onRetry }: Props) {
  const entries = Object.values(jobs);
  if (entries.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 w-72 space-y-2 z-50" aria-live="polite" aria-label="Job progress">
      {entries.map((job) => (
        <JobCard
          key={job.jobId}
          job={job}
          onDismiss={() => onDismiss(job.jobId)}
          onRetry={onRetry ? () => onRetry(job.jobId) : undefined}
        />
      ))}
    </div>
  );
}
