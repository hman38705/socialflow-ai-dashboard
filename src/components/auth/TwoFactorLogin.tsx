import React, { useState, useRef, useCallback, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TwoFactorLoginProps {
  /** Called on successful verification with the server-issued tokens. */
  onSuccess: (tokens: { accessToken: string; refreshToken: string }) => void;
  /** Called when the user clicks "Cancel / go back". */
  onCancel: () => void;
  /**
   * Forwarded to the POST body so the server can correlate this challenge
   * to a pending pre-auth session.
   */
  challengeToken?: string;
}

type Mode = 'totp' | 'recovery';

interface VerifyTotpResponse {
  accessToken: string;
  refreshToken: string;
}

interface RateLimitBody {
  success: false;
  code: 'RATE_LIMIT_EXCEEDED';
  message: string;
  retryAfter: number;
}

// ─── API helper ───────────────────────────────────────────────────────────────

async function postVerify(
  code: string,
  mode: Mode,
  challengeToken?: string,
): Promise<VerifyTotpResponse> {
  const res = await fetch('/api/auth/2fa/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, mode, challengeToken }),
  });

  if (res.status === 429) {
    const body: RateLimitBody = await res.json();
    const err: Error & { retryAfter?: number } = new Error(
      body.message ?? 'Too many attempts. Please try again later.',
    );
    err.retryAfter = body.retryAfter ?? 60;
    throw err;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? 'Invalid code');
  }

  return res.json() as Promise<VerifyTotpResponse>;
}

// ─── TOTP digit box ───────────────────────────────────────────────────────────

const DIGIT_COUNT = 6;

// ─── Component ────────────────────────────────────────────────────────────────

