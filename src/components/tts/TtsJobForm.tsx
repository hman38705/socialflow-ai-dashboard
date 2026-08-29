import React, { useState, useEffect, useRef, useMemo } from 'react';
import { TtsService } from '../../api/services/TtsService';

export type TTSProvider = 'elevenlabs' | 'google';
export type AudioFormat = 'mp3' | 'wav' | 'ogg' | 'aac';

export interface TTSVoice {
  id: string;
  name: string;
  language: string;
  gender?: 'male' | 'female' | 'neutral';
  provider: TTSProvider;
  sampleUrl?: string;
}

export interface TtsJobFormProps {
  /** Maximum characters allowed by current subscription plan */
  planLimit?: number;
  /** Initial provider preference */
  defaultProvider?: TTSProvider;
  /** Callback fired immediately upon successful job creation */
  onJobCreated?: (job: any) => void;
  /** Container CSS classes */
  className?: string;
}

export const DEFAULT_VOICES: TTSVoice[] = [
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Sarah (Natural)',
    language: 'en',
    gender: 'female',
    provider: 'elevenlabs',
  },
  {
    id: 'TX3LPaxmHKxFdv7VOQHJ',
    name: 'Liam (Deep)',
    language: 'en',
    gender: 'male',
    provider: 'elevenlabs',
  },
  {
    id: 'XB0fDUnXU5powFXDhCwa',
    name: 'Charlotte (Warm)',
    language: 'en',
    gender: 'female',
    provider: 'elevenlabs',
  },
  {
    id: 'pFZP5JQG7iQjIQuC4Bku',
    name: 'Lily (Gentle)',
    language: 'en',
    gender: 'female',
    provider: 'elevenlabs',
  },
  {
    id: 'onwK4e9ZLuTAKqWW03F9',
    name: 'Daniel (Authoritative)',
    language: 'en',
    gender: 'male',
    provider: 'elevenlabs',
  },
  {
    id: 'en-US-Neural2-F',
    name: 'US English (Female)',
    language: 'en-US',
    gender: 'female',
    provider: 'google',
  },
  {
    id: 'en-US-Neural2-D',
    name: 'US English (Male)',
    language: 'en-US',
    gender: 'male',
    provider: 'google',
  },
  {
    id: 'es-ES-Neural2-A',
    name: 'Spanish (Female)',
    language: 'es-ES',
    gender: 'female',
    provider: 'google',
  },
  {
    id: 'fr-FR-Neural2-A',
    name: 'French (Female)',
    language: 'fr-FR',
    gender: 'female',
    provider: 'google',
  },
  {
    id: 'de-DE-Neural2-F',
    name: 'German (Female)',
    language: 'de-DE',
    gender: 'female',
    provider: 'google',
  },
  {
    id: 'ja-JP-Neural2-B',
    name: 'Japanese (Female)',
    language: 'ja-JP',
    gender: 'female',
    provider: 'google',
  },
  {
    id: 'pt-BR-Neural2-A',
    name: 'Portuguese (Female)',
    language: 'pt-BR',
    gender: 'female',
    provider: 'google',
  },
];

/** Valid format matrix per provider */
const SUPPORTED_FORMATS: Record<TTSProvider, AudioFormat[]> = {
  elevenlabs: ['mp3', 'wav', 'ogg'],
  google: ['mp3', 'wav', 'ogg'],
};

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span
    className={`material-symbols-outlined select-none inline-flex items-center justify-center ${className || ''}`}
    aria-hidden="true"
  >
    {name}
  </span>
);

