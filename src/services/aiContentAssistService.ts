/**
 * aiContentAssistService — client for AI-assisted composer actions (FE-067).
 *
 * Contract note: as of this rebuild, `AiService.postAiAnalyzeImage`
 * (backend route `/ai/analyze-image`) is the only generated AI endpoint —
 * confirmed against `backend/src/routes/ai.ts` and `backend/openapi.yaml`.
 * There is no backend endpoint yet for text improve/shorten/tone/
 * variations. This service defines the expected `/ai/content-assist`
 * contract per the FE-067 acceptance criteria so the composer UI can be
 * built against it now; requests fail gracefully (a normal network/HTTP
 * error surfaced to the caller) until the backend lands the route.
 * "Suggest hashtags" needs no backend at all — it runs entirely
 * client-side via `generateHashtags()` (src/utils/hashtagGenerator.ts), so
 * that one action is fully functional today.
 */
import { OpenAPI } from '../api/core/OpenAPI';
import { generateHashtags } from '../utils/hashtagGenerator';

export type AiAssistAction = 'improve' | 'shorten' | 'tone' | 'variations' | 'hashtags';

export interface AiAssistRequest {
  action: AiAssistAction;
  text: string;
  tone?: string;
  platform?: string;
}

export interface AiAssistResult {
  suggestions: string[];
}

export interface AiAssistOptions {
  /** Cancels the in-flight request (composer close, or a Stop button). */
  signal?: AbortSignal;
  /** Called with the accumulated text as a streamed response arrives. */
  onChunk?: (partialText: string) => void;
}

async function resolveAuthToken(): Promise<string | undefined> {
  const token = OpenAPI.TOKEN;
  if (token === undefined) return undefined;
  if (typeof token === 'string') return token;
  // The generated client's TOKEN resolver is a Resolver<string> that takes
  // an ApiRequestOptions argument, but every resolver configured via
  // `configureApi()` in this codebase ignores it (see src/api/configure.ts).
  return (token as unknown as () => Promise<string>)();
}

async function resolveExtraHeaders(): Promise<Record<string, string>> {
  const headers = OpenAPI.HEADERS;
  if (!headers) return {};
  if (typeof headers !== 'function') return headers;
  return (headers as unknown as () => Promise<Record<string, string>>)();
}

/**
 * Run one AI content-assist action. Returns suggestion(s) for the caller to
 * show as an explicit accept/reject choice — this never mutates or
 * auto-replaces the user's text itself.
 */
export async function runAiAssist(
  request: AiAssistRequest,
  { signal, onChunk }: AiAssistOptions = {},
): Promise<AiAssistResult> {
  if (request.action === 'hashtags') {
    // Fully client-side — no network round trip, no credit cost.
    const { hashtags } = generateHashtags({ text: request.text, platform: request.platform });
    return { suggestions: [hashtags.join(' ')] };
  }

  const [token, extraHeaders] = await Promise.all([resolveAuthToken(), resolveExtraHeaders()]);

  const response = await fetch(`${OpenAPI.BASE}/ai/content-assist`, {
    method: 'POST',
    signal,
    credentials: OpenAPI.WITH_CREDENTIALS ? OpenAPI.CREDENTIALS : 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream, application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`AI assist request failed (${response.status})`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const isStreaming = contentType.includes('text/event-stream') && response.body;

  if (!isStreaming) {
    const data = (await response.json()) as { suggestions?: string[]; suggestion?: string };
    const suggestions = data.suggestions ?? (data.suggestion ? [data.suggestion] : []);
    return { suggestions };
  }

  // Progressive rendering: read the stream and accumulate text, calling
  // onChunk as each piece arrives so the UI can render it live.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    accumulated += decoder.decode(value, { stream: true });
    onChunk?.(accumulated);
  }

  return { suggestions: [accumulated] };
}

export const AI_ASSIST_ACTIONS: Array<{ value: AiAssistAction; label: string }> = [
  { value: 'improve', label: 'Improve' },
  { value: 'shorten', label: 'Shorten' },
  { value: 'tone', label: 'Change tone' },
  { value: 'variations', label: 'Generate variations' },
  { value: 'hashtags', label: 'Suggest hashtags' },
];