export function TwoFactorLogin({ onSuccess, onCancel, challengeToken }: TwoFactorLoginProps) {
  // ── TOTP state ─────────────────────────────────────────────────────────────
  const [digits, setDigits] = useState<string[]>(Array(DIGIT_COUNT).fill(''));
  const [mode, setMode] = useState<Mode>('totp');
  const [recoveryCode, setRecoveryCode] = useState('');

  // ── Submission state ───────────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Rate-limit countdown ───────────────────────────────────────────────────
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number>(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const inputRefs = useRef<Array<HTMLInputElement | null>>(Array(DIGIT_COUNT).fill(null));

  // Focus the first input when the component mounts in TOTP mode
  useEffect(() => {
    if (mode === 'totp') {
      inputRefs.current[0]?.focus();
    }
  }, [mode]);

  // Clear the countdown interval on unmount
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // ── Countdown helpers ──────────────────────────────────────────────────────

  const startCountdown = useCallback((seconds: number) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setRateLimitSeconds(seconds);
    countdownRef.current = setInterval(() => {
      setRateLimitSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const isRateLimited = rateLimitSeconds > 0;

  // ── Submit helper ──────────────────────────────────────────────────────────

  const submitCode = useCallback(
    async (code: string) => {
      if (isRateLimited || isSubmitting) return;
      setIsSubmitting(true);
      setError(null);
      try {
        const tokens = await postVerify(code, mode, challengeToken);
        onSuccess(tokens);
      } catch (err: unknown) {
        const e = err as Error & { retryAfter?: number };
        if (e.retryAfter !== undefined) {
          startCountdown(e.retryAfter);
          setError(e.message);
        } else {
          setError(e.message ?? 'Invalid code. Please try again.');
          // Wrong code — clear inputs and refocus first box
          setDigits(Array(DIGIT_COUNT).fill(''));
          setTimeout(() => inputRefs.current[0]?.focus(), 0);
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [isRateLimited, isSubmitting, mode, challengeToken, onSuccess, startCountdown],
  );

  // ── TOTP input handlers ────────────────────────────────────────────────────

  const handleDigitChange = useCallback(
    (index: number, value: string) => {
      // Accept only the last typed numeric character
      const char = value.replace(/\D/g, '').slice(-1);
      if (!char) return;

      const next = [...digits];
      next[index] = char;
      setDigits(next);

      // Auto-advance focus
      if (index < DIGIT_COUNT - 1) {
        inputRefs.current[index + 1]?.focus();
      }

      // Auto-submit when the last digit is filled
      if (index === DIGIT_COUNT - 1) {
        const code = next.join('');
        if (code.length === DIGIT_COUNT) {
          submitCode(code);
        }
      }
    },
    [digits, submitCode],
  );

  const handleDigitKeyDown = useCallback(
    (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Backspace') {
        e.preventDefault();
        if (digits[index]) {
          // Clear the current box
          const next = [...digits];
          next[index] = '';
          setDigits(next);
        } else if (index > 0) {
          // Move focus to previous box and clear it
          const next = [...digits];
          next[index - 1] = '';
          setDigits(next);
          inputRefs.current[index - 1]?.focus();
        }
      } else if (e.key === 'ArrowLeft' && index > 0) {
        e.preventDefault();
        inputRefs.current[index - 1]?.focus();
      } else if (e.key === 'ArrowRight' && index < DIGIT_COUNT - 1) {
        e.preventDefault();
        inputRefs.current[index + 1]?.focus();
      }
    },
    [digits],
  );

  const handleDigitPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, DIGIT_COUNT);
      if (!pasted) return;

      const next = Array(DIGIT_COUNT).fill('');
      for (let i = 0; i < pasted.length; i++) {
        next[i] = pasted[i];
      }
      setDigits(next);

      // Focus the box after the last pasted digit (or the last box)
      const focusIndex = Math.min(pasted.length, DIGIT_COUNT - 1);
      inputRefs.current[focusIndex]?.focus();

      // Auto-submit if all 6 digits were pasted
      if (pasted.length === DIGIT_COUNT) {
        submitCode(pasted);
      }
    },
    [submitCode],
  );

  // ── Recovery mode submit ───────────────────────────────────────────────────

  const handleRecoverySubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!recoveryCode.trim()) {
        setError('Please enter a recovery code.');
        return;
      }
      await submitCode(recoveryCode.trim());
    },
    [recoveryCode, submitCode],
  );

  // ── Mode toggle ────────────────────────────────────────────────────────────

  const handleSwitchToRecovery = useCallback(() => {
    setMode('recovery');
    setDigits(Array(DIGIT_COUNT).fill(''));
    setError(null);
  }, []);

  const handleSwitchToTotp = useCallback(() => {
    setMode('totp');
    setRecoveryCode('');
    setError(null);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  const isDisabled = isSubmitting || isRateLimited;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="2fa-login-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      data-testid="two-factor-login-modal"
    >
      <div className="w-full max-w-sm rounded-2xl bg-dark-elev shadow-elev-3 border border-dark-border overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-dark-border">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-8 h-8 rounded-full bg-primary-blue/20 flex items-center justify-center shrink-0">
              <span className="text-primary-blue text-base" aria-hidden="true">
                🔒
              </span>
            </div>
            <h2 id="2fa-login-title" className="text-lg font-semibold text-white">
              Two-factor authentication
            </h2>
          </div>
          <p className="text-sm text-gray-subtext ml-11">
            {mode === 'totp'
              ? 'Enter the 6-digit code from your authenticator app.'
              : 'Enter one of your recovery codes.'}
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          {/* ── TOTP mode ───────────────────────────────────────── */}
          {mode === 'totp' && (
            <div data-testid="totp-mode">
              {/* Six individual digit inputs */}
              <div
                className="flex gap-3 justify-center mb-5"
                role="group"
                aria-label="Authentication code digits"
              >
                {digits.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      inputRefs.current[i] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleDigitChange(i, e.target.value)}
                    onKeyDown={(e) => handleDigitKeyDown(i, e)}
                    onPaste={handleDigitPaste}
                    disabled={isDisabled}
                    aria-label={`Digit ${i + 1}`}
                    autoComplete={i === 0 ? 'one-time-code' : 'off'}
                    className={`w-11 h-14 rounded-xl bg-dark-bg border text-white text-2xl font-mono text-center focus:outline-none focus:ring-2 focus:ring-primary-blue transition disabled:opacity-50 ${
                      error && !isRateLimited ? 'border-trend-down' : 'border-dark-border'
                    }`}
                    data-testid={`digit-input-${i}`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Recovery mode ────────────────────────────────────── */}
          {mode === 'recovery' && (
            <form onSubmit={handleRecoverySubmit} data-testid="recovery-mode" noValidate>
              <label
                htmlFor="recovery-code-input"
                className="block text-xs font-medium text-gray-subtext mb-1.5 uppercase tracking-wide"
              >
                Recovery code
              </label>
              <input
                id="recovery-code-input"
                type="text"
                value={recoveryCode}
                onChange={(e) => {
                  setRecoveryCode(e.target.value);
                  if (error) setError(null);
                }}
                disabled={isDisabled}
                placeholder="XXXX-0000"
                className="w-full px-4 py-2.5 rounded-xl bg-dark-bg border border-dark-border text-white font-mono text-center focus:outline-none focus:ring-2 focus:ring-primary-blue transition disabled:opacity-50"
                aria-invalid={error ? 'true' : 'false'}
                data-testid="recovery-code-input"
                autoFocus
              />
            </form>
          )}

          {/* ── Error / rate-limit message ──────────────────────── */}
          {error && (
            <p
              role="alert"
              className="mt-3 text-sm text-trend-down text-center"
              data-testid="login-error"
            >
              {error}
            </p>
          )}

          {/* ── Countdown banner ─────────────────────────────────── */}
          {isRateLimited && (
            <div
              className="mt-3 p-3 rounded-xl bg-primary-rose/10 border border-primary-rose/30 text-center"
              data-testid="rate-limit-banner"
              role="status"
              aria-live="polite"
            >
              <p className="text-sm text-primary-rose font-medium">
                Too many attempts — try again in{' '}
                <span data-testid="countdown-seconds" className="tabular-nums font-bold">
                  {rateLimitSeconds}
                </span>{' '}
                {rateLimitSeconds === 1 ? 'second' : 'seconds'}.
              </p>
            </div>
          )}

          {/* ── Action buttons ───────────────────────────────────── */}
          <div className="flex gap-3 mt-5">
            <button
              type="button"
              onClick={onCancel}
              disabled={isDisabled}
              className="flex-1 py-2.5 rounded-xl border border-dark-border text-gray-subtext hover:text-white hover:border-white/20 transition disabled:opacity-50"
              data-testid="btn-cancel"
            >
              Cancel
            </button>
            {mode === 'totp' ? (
              <button
                type="button"
                onClick={() => submitCode(digits.join(''))}
                disabled={isDisabled || digits.join('').length !== DIGIT_COUNT}
                className="flex-1 py-2.5 rounded-xl bg-primary-blue text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                data-testid="btn-verify"
              >
                {isSubmitting ? 'Verifying…' : 'Verify'}
              </button>
            ) : (
              <button
                type="submit"
                form="recovery-mode-form"
                onClick={handleRecoverySubmit}
                disabled={isDisabled || !recoveryCode.trim()}
                className="flex-1 py-2.5 rounded-xl bg-primary-blue text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                data-testid="btn-verify-recovery"
              >
                {isSubmitting ? 'Verifying…' : 'Verify'}
              </button>
            )}
          </div>

          {/* ── Mode switch link ─────────────────────────────────── */}
          <div className="mt-4 text-center">
            {mode === 'totp' ? (
              <button
                type="button"
                onClick={handleSwitchToRecovery}
                className="text-xs text-gray-subtext hover:text-primary-blue underline transition-colors"
                data-testid="btn-switch-to-recovery"
              >
                Use a recovery code instead
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSwitchToTotp}
                className="text-xs text-gray-subtext hover:text-primary-blue underline transition-colors"
                data-testid="btn-switch-to-totp"
              >
                Use authenticator app instead
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TwoFactorLogin;