export const TtsJobForm: React.FC<TtsJobFormProps> = ({
  planLimit = 5000,
  defaultProvider = 'elevenlabs',
  onJobCreated,
  className = '',
}) => {
  const [text, setText] = useState('');
  const [provider, setProvider] = useState<TTSProvider>(defaultProvider);
  const [voices, setVoices] = useState<TTSVoice[]>(DEFAULT_VOICES);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>(DEFAULT_VOICES[0].id);
  const [speed, setSpeed] = useState<number>(1.0);
  const [format, setFormat] = useState<AudioFormat>('mp3');
  const [stability, setStability] = useState<number>(0.5);
  const [similarityBoost, setSimilarityBoost] = useState<number>(0.75);

  const [loadingVoices, setLoadingVoices] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isPlayingSample, setIsPlayingSample] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const isMountedRef = useRef(true);

  // Fetch voices on mount / provider change
  useEffect(() => {
    isMountedRef.current = true;
    let isCancelled = false;

    async function loadVoices() {
      setLoadingVoices(true);
      try {
        const response = await TtsService.getTtsVoices({ provider });
        const list = response?.voices || (Array.isArray(response) ? response : null);
        if (list && list.length > 0 && !isCancelled) {
          setVoices(list);
          const currentVoiceValid = list.some((v: TTSVoice) => v.id === selectedVoiceId);
          if (!currentVoiceValid) {
            setSelectedVoiceId(list[0].id);
          }
        }
      } catch (err) {
        console.warn('Using fallback voice list:', err);
      } finally {
        if (!isCancelled) setLoadingVoices(false);
      }
    }

    loadVoices();

    return () => {
      isCancelled = true;
      isMountedRef.current = false;
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    };
  }, [provider]);

  // Filter voices for currently selected provider
  const availableVoices = useMemo(() => {
    return voices.filter((v) => !v.provider || v.provider === provider);
  }, [voices, provider]);

  // Ensure selectedVoiceId matches available voices
  useEffect(() => {
    if (availableVoices.length > 0 && !availableVoices.some((v) => v.id === selectedVoiceId)) {
      setSelectedVoiceId(availableVoices[0].id);
    }
  }, [availableVoices, selectedVoiceId]);

  const selectedVoice = useMemo(() => {
    return (
      availableVoices.find((v) => v.id === selectedVoiceId) ||
      availableVoices[0] ||
      DEFAULT_VOICES[0]
    );
  }, [availableVoices, selectedVoiceId]);

  // Validation checks
  const isTextEmpty = !text.trim();
  const isExceedingLimit = text.length > planLimit;
  const isFormatSupported = (SUPPORTED_FORMATS[provider] || ['mp3', 'wav', 'ogg']).includes(format);

  const validationError = useMemo(() => {
    if (isTextEmpty) return 'Please enter text for narration.';
    if (isExceedingLimit)
      return `Text exceeds your plan limit by ${text.length - planLimit} characters.`;
    if (!isFormatSupported)
      return `Format "${format.toUpperCase()}" is unsupported by ${provider}.`;
    if (!selectedVoiceId) return 'Please select a voice.';
    return null;
  }, [
    isTextEmpty,
    isExceedingLimit,
    isFormatSupported,
    format,
    provider,
    selectedVoiceId,
    text.length,
    planLimit,
  ]);

  const isFormValid = !validationError;

  // Audio sample preview player (generates audio tone / plays sample URL)
  const handlePlaySample = () => {
    if (isPlayingSample) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
      setIsPlayingSample(false);
      return;
    }

    if (selectedVoice?.sampleUrl) {
      if (!audioRef.current) {
        audioRef.current = new Audio(selectedVoice.sampleUrl);
      } else {
        audioRef.current.src = selectedVoice.sampleUrl;
      }
      audioRef.current.onended = () => setIsPlayingSample(false);
      audioRef.current.play().catch(() => playSyntheticPreview());
      setIsPlayingSample(true);
    } else {
      playSyntheticPreview();
    }
  };

  const playSyntheticPreview = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      audioContextRef.current = ctx;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // Pitch variation based on voice gender / provider
      const baseFreq = selectedVoice?.gender === 'female' ? 380 : 220;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.2, ctx.currentTime + 0.3);
      osc.frequency.exponentialRampToValueAtTime(baseFreq, ctx.currentTime + 0.8);

      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      setIsPlayingSample(true);

      setTimeout(() => {
        if (isMountedRef.current) setIsPlayingSample(false);
        osc.stop();
        ctx.close().catch(() => {});
      }, 1200);
    } catch (e) {
      console.warn('Could not play sample audio:', e);
      setIsPlayingSample(false);
    }
  };

  // Submit job
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || submitting) return;

    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const segment: Record<string, any> = {
        text: text.trim(),
        voiceId: selectedVoiceId,
        speed,
        language: selectedVoice?.language || 'en',
      };

      if (provider === 'elevenlabs') {
        segment.stability = stability;
        segment.similarityBoost = similarityBoost;
      }

      const requestBody: any = {
        segments: [segment],
        provider,
        outputFormat: format,
      };

      const response = await TtsService.postTtsJobs({
        requestBody,
      });

      const newJob = {
        id: response?.jobId || response?.id || `tts-${Date.now()}`,
        status: response?.status || 'pending',
        progress: 0,
        request: requestBody,
        createdAt: new Date().toISOString(),
        segments: [{ text: text.trim(), voiceId: selectedVoiceId }],
        voiceName: selectedVoice?.name,
        provider,
      };

      setSuccessMessage('TTS generation job created successfully!');
      setText('');
      onJobCreated?.(newJob);

      setTimeout(() => {
        if (isMountedRef.current) setSuccessMessage(null);
      }, 3500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create TTS job';
      setError(message);
    } finally {
      if (isMountedRef.current) setSubmitting(false);
    }
  };

  const charPercentage = Math.min(100, Math.round((text.length / planLimit) * 100));

  return (
    <form
      onSubmit={handleSubmit}
      className={`bg-dark-surface border border-dark-border rounded-xl p-6 space-y-6 shadow-xl ${className}`}
      data-testid="tts-job-form"
    >
      {/* Form Header */}
      <div className="flex items-center justify-between border-b border-dark-border/80 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-blue/20 border border-primary-blue/30 flex items-center justify-center text-primary-blue">
            <MaterialIcon name="record_voice_over" className="text-2xl" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white tracking-tight">
              Generate AI Voiceover (TTS)
            </h2>
            <p className="text-xs text-gray-subtext">
              Synthesize high-fidelity voice narration for your media
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Provider Selector Tabs */}
          <div className="flex bg-dark-bg p-1 rounded-xl border border-dark-border text-xs font-semibold">
            <button
              type="button"
              onClick={() => setProvider('elevenlabs')}
              className={`px-3 py-1 rounded-lg transition-all ${
                provider === 'elevenlabs'
                  ? 'bg-primary-blue text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              ElevenLabs
            </button>
            <button
              type="button"
              onClick={() => setProvider('google')}
              className={`px-3 py-1 rounded-lg transition-all ${
                provider === 'google'
                  ? 'bg-primary-blue text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Google TTS
            </button>
          </div>
        </div>
      </div>

      {/* Input Text Area with Plan Character Limits */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
            <MaterialIcon name="text_snippet" className="text-sm text-primary-blue" />
            Script / Narration Text
          </label>
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`font-mono ${
                isExceedingLimit
                  ? 'text-red-400 font-bold'
                  : text.length > planLimit * 0.85
                    ? 'text-amber-400'
                    : 'text-gray-400'
              }`}
            >
              {text.length.toLocaleString()} / {planLimit.toLocaleString()} characters
            </span>
            <span className="text-[10px] text-gray-500 bg-dark-bg px-2 py-0.5 rounded border border-dark-border">
              Plan Limit: {planLimit.toLocaleString()}
            </span>
          </div>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter the narration script you want converted to speech..."
          rows={5}
          className="w-full bg-dark-bg border border-dark-border rounded-xl p-4 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-blue/50 resize-none transition-all"
        />

        {/* Character usage progress bar */}
        <div className="w-full bg-dark-bg h-1.5 rounded-full overflow-hidden border border-dark-border/50">
          <div
            className={`h-full transition-all duration-300 ${
              isExceedingLimit
                ? 'bg-red-500'
                : charPercentage > 85
                  ? 'bg-amber-500'
                  : 'bg-primary-blue'
            }`}
            style={{ width: `${charPercentage}%` }}
          />
        </div>
      </div>

      {/* Voice Selection & Voice Sample Preview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Voice Selector */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
              <MaterialIcon name="mic" className="text-sm text-primary-blue" />
              Voice Selection
            </label>
            {loadingVoices && (
              <span className="text-[11px] text-gray-400 flex items-center gap-1">
                <div className="animate-spin rounded-full h-2.5 w-2.5 border border-primary-blue border-t-transparent" />
                Loading...
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedVoiceId}
              onChange={(e) => setSelectedVoiceId(e.target.value)}
              className="flex-1 bg-dark-bg border border-dark-border rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:ring-2 focus:ring-primary-blue/50"
            >
              {availableVoices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.language}) {v.gender ? `• ${v.gender}` : ''}
                </option>
              ))}
            </select>

            {/* Voice Sample Preview Button */}
            <button
              type="button"
              onClick={handlePlaySample}
              className={`flex items-center gap-1 px-3 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                isPlayingSample
                  ? 'bg-primary-teal/20 text-primary-teal border-primary-teal animate-pulse'
                  : 'bg-dark-bg text-gray-300 border-dark-border hover:text-white hover:border-gray-500'
              }`}
              title="Preview voice sample audio"
            >
              <MaterialIcon name={isPlayingSample ? 'stop' : 'volume_up'} className="text-sm" />
              <span>{isPlayingSample ? 'Stop' : 'Preview'}</span>
            </button>
          </div>
        </div>

        {/* Speed Multiplier */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
              <MaterialIcon name="speed" className="text-sm text-primary-blue" />
              Playback Speed
            </label>
            <span className="text-xs font-mono font-bold text-white bg-dark-bg px-2 py-0.5 rounded border border-dark-border">
              {speed.toFixed(1)}x
            </span>
          </div>
          <div className="flex items-center gap-3 pt-1.5">
            <span className="text-[10px] text-gray-400">0.5x</span>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={speed}
              onChange={(e) => setSpeed(parseFloat(e.target.value))}
              className="flex-1 accent-primary-blue cursor-pointer h-1.5 bg-dark-bg rounded-lg"
            />
            <span className="text-[10px] text-gray-400">2.0x</span>
          </div>
        </div>
      </div>

      {/* Audio Format & Advanced Settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-dark-border/60">
        {/* Output Format */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-gray-300 flex items-center gap-1.5">
            <MaterialIcon name="audio_file" className="text-sm text-primary-blue" />
            Output Format
          </label>
          <div className="flex gap-2">
            {(['mp3', 'wav', 'ogg'] as AudioFormat[]).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setFormat(fmt)}
                className={`flex-1 py-2 px-3 rounded-xl text-xs font-semibold uppercase border transition-all ${
                  format === fmt
                    ? 'bg-primary-blue text-white border-primary-blue shadow'
                    : 'bg-dark-bg text-gray-400 border-dark-border hover:text-white'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>
        </div>

        {/* ElevenLabs Tuning / Stability */}
        {provider === 'elevenlabs' ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-gray-300">
                Voice Stability
              </label>
              <span className="text-xs font-mono text-gray-400">
                {Math.round(stability * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={stability}
              onChange={(e) => setStability(parseFloat(e.target.value))}
              className="w-full accent-primary-blue cursor-pointer h-1.5 bg-dark-bg rounded-lg"
            />
          </div>
        ) : (
          <div className="flex items-center text-xs text-gray-400 bg-dark-bg/60 p-3 rounded-xl border border-dark-border">
            <MaterialIcon name="info" className="text-base text-primary-blue mr-2" />
            <span>Google Neural2 Voices produce natural, studio-quality speech.</span>
          </div>
        )}
      </div>

      {/* Inline Feedback Alerts */}
      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-xs text-red-400 flex items-center gap-2">
          <MaterialIcon name="error" className="text-base" />
          <span>{error}</span>
        </div>
      )}

      {validationError && !error && text.length > 0 && (
        <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-300 flex items-center gap-2">
          <MaterialIcon name="warning" className="text-sm" />
          <span>{validationError}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-400 flex items-center gap-2">
          <MaterialIcon name="check_circle" className="text-base" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        disabled={!isFormValid || submitting}
        className="w-full py-3 px-6 rounded-xl bg-primary-blue text-white text-sm font-bold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg"
      >
        {submitting ? (
          <>
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
            <span>Submitting TTS Job...</span>
          </>
        ) : (
          <>
            <MaterialIcon name="send" className="text-base" />
            <span>Generate Audio Narration</span>
          </>
        )}
      </button>
    </form>
  );
};

export default TtsJobForm;
