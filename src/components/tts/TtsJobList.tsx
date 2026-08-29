import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { TtsService } from '../../api/services/TtsService';

export type TTSJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface TTSJobItem {
  id: string;
  status: TTSJobStatus;
  progress?: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  durationMs?: number;
  voiceName?: string;
  provider?: 'elevenlabs' | 'google' | string;
  outputAudioPath?: string;
  outputFormat?: string;
  error?: string;
  request?: {
    segments?: Array<{
      text?: string;
      voiceId?: string;
      speed?: number;
    }>;
    provider?: string;
    outputFormat?: string;
  };
  segments?: Array<{
    text?: string;
    audioPath?: string;
    durationMs?: number;
  }>;
}

export interface TtsJobListProps {
  /** Initial or external jobs list */
  initialJobs?: TTSJobItem[];
  /** Polling interval for in-progress jobs in ms (FE-107 live updates) */
  pollingIntervalMs?: number;
  /** Callback fired after a job is successfully deleted */
  onJobDeleted?: (jobId: string) => void;
  /** Additional container classes */
  className?: string;
}

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span
    className={`material-symbols-outlined select-none inline-flex items-center justify-center ${className || ''}`}
    aria-hidden="true"
  >
    {name}
  </span>
);

export const TtsJobList: React.FC<TtsJobListProps> = ({
  initialJobs,
  pollingIntervalMs = 3000,
  onJobDeleted,
  className = '',
}) => {
  const [jobs, setJobs] = useState<TTSJobItem[]>(initialJobs || []);
  const [loading, setLoading] = useState(!initialJobs || initialJobs.length === 0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmDeleteJobId, setConfirmDeleteJobId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Single active audio player state: "only one plays at a time"
  const [playingJobId, setPlayingJobId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(true);

  // Format helpers
  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDate = (dateVal?: string | Date) => {
    if (!dateVal) return 'Recently';
    try {
      const d = new Date(dateVal);
      return (
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
        ' ' +
        d.toLocaleDateString([], { month: 'short', day: 'numeric' })
      );
    } catch {
      return String(dateVal);
    }
  };

  // Fetch jobs from backend
  const fetchJobs = useCallback(async (isPollingCall = false) => {
    if (!isPollingCall) setLoading(true);
    try {
      const response = await TtsService.getTtsJobs();
      const jobList: TTSJobItem[] = Array.isArray(response) ? response : response?.jobs || [];

      if (isMountedRef.current) {
        setJobs(jobList);
        setErrorMessage(null);
      }
    } catch (err) {
      if (isMountedRef.current && !isPollingCall) {
        const msg = err instanceof Error ? err.message : 'Failed to load TTS jobs';
        setErrorMessage(msg);
      }
    } finally {
      if (isMountedRef.current && !isPollingCall) {
        setLoading(false);
      }
    }
  }, []);

  // Initial load
  useEffect(() => {
    isMountedRef.current = true;
    if (!initialJobs || initialJobs.length === 0) {
      fetchJobs(false);
    } else {
      setJobs(initialJobs);
      setLoading(false);
    }

    return () => {
      isMountedRef.current = false;
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, [fetchJobs, initialJobs]);

  // Check if any job is in-progress (pending or processing)
  const hasInProgressJobs = useMemo(() => {
    return jobs.some((j) => j.status === 'pending' || j.status === 'processing');
  }, [jobs]);

  // Polling management: active while in-progress jobs exist; stops when completed (FE-107)
  useEffect(() => {
    if (hasInProgressJobs) {
      if (!pollingTimerRef.current) {
        pollingTimerRef.current = setInterval(() => {
          if (isMountedRef.current) {
            fetchJobs(true);
          }
        }, pollingIntervalMs);
      }
    } else {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    }

    return () => {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, [hasInProgressJobs, pollingIntervalMs, fetchJobs]);

  // Audio Playback Controls ("Only one plays at a time")
  const handleTogglePlay = (job: TTSJobItem) => {
    const audioUrl = job.outputAudioPath || job.segments?.[0]?.audioPath || '/sample.mp3';

    if (playingJobId === job.id) {
      // Pause currently playing
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingJobId(null);
    } else {
      // If another audio was playing, pause it immediately
      if (audioRef.current) {
        audioRef.current.pause();
      }

      const audio = new Audio(audioUrl);
      audio.playbackRate = playbackSpeed;

      audio.onloadedmetadata = () => {
        if (isMountedRef.current) {
          setDuration(audio.duration || (job.durationMs ? job.durationMs / 1000 : 0));
        }
      };

      audio.ontimeupdate = () => {
        if (isMountedRef.current) {
          setCurrentTime(audio.currentTime);
        }
      };

      audio.onended = () => {
        if (isMountedRef.current) {
          setPlayingJobId(null);
          setCurrentTime(0);
        }
      };

      audio.onerror = () => {
        // Fallback synthetic playback simulation for mock / offline paths
        simulatePlayback(job);
      };

      audioRef.current = audio;
      setPlayingJobId(job.id);
      setCurrentTime(0);

      audio.play().catch(() => {
        simulatePlayback(job);
      });
    }
  };

  // Fallback playback timer simulation for demo/test environments
  const simulatePlayback = (job: TTSJobItem) => {
    const totalSec = job.durationMs ? job.durationMs / 1000 : 15;
    setDuration(totalSec);
    setPlayingJobId(job.id);

    const interval = setInterval(() => {
      if (!isMountedRef.current) {
        clearInterval(interval);
        return;
      }
      setCurrentTime((prev) => {
        if (prev >= totalSec) {
          clearInterval(interval);
          setPlayingJobId(null);
          return 0;
        }
        return prev + 1;
      });
    }, 1000 / playbackSpeed);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  };

  const handleDownload = (job: TTSJobItem) => {
    const audioUrl = job.outputAudioPath || job.segments?.[0]?.audioPath || '#';
    const filename = `narration-${job.id}.${job.outputFormat || 'mp3'}`;
    const link = document.createElement('a');
    link.href = audioUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Optimistic Delete with Confirmation and Rollback
  const handleConfirmDelete = async () => {
    if (!confirmDeleteJobId) return;
    const targetId = confirmDeleteJobId;
    setConfirmDeleteJobId(null);

    // Save previous snapshot for rollback
    const previousJobs = [...jobs];

    // Optimistic UI update: instantly remove from list
    setJobs((prev) => prev.filter((j) => j.id !== targetId));

    // If deleted job was playing, stop audio
    if (playingJobId === targetId) {
      if (audioRef.current) audioRef.current.pause();
      setPlayingJobId(null);
    }

    setIsDeleting(true);
    try {
      await TtsService.deleteTtsJobs({ jobId: targetId });
      onJobDeleted?.(targetId);
    } catch (err) {
      // Rollback on failure
      if (isMountedRef.current) {
        setJobs(previousJobs);
        setErrorMessage('Failed to delete TTS job. Restored.');
        setTimeout(() => {
          if (isMountedRef.current) setErrorMessage(null);
        }, 4000);
      }
    } finally {
      if (isMountedRef.current) setIsDeleting(false);
    }
  };

  // Status Badge Helper
  const renderStatusBadge = (status: TTSJobStatus, progress = 0) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 rounded-lg">
            <MaterialIcon name="check_circle" className="text-sm" />
            Completed
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold bg-primary-blue/20 text-primary-blue border border-primary-blue/30 rounded-lg">
            <div className="animate-spin rounded-full h-3 w-3 border-2 border-primary-blue border-t-transparent" />
            Processing {progress > 0 ? `(${progress}%)` : ''}
          </span>
        );
      case 'pending':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded-lg animate-pulse">
            <MaterialIcon name="schedule" className="text-sm" />
            Queued
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30 rounded-lg">
            <MaterialIcon name="error" className="text-sm" />
            Failed
          </span>
        );
    }
  };

  return (
    <div
      className={`bg-dark-surface border border-dark-border rounded-xl p-6 space-y-6 shadow-xl ${className}`}
      data-testid="tts-job-list"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dark-border/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-teal/20 border border-primary-teal/30 flex items-center justify-center text-primary-teal">
            <MaterialIcon name="queue_music" className="text-2xl" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">
              Generated Voiceovers & Jobs
            </h2>
            <p className="text-xs text-gray-subtext">
              {jobs.length} narration job{jobs.length !== 1 ? 's' : ''}
              {hasInProgressJobs && (
                <span className="text-primary-blue ml-2 font-medium">
                  • Live sync active (polling)
                </span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchJobs(false)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-dark-bg border border-dark-border rounded-xl text-xs text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-50 transition-all"
            title="Refresh job list"
          >
            <MaterialIcon
              name="refresh"
              className={`text-sm ${loading ? 'animate-spin text-primary-blue' : ''}`}
            />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Error / Alert banner */}
      {errorMessage && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MaterialIcon name="error" className="text-base" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-gray-400 hover:text-white">
            <MaterialIcon name="close" className="text-sm" />
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-blue border-t-transparent" />
          <p className="text-xs text-gray-subtext">Loading TTS audio jobs...</p>
        </div>
      ) : jobs.length === 0 ? (
        /* Empty State */
        <div className="flex flex-col items-center justify-center py-12 text-center space-y-3 border border-dashed border-dark-border rounded-xl bg-dark-bg/40">
          <MaterialIcon name="graphic_eq" className="text-5xl text-gray-600" />
          <p className="text-sm font-semibold text-gray-300">No TTS voiceover jobs yet</p>
          <p className="text-xs text-gray-subtext max-w-sm">
            Use the form above to generate high-fidelity AI speech narrations for your posts and
            media.
          </p>
        </div>
      ) : (
        /* Job List Items */
        <div className="space-y-4">
          {jobs.map((job) => {
            const isPlaying = playingJobId === job.id;
            const textSnippet =
              job.request?.segments?.[0]?.text || job.segments?.[0]?.text || 'No script text';
            const voiceLabel =
              job.voiceName || job.request?.segments?.[0]?.voiceId || 'Default Voice';
            const providerName = job.provider || job.request?.provider || 'ElevenLabs';
            const durationDisplay = job.durationMs ? formatTime(job.durationMs / 1000) : '00:30';

            return (
              <div
                key={job.id}
                className={`bg-dark-bg/70 border rounded-xl p-4 space-y-3 transition-all ${
                  isPlaying
                    ? 'border-primary-blue shadow-lg bg-dark-bg/90'
                    : 'border-dark-border hover:border-gray-600'
                }`}
                data-testid={`tts-job-card-${job.id}`}
              >
                {/* Top row: Status, Voice, Date, Actions */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {renderStatusBadge(job.status, job.progress)}
                    <span className="text-xs font-semibold text-white">{voiceLabel}</span>
                    <span className="text-[10px] text-gray-400 bg-dark-surface px-2 py-0.5 rounded border border-dark-border uppercase">
                      {providerName}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <MaterialIcon name="schedule" className="text-xs" />
                      {formatDate(job.createdAt)}
                    </span>
                    <span className="flex items-center gap-1">
                      <MaterialIcon name="timer" className="text-xs" />
                      {durationDisplay}
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteJobId(job.id)}
                      disabled={isDeleting}
                      className="p-1 text-gray-400 hover:text-red-400 rounded-lg hover:bg-white/5 transition-colors"
                      title="Delete TTS job"
                      aria-label="Delete job"
                    >
                      <MaterialIcon name="delete" className="text-base" />
                    </button>
                  </div>
                </div>

                {/* Script text snippet */}
                <p className="text-xs text-gray-300 bg-dark-surface/60 rounded-lg p-2.5 border border-dark-border/40 line-clamp-2">
                  "{textSnippet}"
                </p>

                {/* Inline Audio Player for Completed Jobs */}
                {job.status === 'completed' && (
                  <div className="pt-2 border-t border-dark-border/60 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Play/Pause Button */}
                      <button
                        type="button"
                        onClick={() => handleTogglePlay(job)}
                        className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                          isPlaying
                            ? 'bg-primary-blue text-white shadow'
                            : 'bg-primary-blue/20 text-primary-blue hover:bg-primary-blue hover:text-white'
                        }`}
                        title={isPlaying ? 'Pause playback' : 'Play audio narration'}
                        aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
                      >
                        <MaterialIcon
                          name={isPlaying ? 'pause' : 'play_arrow'}
                          className="text-xl"
                        />
                      </button>

                      {/* Scrub Slider */}
                      <div className="flex-1 flex items-center gap-2 min-w-[140px]">
                        <span className="text-[10px] font-mono text-gray-400 w-10 text-right">
                          {isPlaying ? formatTime(currentTime) : '00:00'}
                        </span>
                        <input
                          type="range"
                          min="0"
                          max={duration || (job.durationMs ? job.durationMs / 1000 : 30)}
                          step="0.1"
                          value={isPlaying ? currentTime : 0}
                          onChange={handleSeek}
                          disabled={!isPlaying}
                          className="flex-1 accent-primary-blue cursor-pointer h-1.5 bg-dark-surface rounded-lg"
                        />
                        <span className="text-[10px] font-mono text-gray-400 w-10">
                          {duration ? formatTime(duration) : durationDisplay}
                        </span>
                      </div>

                      {/* Playback Speed Selector */}
                      <div className="flex items-center gap-1 bg-dark-surface px-1.5 py-1 rounded-lg border border-dark-border text-[10px] font-semibold text-gray-300">
                        <span className="text-gray-500">Speed:</span>
                        {[0.75, 1.0, 1.25, 1.5].map((spd) => (
                          <button
                            key={spd}
                            type="button"
                            onClick={() => handleSpeedChange(spd)}
                            className={`px-1.5 py-0.5 rounded ${
                              playbackSpeed === spd
                                ? 'bg-primary-blue text-white'
                                : 'hover:text-white'
                            }`}
                          >
                            {spd}x
                          </button>
                        ))}
                      </div>

                      {/* Download Button */}
                      <button
                        type="button"
                        onClick={() => handleDownload(job)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-dark-surface border border-dark-border text-xs text-gray-300 hover:text-white hover:border-gray-500 transition-colors"
                        title="Download audio file"
                      >
                        <MaterialIcon name="download" className="text-sm text-primary-teal" />
                        <span>Download</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Processing Progress Bar */}
                {job.status === 'processing' && (
                  <div className="pt-2 border-t border-dark-border/60">
                    <div className="w-full bg-dark-surface h-1.5 rounded-full overflow-hidden">
                      <div
                        className="bg-primary-blue h-full transition-all duration-500 animate-pulse"
                        style={{ width: `${job.progress || 45}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteJobId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-dark-surface border border-dark-border rounded-2xl max-w-sm w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center">
                <MaterialIcon name="delete_forever" className="text-2xl" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Delete TTS Audio Job?</h3>
                <p className="text-xs text-gray-subtext">
                  This action will remove the synthesized audio permanently.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-dark-border/80">
              <button
                type="button"
                onClick={() => setConfirmDeleteJobId(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-gray-300 hover:text-white bg-dark-bg border border-dark-border hover:border-gray-500 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors shadow"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TtsJobList;
