import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { OpenAPI } from '../api/core/OpenAPI';
import { request as __request } from '../api/core/request';
import { ApiError } from '../api/core/ApiError';

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

type TokenState = 'validating' | 'valid' | 'invalid';

async function validateResetToken(token: string): Promise<boolean> {
  try {
    await __request<{ valid: boolean }>(OpenAPI, {
      method: 'GET',
      url: '/auth/reset-password/validate',
      query: { token },
    });
    return true;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 400 || err.status === 404 || err.status === 410)) {
      return false;
    }
    return false;
  }
}

async function submitNewPassword(token: string, password: string): Promise<void> {
  await __request(OpenAPI, {
    method: 'POST',
    url: '/auth/reset-password',
    body: { token, password },
    mediaType: 'application/json',
    errors: {
      400: `Validation error or expired token`,
    },
  });
}

// Mirrors the strength-meter contract the shared FE-044 component will
// expose (score 0-4 + label); inlined here until that component lands so
// this page doesn't have to wait on it.
function scorePassword(password: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password) && password.length >= 12) score++;
  const labels = ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score: score as 0 | 1 | 2 | 3 | 4, label: labels[score] };
}

const STRENGTH_COLORS = ['bg-primary-rose', 'bg-primary-rose', 'bg-yellow-500', 'bg-primary-teal', 'bg-trend-up'];

export const ResetPasswordPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Capture the token once on mount, then immediately scrub it from the
  // visible URL/history so it isn't left sitting in the address bar,
  // browser history, or referrer headers of any subsequent navigation.
  const [token] = useState(() => searchParams.get('token') ?? '');
  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const [tokenState, setTokenState] = useState<TokenState>('validating');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setTokenState('invalid');
      return;
    }
    validateResetToken(token).then((valid) => {
      if (!cancelled) setTokenState(valid ? 'valid' : 'invalid');
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const strength = useMemo(() => scorePassword(password), [password]);
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (strength.score < 2) {
      setError('Choose a stronger password.');
      return;
    }
    if (!passwordsMatch) {
      setError('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitNewPassword(token, password);
      navigate('/login', { replace: true, state: { toast: { kind: 'success', message: 'Password reset. Sign in with your new password.' } } });
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setTokenState('invalid');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to reset password. Try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-6 bg-dark-bg overflow-hidden">
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-dark-border bg-dark-surface backdrop-blur-xl p-10 shadow-elev-3">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shadow-glow-blue bg-gradient-to-br from-primary-blue to-primary-purple">
            <MaterialIcon name="lock_reset" className="text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">
            SocialFlow AI
          </h1>
        </div>

        {tokenState === 'validating' && (
          <div data-testid="reset-password-validating" className="flex items-center gap-2 text-gray-subtext text-sm">
            <MaterialIcon name="progress_activity" className="animate-spin text-lg" />
            Validating your link…
          </div>
        )}

        {tokenState === 'invalid' && (
          <div data-testid="reset-password-invalid" className="space-y-4">
            <div className="flex items-center gap-2 text-primary-rose">
              <MaterialIcon name="error" className="text-2xl" />
              <h2 className="text-lg font-bold text-white">This link has expired</h2>
            </div>
            <p className="text-sm text-gray-subtext leading-relaxed">
              Your password reset link is invalid or has already been used. Request a new one to
              continue.
            </p>
            <Link
              to="/forgot-password"
              className="inline-flex items-center gap-2 w-full justify-center py-3 rounded-xl bg-primary-blue text-white text-sm font-bold hover:bg-primary-blue/90 transition-all"
            >
              <MaterialIcon name="autorenew" className="text-lg" />
              Request a new link
            </Link>
          </div>
        )}

        {tokenState === 'valid' && (
          <>
            <h2 className="text-xl font-bold text-white mb-1">Choose a new password</h2>
            <p className="text-sm text-gray-subtext mb-8">Make it something you haven't used before.</p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
                  New password
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-3 text-sm text-white focus:outline-none focus:border-primary-blue/50 transition-all"
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
                {password.length > 0 && (
                  <div className="mt-2">
                    <div className="flex gap-1">
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className={`h-1.5 flex-1 rounded-full ${
                            i < strength.score ? STRENGTH_COLORS[strength.score] : 'bg-dark-border'
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-gray-subtext mt-1 inline-block">{strength.label}</span>
                  </div>
                )}
              </label>

              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
                  Confirm password
                </span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-3 text-sm text-white focus:outline-none focus:border-primary-blue/50 transition-all"
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
                {confirmPassword.length > 0 && !passwordsMatch && (
                  <span className="text-xs text-primary-rose mt-1 inline-block">Passwords don't match.</span>
                )}
              </label>

              {error && (
                <p role="alert" className="text-sm text-primary-rose">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={isSubmitting || !passwordsMatch}
                className="w-full py-3 rounded-xl bg-primary-blue text-white text-sm font-bold flex items-center justify-center gap-2 hover:bg-primary-blue/90 disabled:opacity-60 transition-all"
              >
                {isSubmitting ? (
                  <MaterialIcon name="progress_activity" className="animate-spin text-lg" />
                ) : (
                  <MaterialIcon name="check" className="text-lg" />
                )}
                Reset password
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ResetPasswordPage;
