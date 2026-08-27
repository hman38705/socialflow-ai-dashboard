import React, { useState, useEffect, useCallback, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TwoFactorSetupProps {
  /** Called when setup is fully confirmed and the modal should close. */
  onComplete: () => void;
  /** Called when the user cancels at any step. */
  onCancel: () => void;
}

interface SetupData {
  secret: string;
  qrCodeDataUrl: string;
  recoveryCodes: string[];
}

type Step = 'qr' | 'verify' | 'recovery';

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchSetup(): Promise<SetupData> {
  const res = await fetch('/api/auth/2fa/setup', { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? 'Failed to initiate 2FA setup');
  }
  return res.json() as Promise<SetupData>;
}

async function verifySetupCode(code: string): Promise<{ recoveryCodes: string[] }> {
  const res = await fetch('/api/auth/2fa/verify-setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { message?: string }).message ?? 'Verification failed');
  }
  return res.json() as Promise<{ recoveryCodes: string[] }>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TwoFactorSetup({ onComplete, onCancel }: TwoFactorSetupProps) {
  const [step, setStep] = useState<Step>('qr');
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [secretRevealed, setSecretRevealed] = useState(false);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Secret must never leak to the console
  const secretRef = useRef<string>('');

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchSetup()
      .then((data) => {
        if (cancelled) return;
        // Store secret in a ref so it is not serialised by React DevTools
        secretRef.current = data.secret;
        setSetupData(data);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load QR code');
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Step 1 handlers ────────────────────────────────────────────────────────

  const handleRevealToggle = useCallback(() => {
    setSecretRevealed((prev) => !prev);
  }, []);

  const handleNextToVerify = useCallback(() => {
    setStep('verify');
    setVerifyCode('');
    setVerifyError(null);
  }, []);

  // ── Step 2 handlers ────────────────────────────────────────────────────────

  const handleVerifySubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (verifyCode.length !== 6 || !/^\d{6}$/.test(verifyCode)) {
        setVerifyError('Please enter a 6-digit code.');
        return;
      }
      setIsVerifying(true);
      setVerifyError(null);
      try {
        const result = await verifySetupCode(verifyCode);
        setRecoveryCodes(result.recoveryCodes);
        setStep('recovery');
      } catch (err: unknown) {
        // Do NOT regenerate the secret on failure — just show inline error
        setVerifyError(err instanceof Error ? err.message : 'Invalid code. Please try again.');
        setVerifyCode('');
      } finally {
        setIsVerifying(false);
      }
    },
    [verifyCode],
  );

  // ── Step 3 handlers ────────────────────────────────────────────────────────

  const handleCopyCodes = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be restricted in some environments; fail silently
    }
  }, [recoveryCodes]);

  const handleDownloadCodes = useCallback(() => {
    const blob = new Blob([recoveryCodes.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'socialflow-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [recoveryCodes]);

  const handleClose = useCallback(() => {
    if (step === 'recovery' && !savedConfirmed) {
      // Block close until the user confirms they saved the codes
      return;
    }
    onComplete();
  }, [step, savedConfirmed, onComplete]);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  // ── Masked secret display ──────────────────────────────────────────────────

  const maskedSecret = secretRef.current
    ? secretRef.current
        .replace(/./g, '•')
        .replace(/(.{4})/g, '$1 ')
        .trim()
    : '';

  const formattedSecret = secretRef.current
    ? secretRef.current.replace(/(.{4})/g, '$1 ').trim()
    : '';

  // ── Step progress indicator ────────────────────────────────────────────────

  const steps: { id: Step; label: string }[] = [
    { id: 'qr', label: 'Scan' },
    { id: 'verify', label: 'Verify' },
    { id: 'recovery', label: 'Save codes' },
  ];

  const stepIndex = steps.findIndex((s) => s.id === step);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="2fa-setup-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      data-testid="two-factor-setup-modal"
    >
      <div className="w-full max-w-md rounded-2xl bg-dark-elev shadow-elev-3 border border-dark-border overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-dark-border">
          <h2 id="2fa-setup-title" className="text-lg font-semibold text-white">
            Set up two-factor authentication
          </h2>
          {step !== 'recovery' && (
            <button
              type="button"
              onClick={handleCancel}
              aria-label="Cancel setup"
              className="text-gray-subtext hover:text-white transition-colors"
            >
              ✕
            </button>
          )}
        </div>

        {/* Step progress */}
        <div className="flex px-6 pt-4 gap-2" role="list" aria-label="Setup steps">
          {steps.map((s, i) => (
            <div key={s.id} role="listitem" className="flex items-center gap-2 flex-1">
              <div
                className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold shrink-0 transition-colors ${
                  i < stepIndex
                    ? 'bg-trend-up text-dark-bg'
                    : i === stepIndex
                      ? 'bg-primary-blue text-white'
                      : 'bg-dark-border text-gray-subtext'
                }`}
                aria-current={i === stepIndex ? 'step' : undefined}
              >
                {i < stepIndex ? '✓' : i + 1}
              </div>
              <span
                className={`text-xs font-medium ${
                  i === stepIndex ? 'text-white' : 'text-gray-subtext'
                }`}
              >
                {s.label}
              </span>
              {i < steps.length - 1 && (
                <div className="flex-1 h-px bg-dark-border" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          {/* ── Step 1: QR code ─────────────────────────────────── */}
          {step === 'qr' && (
            <div data-testid="step-qr">
              {isLoading && (
                <div className="flex justify-center py-8" aria-label="Loading QR code">
                  <div className="w-8 h-8 border-2 border-primary-blue border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {loadError && (
                <p role="alert" className="text-trend-down text-sm text-center py-4">
                  {loadError}
                </p>
              )}
              {!isLoading && !loadError && setupData && (
                <>
                  <p className="text-gray-subtext text-sm mb-4">
                    Scan this QR code with your authenticator app (e.g. Google Authenticator,
                    Authy). Then click <strong className="text-white">Next</strong>.
                  </p>

                  {/* QR code image */}
                  <div className="flex justify-center mb-4">
                    <div className="p-3 bg-white rounded-lg inline-block">
                      <img
                        src={setupData.qrCodeDataUrl}
                        alt="QR code for two-factor authentication setup"
                        className="w-40 h-40"
                        data-testid="qr-code-image"
                      />
                    </div>
                  </div>

                  {/* Manual entry */}
                  <div className="rounded-xl bg-dark-bg border border-dark-border p-4 mb-5">
                    <p className="text-xs text-gray-subtext mb-2 font-medium uppercase tracking-wide">
                      Can't scan? Enter this key manually
                    </p>
                    <div className="flex items-center gap-2">
                      <code
                        className="flex-1 font-mono text-sm text-primary-teal tracking-widest break-all"
                        data-testid="manual-secret"
                        aria-label="Manual entry key"
                      >
                        {secretRevealed ? formattedSecret : maskedSecret}
                      </code>
                      <button
                        type="button"
                        onClick={handleRevealToggle}
                        aria-label={secretRevealed ? 'Hide secret key' : 'Reveal secret key'}
                        className="shrink-0 text-xs font-medium px-2 py-1 rounded-md bg-dark-elev border border-dark-border text-gray-subtext hover:text-white transition-colors"
                        data-testid="reveal-toggle"
                      >
                        {secretRevealed ? 'Hide' : 'Reveal'}
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleNextToVerify}
                    className="w-full py-2.5 rounded-xl bg-primary-blue text-white font-semibold hover:opacity-90 transition-opacity"
                    data-testid="btn-next-to-verify"
                  >
                    Next
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── Step 2: Verify code ──────────────────────────────── */}
          {step === 'verify' && (
            <div data-testid="step-verify">
              <p className="text-gray-subtext text-sm mb-5">
                Enter the 6-digit code shown in your authenticator app to confirm setup.
              </p>
              <form onSubmit={handleVerifySubmit} noValidate>
                <label
                  htmlFor="verify-code"
                  className="block text-xs font-medium text-gray-subtext mb-1.5 uppercase tracking-wide"
                >
                  Verification code
                </label>
                <input
                  id="verify-code"
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  placeholder="000000"
                  value={verifyCode}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                    setVerifyCode(val);
                    if (verifyError) setVerifyError(null);
                  }}
                  className={`w-full px-4 py-2.5 rounded-xl bg-dark-bg border text-white font-mono text-center text-2xl tracking-widest focus:outline-none focus:ring-2 focus:ring-primary-blue transition ${
                    verifyError ? 'border-trend-down' : 'border-dark-border'
                  }`}
                  aria-invalid={verifyError ? 'true' : 'false'}
                  aria-describedby={verifyError ? 'verify-error' : undefined}
                  data-testid="verify-code-input"
                  disabled={isVerifying}
                />
                {verifyError && (
                  <p
                    id="verify-error"
                    role="alert"
                    className="mt-2 text-sm text-trend-down"
                    data-testid="verify-error"
                  >
                    {verifyError}
                  </p>
                )}
                <div className="flex gap-3 mt-5">
                  <button
                    type="button"
                    onClick={() => setStep('qr')}
                    disabled={isVerifying}
                    className="flex-1 py-2.5 rounded-xl border border-dark-border text-gray-subtext hover:text-white hover:border-white/20 transition disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={isVerifying || verifyCode.length !== 6}
                    className="flex-1 py-2.5 rounded-xl bg-primary-blue text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                    data-testid="btn-verify-submit"
                  >
                    {isVerifying ? 'Verifying…' : 'Verify'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ── Step 3: Recovery codes ───────────────────────────── */}
          {step === 'recovery' && (
            <div data-testid="step-recovery">
              <div className="flex items-start gap-3 p-3 mb-4 rounded-xl bg-primary-rose/10 border border-primary-rose/30">
                <span className="text-primary-rose text-lg shrink-0" aria-hidden="true">
                  ⚠
                </span>
                <p className="text-sm text-primary-rose">
                  Save these recovery codes now. They won't be shown again. Each code can only be
                  used once.
                </p>
              </div>

              <div
                className="grid grid-cols-2 gap-2 mb-4 p-4 rounded-xl bg-dark-bg border border-dark-border"
                data-testid="recovery-codes-list"
                aria-label="Recovery codes"
              >
                {recoveryCodes.map((code) => (
                  <code key={code} className="font-mono text-sm text-primary-teal text-center py-1">
                    {code}
                  </code>
                ))}
              </div>

              <div className="flex gap-3 mb-5">
                <button
                  type="button"
                  onClick={handleCopyCodes}
                  className="flex-1 py-2 rounded-xl border border-dark-border text-sm text-gray-subtext hover:text-white hover:border-white/20 transition"
                  data-testid="btn-copy-codes"
                >
                  {copied ? 'Copied!' : 'Copy codes'}
                </button>
                <button
                  type="button"
                  onClick={handleDownloadCodes}
                  className="flex-1 py-2 rounded-xl border border-dark-border text-sm text-gray-subtext hover:text-white hover:border-white/20 transition"
                  data-testid="btn-download-codes"
                >
                  Download
                </button>
              </div>

              <label className="flex items-start gap-3 cursor-pointer mb-5">
                <input
                  type="checkbox"
                  checked={savedConfirmed}
                  onChange={(e) => setSavedConfirmed(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-dark-border accent-primary-blue"
                  data-testid="confirm-saved-checkbox"
                />
                <span className="text-sm text-gray-subtext">
                  I have saved my recovery codes in a secure place.
                </span>
              </label>

              <button
                type="button"
                onClick={handleClose}
                disabled={!savedConfirmed}
                className="w-full py-2.5 rounded-xl bg-primary-blue text-white font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                data-testid="btn-finish"
                aria-disabled={!savedConfirmed}
              >
                Finish — 2FA is now active
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TwoFactorSetup;
