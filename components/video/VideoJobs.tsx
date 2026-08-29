import React, { useRef, useState } from 'react';
import { Card } from '../ui/Card';
import { View, ViewProps } from '../../types';
import { useJobs } from '../../contexts/JobsContext';
import { useJobStream } from '../../hooks/useJobStream';
import {
  VIDEO_PRESETS,
  VideoJob,
  getVideoJobs,
  postVideoTranscode,
  retryVideoTranscode,
} from '../../services/jobsService';
import { CheckCircle2, RefreshCw, UploadCloud, XCircle } from 'lucide-react';

export const VideoJobs: React.FC<ViewProps> = ({ onNavigate }) => {
  const [jobs, setJobs] = useState<VideoJob[]>(getVideoJobs());
  const [presetId, setPresetId] = useState(VIDEO_PRESETS[0].id);
  const [label, setLabel] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { addJob } = useJobs();

  const { events } = useJobStream(jobs.map((j) => j.id));

  const handleFile = (f: File) => {
    setFile(f);
    setPreview(URL.createObjectURL(f));
    if (!label) setLabel(f.name.replace(/\.[^.]+$/, ''));
  };

  const submit = () => {
    if (!file || !preview) return;
    const job = postVideoTranscode({ sourceUrl: preview, thumbnailUrl: preview, label: label || file.name, presetId });
    setJobs((prev) => [job, ...prev]);
    addJob({ id: job.id, type: 'video', label: job.label });
    setFile(null);
    setPreview(null);
    setLabel('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const retry = (job: VideoJob) => {
    const newJob = retryVideoTranscode(job.id);
    setJobs((prev) => [newJob, ...prev]);
    addJob({ id: newJob.id, type: 'video', label: newJob.label });
  };

  const attachToDraft = (outputUrl: string) => {
    const existing = localStorage.getItem('socialflow-draft');
    const draft = existing ? JSON.parse(existing) : {};
    draft.mediaPreview = outputUrl;
    localStorage.setItem('socialflow-draft', JSON.stringify(draft));
    onNavigate(View.CREATE_POST);
  };

  return (
    <div className="p-8 space-y-6">
      <Card>
        <h2 className="text-lg font-semibold text-white mb-4">Submit a transcode</h2>
        <div className="flex flex-col gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 justify-center border border-dashed border-white/20 rounded-2xl py-8 text-gray-subtext hover:border-primary-blue hover:text-white transition-colors"
          >
            <UploadCloud size={20} />
            {file ? file.name : 'Choose a video file'}
          </button>
          <div className="flex gap-4">
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white"
            >
              {VIDEO_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Job label"
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-white placeholder:text-white/30"
            />
          </div>
          <button
            onClick={submit}
            disabled={!file}
            className="self-start px-5 py-2.5 rounded-xl bg-primary-blue text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Submit transcode
          </button>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold text-white mb-4">Transcode jobs</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-gray-subtext">No transcode jobs yet.</p>
        ) : (
          <ul className="space-y-3">
            {jobs.map((job) => {
              const evt = events[job.id];
              const status = evt?.status ?? job.status;
              const progress = evt?.progress ?? job.progress;
              const outputUrl = evt?.resultUrl ?? job.outputUrl;
              const error = evt?.error ?? job.error;
              const preset = VIDEO_PRESETS.find((p) => p.id === job.presetId);

              return (
                <li key={job.id} className="flex items-center gap-4 bg-white/5 rounded-2xl p-4">
                  {job.thumbnailUrl && (
                    <video src={job.thumbnailUrl} className="w-20 h-14 object-cover rounded-lg bg-black shrink-0" muted />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white font-medium truncate">{job.label}</span>
                      <span className="text-xs text-white/40 shrink-0">{preset?.label}</span>
                    </div>
                    {status === 'failed' ? (
                      <p className="text-sm text-red-400 mt-1 truncate">{error}</p>
                    ) : (
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mt-2">
                        <div className="h-full bg-primary-blue transition-all" style={{ width: `${progress ?? 0}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {status === 'completed' && outputUrl && (
                      <>
                        <CheckCircle2 size={18} className="text-primary-teal" />
                        <button
                          onClick={() => attachToDraft(outputUrl)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-primary-blue/10 text-primary-blue hover:bg-primary-blue/20"
                        >
                          Attach to draft
                        </button>
                      </>
                    )}
                    {status === 'failed' && (
                      <>
                        <XCircle size={18} className="text-red-400" />
                        <button
                          onClick={() => retry(job)}
                          className="text-xs px-3 py-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20 flex items-center gap-1"
                        >
                          <RefreshCw size={12} /> Retry
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
};
