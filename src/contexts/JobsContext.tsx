import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useJobStream, JobStreamEvents, JobStreamStatus } from '../hooks/useJobStream';
import { JobType } from '../services/jobsService';

export interface TrackedJob {
  id: string;
  type: JobType;
  label: string;
  isUploading?: boolean;
}

interface Toast {
  id: string;
  message: string;
  resultUrl?: string;
}

interface JobsContextValue {
  jobs: TrackedJob[];
  jobEvents: JobStreamEvents;
  streamStatus: JobStreamStatus;
  addJob: (job: TrackedJob) => void;
  removeJob: (jobId: string) => void;
  setUploading: (jobId: string, isUploading: boolean) => void;
}

const JobsContext = createContext<JobsContextValue | null>(null);

// One context tracks every background job app-wide (TTS, video, export, bulk
// actions). Mount <JobsProvider> once at the app root so jobs survive route
// navigation, and mount <JobProgressPanel /> once in the layout to render them.
export const JobsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notifiedRef = useRef<Set<string>>(new Set());

  const jobIds = jobs.map((j) => j.id);
  const { events, status } = useJobStream(jobIds);

  const addJob = useCallback((job: TrackedJob) => {
    setJobs((prev) => (prev.some((j) => j.id === job.id) ? prev : [...prev, job]));
  }, []);

  const removeJob = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  }, []);

  const setUploading = useCallback((jobId: string, isUploading: boolean) => {
    setJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, isUploading } : j)));
  }, []);

  useEffect(() => {
    Object.values(events).forEach((evt) => {
      if (evt.status !== 'completed' || notifiedRef.current.has(evt.jobId)) return;
      notifiedRef.current.add(evt.jobId);
      const job = jobs.find((j) => j.id === evt.jobId);
      const toastId = `${evt.jobId}_${evt.updatedAt}`;
      setToasts((prev) => [...prev, { id: toastId, message: `${job?.label ?? 'Job'} completed`, resultUrl: evt.resultUrl }]);
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toastId)), 6000);
    });
  }, [events, jobs]);

  // Closing the tab warns only when a job is actively uploading — navigating
  // between routes never cancels running jobs, since this provider lives above the router.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (jobs.some((j) => j.isUploading)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [jobs]);

  return (
    <JobsContext.Provider value={{ jobs, jobEvents: events, streamStatus: status, addJob, removeJob, setUploading }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto bg-dark-card border border-white/10 rounded-lg px-4 py-3 shadow-lg flex items-center gap-3 text-sm text-white"
          >
            <span>{t.message}</span>
            {t.resultUrl && (
              <a href={t.resultUrl} target="_blank" rel="noreferrer" className="text-primary-blue font-medium hover:underline">
                View result
              </a>
            )}
          </div>
        ))}
      </div>
    </JobsContext.Provider>
  );
};

export function useJobs(): JobsContextValue {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error('useJobs must be used within a JobsProvider');
  return ctx;
}
