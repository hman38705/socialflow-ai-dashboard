/**
 * AiAssistPanel — AI content assistance in the composer (FE-067).
 *
 * Every action (improve, shorten, change tone, generate variations, suggest
 * hashtags) produces a *suggestion* the user must explicitly Accept before
 * it touches their text; Reject discards it and leaves the composer's text
 * untouched. In-flight requests are cancellable (Stop button) and are
 * always aborted on unmount (composer close). See
 * `src/services/aiContentAssistService.ts` for the backend contract note —
 * only "suggest hashtags" is backed by a real endpoint today; the other
 * actions call the FE-067 contract ahead of the backend landing it and
 * surface a normal error state until it does.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AI_ASSIST_ACTIONS, runAiAssist, type AiAssistAction } from '../../services/aiContentAssistService';

export interface AiAssistPanelProps {
  /** Current composer text — the input for every action. */
  text: string;
  /** Called only when the user explicitly accepts a suggestion. */
  onAccept: (newText: string) => void;
  /** Optional per-action credit cost, shown before running once billing (FE-119) exposes it. */
  getCreditCost?: (action: AiAssistAction) => number | undefined;
  /** Target platform, passed through for tone/hashtag context. */
  platform?: string;
}

type ToneOption = 'friendly' | 'professional' | 'playful' | 'urgent';

export function AiAssistPanel({ text, onAccept, getCreditCost, platform }: AiAssistPanelProps): React.JSX.Element {
  const [activeAction, setActiveAction] = useState<AiAssistAction | null>(null);
  const [tone, setTone] = useState<ToneOption>('friendly');
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Cancel any in-flight request when the panel unmounts (composer close).
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const run = async (action: AiAssistAction): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setActiveAction(action);
    setError(null);
    setSuggestion(null);
    setIsLoading(true);

    try {
      const result = await runAiAssist(
        { action, text, tone: action === 'tone' ? tone : undefined, platform },
        {
          signal: controller.signal,
          onChunk: (partial) => setSuggestion(partial),
        },
      );
      setSuggestion(result.suggestions[0] ?? '');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // cancelled — not an error state
      }
      setError(err instanceof Error ? err.message : 'AI assist failed. Please try again.');
      setSuggestion(null);
    } finally {
      setIsLoading(false);
    }
  };

  const stop = (): void => {
    abortRef.current?.abort();
    setIsLoading(false);
  };

  const accept = (): void => {
    if (suggestion) {
      onAccept(suggestion);
    }
    setSuggestion(null);
    setActiveAction(null);
  };

  const reject = (): void => {
    // Text is untouched — we simply never call onAccept.
    setSuggestion(null);
    setActiveAction(null);
    setError(null);
  };

  return (
    <div className="ai-assist-panel" data-testid="ai-assist-panel">
      <div className="ai-assist-panel__actions">
        {AI_ASSIST_ACTIONS.map(({ value, label }) => {
          const creditCost = getCreditCost?.(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => void run(value)}
              disabled={isLoading || !text.trim()}
            >
              {label}
              {creditCost !== undefined ? ` (${creditCost} credits)` : ''}
            </button>
          );
        })}
      </div>

      {activeAction === 'tone' && (
        <select value={tone} onChange={(event) => setTone(event.target.value as ToneOption)} aria-label="Tone">
          <option value="friendly">Friendly</option>
          <option value="professional">Professional</option>
          <option value="playful">Playful</option>
          <option value="urgent">Urgent</option>
        </select>
      )}

      {isLoading && (
        <div className="ai-assist-panel__loading">
          <span>Generating…</span>
          <button type="button" onClick={stop}>
            Stop
          </button>
        </div>
      )}

      {error && (
        <div className="ai-assist-panel__error" role="alert">
          {error}
        </div>
      )}

      {suggestion !== null && !isLoading && (
        <div className="ai-assist-panel__suggestion" data-ai-suggestion="true">
          <p className="ai-assist-panel__suggestion-badge">AI suggestion — not yet applied</p>
          <p>{suggestion}</p>
          <div className="ai-assist-panel__suggestion-actions">
            <button type="button" onClick={accept} disabled={!suggestion}>
              Accept
            </button>
            <button type="button" onClick={reject}>
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
