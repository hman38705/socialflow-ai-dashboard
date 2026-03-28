import { createLogger } from '../lib/logger';

const logger = createLogger('moderation-service');

export type SensitivityLevel = 'low' | 'medium' | 'high';

/**
 * Structured alert event for moderation bypass incidents.
 * Used for monitoring and alerting when moderation is skipped or blocked.
 */
export interface ModerationAlert {
  type: 'MODERATION_BYPASSED' | 'MODERATION_BLOCKED' | 'MODERATION_ERROR';
  timestamp: Date;
  mode: 'fail-open' | 'fail-closed';
  reason: string;
  severity: 'warning' | 'error' | 'critical';
  context?: Record<string, unknown>;
}

export interface ModerationResult {
  flagged: boolean;
  blocked: boolean;
  categories: Record<string, boolean>;
  scores: Record<string, number>;
  reason?: string;
}

/**
 * Thresholds per sensitivity level.
 * A category score above the threshold triggers a flag/block.
 *
 * low    — only block clearly harmful content (high threshold)
 * medium — balanced (default)
 * high   — strict; flag borderline content
 */
const THRESHOLDS: Record<SensitivityLevel, number> = {
  low: 0.85,
  medium: 0.6,
  high: 0.3,
};

/**
 * Categories that always result in a hard block regardless of sensitivity.
 */
const ALWAYS_BLOCK = new Set([
  'sexual/minors',
  'hate/threatening',
  'violence/graphic',
  'self-harm/instructions',
]);

function getSensitivity(): SensitivityLevel {
  const val = (process.env.MODERATION_SENSITIVITY ?? 'medium').toLowerCase();
  if (val === 'low' || val === 'high') return val;
  return 'medium';
}

/**
 * MODERATION_MODE controls behaviour when the provider is unavailable
 * (missing API key, timeout, or malformed response):
 *
 *   fail-open   (default) — bypass moderation and allow the content through.
 *                           Logs a warning. Use when availability > safety.
 *   fail-closed           — block the content and throw.
 *                           Use when safety > availability.
 */
function getMode(): 'fail-open' | 'fail-closed' {
  return process.env.MODERATION_MODE === 'fail-closed' ? 'fail-closed' : 'fail-open';
}

const BYPASS_RESULT: ModerationResult = { flagged: false, blocked: false, categories: {}, scores: {} };

/**
 * Emits a structured alert event for moderation system state changes.
 * This enables monitoring dashboards and alerting systems to track moderation
 * bypass events, errors, and blocks in real-time.
 * 
 * Production setup should forward these alerts to:
 * - Sentry/error tracking (for errors)
 * - CloudWatch/DataDog/similar (for metrics)
 * - Slack/PagerDuty (for critical alerts)
 */
function emitModerationAlert(alert: ModerationAlert): void {
  const alertMsg = `[MODERATION-ALERT] type=${alert.type} mode=${alert.mode} severity=${alert.severity}`;
  
  switch (alert.severity) {
    case 'critical':
      // Critical alerts should trigger immediate actions
      logger.error(alertMsg, {
        reason: alert.reason,
        timestamp: alert.timestamp,
        context: alert.context,
      });
      // TODO: Emit to error tracking system (Sentry, etc.)
      break;
    case 'error':
      logger.error(alertMsg, { reason: alert.reason, context: alert.context });
      break;
    case 'warning':
      logger.warn(alertMsg, { reason: alert.reason, context: alert.context });
      break;
  }
  
  // TODO: Emit structured event to monitoring system (CloudWatch, DataDog, etc.)
  // Example: metrics.emit('moderation_alert', { type: alert.type, mode: alert.mode });
}

