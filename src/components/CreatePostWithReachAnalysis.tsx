import React, { useState, useRef, useEffect } from 'react';
import { Card } from './ui/Card';
import { Platform, ViewProps, View } from '../types';
import { ReachScoreWidget } from './ReachScoreWidget';
import { usePredictiveReach } from '../hooks/usePredictiveReach';
import { PostAnalysisInput } from '../types/predictive';

const PLATFORM_CHAR_LIMITS: Record<Platform, number> = {
  [Platform.TWITTER]: 280,
  [Platform.LINKEDIN]: 3000,
  [Platform.FACEBOOK]: 63206,
  [Platform.INSTAGRAM]: 2200,
};

// Per-platform file size limits in bytes (image / video)
const PLATFORM_FILE_SIZE_LIMITS: Record<Platform, { image: number; video: number }> = {
  [Platform.TWITTER]:   { image: 5 * 1024 * 1024,   video: 512 * 1024 * 1024 },
  [Platform.LINKEDIN]:  { image: 10 * 1024 * 1024,  video: 200 * 1024 * 1024 },
  [Platform.FACEBOOK]:  { image: 10 * 1024 * 1024,  video: 4 * 1024 * 1024 * 1024 },
  [Platform.INSTAGRAM]: { image: 8 * 1024 * 1024,   video: 100 * 1024 * 1024 },
};

