import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, LogIn, Rocket, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ApiError } from '../api/core/ApiError';
import { ErrorCode, ErrorStatusMap } from '../constants/ErrorCodes';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS_TO_CODE = new Map<number, ErrorCode>(
  (Object.entries(ErrorStatusMap) as [ErrorCode, number][]).map(([code, status]) => [status, code]),
);

const FRIENDLY_ERRORS: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.ERR_INVALID_CREDENTIALS]: 'Incorrect email or password.',
  [ErrorCode.ERR_VALIDATION_FAILED]: 'Please check your email and password.',
  [ErrorCode.ERR_BAD_REQUEST]: 'Please check your email and password.',
  [ErrorCode.ERR_NETWORK_ERROR]: 'Network error — check your connection and try again.',
  [ErrorCode.ERR_INTERNAL_SERVER_ERROR]:
    'Something went wrong on our end. Please try again shortly.',
};

function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    // A 401 here always means "invalid credentials" — never confirm or deny that the email exists.
    if (err.status === 401) return FRIENDLY_ERRORS[ErrorCode.ERR_INVALID_CREDENTIALS]!;
    const code = STATUS_TO_CODE.get(err.status);
    return (code && FRIENDLY_ERRORS[code]) || 'Something went wrong. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}

type Step = 'credentials' | 'two-factor';

interface FieldErrors {
  email?: string;
  password?: string;
}

export const LoginPage: React.FC = () => {
  const { login, completeTwoFactor } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next') || '/';

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validate = (): boolean => {
    const errors: FieldErrors = {};
    if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (!password) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const result = await login(email.trim(), password);
      if (result.twoFactorRequired) {
        setStep('two-factor');
      } else {
        navigate(next, { replace: true });
      }
    } catch (err) {
      setFormError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!code.trim()) {
      setFormError('Enter the 6-digit code from your authenticator app.');
      return;
    }

    setSubmitting(true);
    try {
      await completeTwoFactor(code.trim());
      navigate(next, { replace: true });
    } catch (err) {
      setFormError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center p-6 bg-dark-bg overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-glow-conic opacity-10 blur-3xl" />

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-dark-border bg-dark-surface backdrop-blur-xl p-10 shadow-elev-3">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shadow-glow-rose bg-gradient-to-br from-primary-rose to-primary-blue">
            <Rocket className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">
            SocialFlow AI
          </h1>
        </div>

        {step === 'credentials' ? (
          <>
            <h2 className="text-xl font-bold text-white mb-1">Sign in to your workspace</h2>
            <p className="text-sm text-gray-subtext mb-8">
              Manage every channel from one AI-powered cockpit.
            </p>

            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
                  Email
                </span>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-3 text-sm text-white focus:outline-none focus:border-primary-blue/50 transition-all"
                  placeholder="you@company.com"
                />
                {fieldErrors.email && (
                  <p className="mt-1 text-xs text-trend-down">{fieldErrors.email}</p>
                )}
              </label>

              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
                  Password
                </span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-3 text-sm text-white focus:outline-none focus:border-primary-blue/50 transition-all"
                  placeholder="••••••••"
                />
                {fieldErrors.password && (
                  <p className="mt-1 text-xs text-trend-down">{fieldErrors.password}</p>
                )}
              </label>

              {formError && <p className="text-sm text-trend-down">{formError}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-primary-rose to-primary-blue text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <LogIn className="w-4 h-4" />
                )}
                Sign In
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-subtext">
              Don&apos;t have an account?{' '}
              <Link to="/register" className="text-primary-blue hover:underline">
                Create one
              </Link>
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-5 h-5 text-primary-blue" />
              <h2 className="text-xl font-bold text-white">Two-factor verification</h2>
            </div>
            <p className="text-sm text-gray-subtext mb-8">
              Enter the 6-digit code from your authenticator app.
            </p>

            <form onSubmit={handleTwoFactorSubmit} noValidate className="space-y-5">
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
                  Authentication code
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-3 text-center text-lg tracking-[0.5em] text-white focus:outline-none focus:border-primary-blue/50 transition-all"
                  placeholder="000000"
                />
              </label>

              {formError && <p className="text-sm text-trend-down">{formError}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-primary-rose to-primary-blue text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                Verify
              </button>

              <button
                type="button"
                onClick={() => {
                  setStep('credentials');
                  setCode('');
                  setFormError(null);
                }}
                className="w-full text-center text-sm text-gray-subtext hover:text-white transition-colors"
              >
                Back to sign in
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default LoginPage;