export const ModerationService = {
  isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY;
  },

  /**
   * Moderate content using the OpenAI Moderation API.
   *
   * Behavior when the provider is unavailable depends on MODERATION_MODE:
   *
   *   fail-open (default)
   *   ─────────────────
   *   - Content is allowed through
   *   - Warning is logged
   *   - Alert is emitted
   *   - Use when: service availability > safety (e.g., user-facing features)
   *   - Risk: unsafe content may slip through in misconfigured deployments
   *   - Test: verify alerts are emitted for missing OPENAI_API_KEY
   *
   *   fail-closed
   *   ──────────
   *   - Content is blocked with an error
   *   - Error is logged and thrown
   *   - Critical alert is emitted
   *   - Use when: safety > availability (e.g., compliance-critical systems)
   *   - Risk: legitimate content blocked if service is down
   *   - Test: verify errors are thrown and requests rejected
   *
   * Configuration:
   *   MODERATION_MODE=fail-open     (default, less strict)
   *   MODERATION_MODE=fail-closed   (strict, safety-first)
   *   OPENAI_API_KEY=sk-xxx         (required, otherwise behavior above applies)
   *   MODERATION_SENSITIVITY=low|medium|high  (default: medium)
   */
  async moderate(text: string): Promise<ModerationResult> {
    if (!this.isConfigured()) {
      const msg = 'ModerationService: OPENAI_API_KEY not set — skipping moderation';
      const mode = getMode();
      
      if (mode === 'fail-closed') {
        // Critical security alert: moderation disabled in fail-closed mode
        emitModerationAlert({
          type: 'MODERATION_BLOCKED',
          timestamp: new Date(),
          mode: 'fail-closed',
          reason: 'OPENAI_API_KEY not configured',
          severity: 'critical',
          context: { config_status: 'missing_api_key' },
        });
        logger.error(msg);
        throw new Error('Moderation unavailable: OPENAI_API_KEY not set');
      }
      
      // Warning level: moderation bypassed in fail-open mode
      emitModerationAlert({
        type: 'MODERATION_BYPASSED',
        timestamp: new Date(),
        mode: 'fail-open',
        reason: 'OPENAI_API_KEY not configured, failing open',
        severity: 'warning',
        context: { config_status: 'missing_api_key' },
      });
      logger.warn(msg);
      return BYPASS_RESULT;
    }

    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ input: text }),
      signal: AbortSignal.timeout(10_000),
    }).catch((err: unknown) => {
      const isTimeout = err instanceof Error && err.name === 'TimeoutError';
      const errorReason = isTimeout ? 'Moderation API timeout (10s)' : 'Moderation API unreachable';
      const mode = getMode();
      
      logger.error(errorReason, { error: err instanceof Error ? err.message : String(err) });
      
      if (mode === 'fail-closed') {
        // Critical alert: moderation error in fail-closed mode
        emitModerationAlert({
          type: 'MODERATION_ERROR',
          timestamp: new Date(),
          mode: 'fail-closed',
          reason: errorReason,
          severity: 'critical',
          context: {
            is_timeout: isTimeout,
            error: err instanceof Error ? err.message : String(err),
          },
        });
        throw new Error(errorReason);
      }
      
      // Warning: moderation error but failing open
      emitModerationAlert({
        type: 'MODERATION_BYPASSED',
        timestamp: new Date(),
        mode: 'fail-open',
        reason: `${errorReason}, failing open`,
        severity: 'warning',
        context: {
          is_timeout: isTimeout,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      logger.warn(`${errorReason} — failing open`);
      return null;
    });

    if (response === null) return BYPASS_RESULT;

    if (!response.ok) {
      const body = await response.text();
      const mode = getMode();
      logger.error('OpenAI Moderation API error', { status: response.status, body });
      
      if (mode === 'fail-closed') {
        emitModerationAlert({
          type: 'MODERATION_ERROR',
          timestamp: new Date(),
          mode: 'fail-closed',
          reason: `Moderation API returned ${response.status}`,
          severity: 'error',
          context: { http_status: response.status },
        });
        throw new Error(`Moderation API returned ${response.status}`);
      }
      
      // Fail open: log warning but continue
      emitModerationAlert({
        type: 'MODERATION_BYPASSED',
        timestamp: new Date(),
        mode: 'fail-open',
        reason: `Moderation API error ${response.status}, failing open`,
        severity: 'warning',
        context: { http_status: response.status },
      });
      return BYPASS_RESULT;
    }

    let data: {
      results: Array<{
        flagged: boolean;
        categories: Record<string, boolean>;
        category_scores: Record<string, number>;
      }>;
    };

    try {
      data = (await response.json()) as typeof data;
      if (!Array.isArray(data?.results) || !data.results[0]) throw new Error('unexpected shape');
    } catch {
      const mode = getMode();
      const msg = 'Moderation API returned malformed response';
      logger.error(msg);
      
      if (mode === 'fail-closed') {
        emitModerationAlert({
          type: 'MODERATION_ERROR',
          timestamp: new Date(),
          mode: 'fail-closed',
          reason: msg,
          severity: 'error',
          context: { error_type: 'malformed_response' },
        });
        throw new Error(msg);
      }
      
      // Fail open: log warning
      emitModerationAlert({
        type: 'MODERATION_BYPASSED',
        timestamp: new Date(),
        mode: 'fail-open',
        reason: `${msg}, failing open`,
        severity: 'warning',
        context: { error_type: 'malformed_response' },
      });
      logger.warn(`${msg} — failing open`);
      return BYPASS_RESULT;
    }

    const result = data.results[0];
    const sensitivity = getSensitivity();
    const threshold = THRESHOLDS[sensitivity];

    // Hard block on always-blocked categories
    const hardBlock = Object.entries(result.categories).some(
      ([cat, active]) => active && ALWAYS_BLOCK.has(cat),
    );

    // Threshold-based flag for remaining categories
    const thresholdFlag = Object.entries(result.category_scores).some(
      ([, score]) => score >= threshold,
    );

    const flagged = result.flagged || thresholdFlag || hardBlock;
    const blocked = hardBlock || (flagged && sensitivity !== 'low');

    const reason = flagged
      ? Object.entries(result.categories)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(', ')
      : undefined;

    logger.info('Moderation result', { flagged, blocked, sensitivity, reason });

    return {
      flagged,
      blocked,
      categories: result.categories,
      scores: result.category_scores,
      reason,
    };
  },
};