const MaterialIcon = ({ name, className }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

export const CreatePostWithReachAnalysis: React.FC<ViewProps> = ({ onNavigate }) => {
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>([Platform.INSTAGRAM]);
  const [caption, setCaption] = useState('');
  const [hashtags, setHashtags] = useState<string[]>([]);
  const [mediaType, setMediaType] = useState<'text' | 'image' | 'video' | 'carousel'>('text');
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('10:00');
  const [showReachAnalysis, setShowReachAnalysis] = useState(true);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileSizeErrors, setFileSizeErrors] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setFileSizeErrors([]);

    if (!file) return;

    const fileKind = file.type.startsWith('video/') ? 'video' : 'image';
    const errors: string[] = [];

    for (const platform of selectedPlatforms) {
      const limit = PLATFORM_FILE_SIZE_LIMITS[platform]?.[fileKind];
      if (limit !== undefined && file.size > limit) {
        const limitMB = (limit / (1024 * 1024)).toFixed(0);
        errors.push(
          `${platform}: ${fileKind} exceeds the ${limitMB} MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB)`,
        );
      }
    }

    setFileSizeErrors(errors);
  };

  // Extract hashtags from caption
  useEffect(() => {
    const extractedHashtags = caption.match(/#\w+/g) || [];
    setHashtags(extractedHashtags);
  }, [caption]);

  // Prepare post data for analysis
  const postAnalysisData: PostAnalysisInput = {
    content: caption,
    platform: selectedPlatforms[0] || 'instagram',
    scheduledTime: scheduleDate && scheduleTime 
      ? new Date(`${scheduleDate}T${scheduleTime}`)
      : undefined,
    hashtags,
    mediaType,
  };

  // Use predictive reach hook
  const { prediction, loading, analyze } = usePredictiveReach(postAnalysisData, {
    autoAnalyze: true,
    debounceMs: 1000,
  });

  const getScoreLabel = (score: number): string => {
    if (score >= 80) return 'Excellent';
    if (score >= 60) return 'Good';
    if (score >= 40) return 'Fair';
    return 'Needs Improvement';
  };

  const getScoreColor = (score: number): string => {
    if (score >= 80) return 'text-green-400';
    if (score >= 60) return 'text-blue-400';
    if (score >= 40) return 'text-yellow-400';
    return 'text-red-400';
  };

  // Per-platform character limit enforcement
  const activeLimits = selectedPlatforms.map(p => ({ platform: p, limit: PLATFORM_CHAR_LIMITS[p] ?? Infinity }));
  const overLimitPlatforms = activeLimits.filter(({ limit }) => caption.length > limit);
  const isOverLimit = overLimitPlatforms.length > 0;
  const strictestLimit = activeLimits.reduce((min, { limit }) => Math.min(min, limit), Infinity);

  return (
    <div className="p-7 max-w-7xl mx-auto animate-fade-in">
      <div className="flex justify-between items-center mb-7">
        <div>
          <h2 className="text-2xl font-bold text-white">Create New Post</h2>
          {prediction && (
            <p className="text-sm text-gray-subtext mt-1">
              Reach Score: <span className={`font-semibold ${getScoreColor(prediction.reachScore)}`}>
                {Math.round(prediction.reachScore)} - {getScoreLabel(prediction.reachScore)}
              </span>
            </p>
          )}
        </div>
        <button 
          onClick={() => setShowReachAnalysis(!showReachAnalysis)}
          className="flex items-center gap-2 px-4 py-2 rounded-2xl text-sm font-medium bg-dark-surface text-white hover:bg-dark-bg transition-all"
        >
          <MaterialIcon name="analytics" className="text-base" />
          {showReachAnalysis ? 'Hide' : 'Show'} Analysis
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-6">
          {/* Platform Selection */}
          <Card>
            <h3 className="text-sm font-medium text-gray-subtext mb-3">Select Platforms</h3>
            <div className="flex gap-3 flex-wrap">
              {Object.values(Platform).map(platform => (
                <button
                  key={platform}
                  onClick={() => {
                    if (selectedPlatforms.includes(platform)) {
                      setSelectedPlatforms(prev => prev.filter(p => p !== platform));
                    } else {
                      setSelectedPlatforms(prev => [...prev, platform]);
                    }
                  }}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                    selectedPlatforms.includes(platform)
                      ? 'bg-primary-blue text-white'
                      : 'bg-dark-bg text-gray-subtext hover:bg-dark-border'
                  }`}
                >
                  {platform.charAt(0).toUpperCase() + platform.slice(1)}
                </button>
              ))}
            </div>
          </Card>

          {/* Media Type Selection */}
          <Card>
            <h3 className="text-sm font-medium text-gray-subtext mb-3">Content Type</h3>
            <div className="grid grid-cols-4 gap-3">
              {(['text', 'image', 'video', 'carousel'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => setMediaType(type)}
                  className={`p-4 rounded-xl text-center transition-all ${
                    mediaType === type
                      ? 'bg-primary-blue text-white'
                      : 'bg-dark-bg text-gray-subtext hover:bg-dark-border'
                  }`}
                >
                  <MaterialIcon 
                    name={type === 'text' ? 'text_fields' : type === 'image' ? 'image' : type === 'video' ? 'videocam' : 'view_carousel'} 
                    className="text-2xl mb-1"
                  />
                  <p className="text-xs capitalize">{type}</p>
                </button>
              ))}
            </div>
          </Card>

          {/* Media Upload */}
          {(mediaType === 'image' || mediaType === 'video' || mediaType === 'carousel') && (
            <Card>
              <h3 className="text-sm font-medium text-gray-subtext mb-3">Upload Media</h3>
              <input
                ref={fileInputRef}
                type="file"
                accept={mediaType === 'video' ? 'video/*' : 'image/*'}
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-subtext file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-medium file:bg-primary-blue file:text-white hover:file:bg-blue-700 cursor-pointer"
              />
              {selectedFile && fileSizeErrors.length === 0 && (
                <p className="mt-2 text-xs text-green-400">
                  {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(1)} MB) — within limits for all selected platforms
                </p>
              )}
              {fileSizeErrors.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {fileSizeErrors.map((err) => (
                    <li key={err} className="text-xs text-red-400">{err}</li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {/* Caption */}
          <Card>
            <h3 className="text-lg font-semibold text-white mb-4">Caption</h3>
            <textarea 
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="w-full h-40 bg-dark-bg border border-dark-border rounded-2xl p-4 text-white focus:outline-none focus:ring-2 focus:ring-primary-blue/50 resize-none"
              placeholder="Write your caption here... Use #hashtags for better reach"
            />
            <div className="mt-3 flex justify-between items-center text-xs">
              <span className={isOverLimit ? 'text-red-400 font-semibold' : 'text-gray-subtext'}>
                {caption.length}{strictestLimit !== Infinity ? `/${strictestLimit}` : ''} characters • {hashtags.length} hashtags
                {overLimitPlatforms.length > 0 && (
                  <span className="ml-2">
                    — over limit for: {overLimitPlatforms.map(p => p.platform).join(', ')}
                  </span>
                )}
              </span>
              {loading && (
                <span className="text-primary-blue flex items-center gap-2">
                  <MaterialIcon name="analytics" className="text-sm animate-pulse" />
                  Analyzing...
                </span>
              )}
            </div>
          </Card>

          {/* Scheduling */}
          <Card>
            <h3 className="text-lg font-semibold text-white mb-4">Schedule</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-subtext mb-2">Date</label>
                <input 
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-blue/50"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-subtext mb-2">Time</label>
                <input 
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-primary-blue/50"
                  style={{ colorScheme: 'dark' }}
                />
              </div>
            </div>
            {prediction?.optimalPostTime && (
              <div className="mt-3 p-3 bg-primary-blue/10 rounded-lg border border-primary-blue/30">
                <p className="text-xs text-gray-subtext mb-1">Recommended Time:</p>
                <button
                  onClick={() => {
                    const optimal = prediction.optimalPostTime!;
                    setScheduleDate(optimal.toISOString().split('T')[0]);
                    setScheduleTime(optimal.toTimeString().slice(0, 5));
                  }}
                  className="text-sm text-primary-blue hover:text-blue-300 font-medium"
                >
                  {prediction.optimalPostTime.toLocaleString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </button>
              </div>
            )}
          </Card>

          <button 
            disabled={isOverLimit || fileSizeErrors.length > 0}
            className="w-full bg-primary-blue text-white px-6 py-3 rounded-2xl text-sm font-medium hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary-blue"
          >
            {isOverLimit
              ? `Over character limit (${overLimitPlatforms.map(p => p.platform).join(', ')})`
              : fileSizeErrors.length > 0
              ? 'File exceeds platform size limit'
              : 'Schedule Post'}
          </button>
        </div>

        {/* Reach Analysis Sidebar */}
        {showReachAnalysis && (
          <div className="lg:col-span-1">
            <ReachScoreWidget postData={postAnalysisData} />
          </div>
        )}
      </div>
    </div>
  );
};
