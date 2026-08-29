import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Loader2, Rocket, UserPlus, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ApiError } from '../api/core/ApiError';
import { ErrorCode, ErrorStatusMap } from '../constants/ErrorCodes';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const PASSWORD_REQUIREMENTS: { label: string; test: (v: string) => boolean }[] = [
  { label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { label: 'One lowercase letter', test: (v) => /[a-z]/.test(v) },
  { label: 'One number', test: (v) => /\d/.test(v) },
  { label: 'One symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

const STATUS_TO_CODE = new Map<number, ErrorCode>(
  (Object.entries(ErrorStatusMap) as [ErrorCode, number][]).map(([code, status]) => [status, code]),
);

function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    const code = STATUS_TO_CODE.get(err.status);
    if (code === ErrorCode.ERR_VALIDATION_FAILED || code === ErrorCode.ERR_BAD_REQUEST) {
      return 'Please check your details and try again.';
    }
    return 'Something went wrong. Please try again.';
  }
  return 'Something went wrong. Please try again.';
}

type Step = 'form' | 'verify-email';

interface FieldErrors {
  email?: string;
  password?: string;
  terms?: string;
}

export const RegisterPage: React.FC = () => {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const next = searchParams.get('next') || '/';

  const [step, setStep] = useState<Step>('form');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const requirementResults = useMemo(
    () => PASSWORD_REQUIREMENTS.map((r) => ({ label: r.label, met: r.test(password) })),
    [password],
  );
  const metCount = requirementResults.filter((r) => r.met).length;
  const strength = password ? metCount / PASSWORD_REQUIREMENTS.length : 0;
  const strengthLabel =
    strength === 1 ? 'Strong' : strength >= 0.6 ? 'Fair' : password ? 'Weak' : '';
  const strengthColor =
    strength === 1 ? 'bg-trend-up' : strength >= 0.6 ? 'bg-primary-blue' : 'bg-trend-down';

  const confirmMismatch = confirmTouched && confirmPassword !== password;

  const validate = (): boolean => {
    const errors: FieldErrors = {};
    if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
    if (!acceptTerms) errors.terms = 'You must accept the terms to continue.';
    setFieldErrors(errors);
    setConfirmTouched(true);
    return Object.keys(errors).length === 0 && confirmPassword === password;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const result = await register(email.trim(), password);
      if (result.verificationRequired) {
        setStep('verify-email');
      } else {
        navigate(next, { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setFieldErrors((prev) => ({
          ...prev,
          email: 'An account with this email already exists.',
        }));
      } else {
        setFormError(friendlyError(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'verify-email') {
    return (
      <div className="relative min-h-screen flex items-center justify-center p-6 bg-dark-bg">
        <div className="relative z-10 w-full max-w-md rounded-2xl border border-dark-border bg-dark-surface backdrop-blur-xl p-10 text-center shadow-elev-3">
          <div className="mx-auto mb-6 w-12 h-12 rounded-xl flex items-center justify-center shadow-glow-blue bg-gradient-to-br from-primary-blue to-primary-teal">
            <Check className="w-6 h-6 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Check your email</h2>
          <p className="text-sm text-gray-subtext mb-6">
            We sent a verification link to <span className="text-white">{email}</span>. Confirm it
            to finish setting up your account.
          </p>
          <Link to="/login" className="text-primary-blue text-sm hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

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

        <h2 className="text-xl font-bold text-white mb-1">Create your workspace</h2>
        <p className="text-sm text-gray-subtext mb-8">
          Start managing every channel from one AI-powered cockpit.
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
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-3 text-sm text-white focus:outline-none focus:border-primary-blue/50 transition-all"
              placeholder="••••••••"
            />

            {password && (
              <div className="mt-3 space-y-2">
                <div className="h-1.5 w-full rounded-full bg-dark-border overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${strengthColor}`}
                    style={{ width: `${strength * 100}%` }}
                  />
                </div>
                {strengthLabel && (
                  <p className="text-xs text-gray-subtext">{strengthLabel} password</p>
                )}
                <ul className="space-y-1">
                  {requirementResults.map((r) => (
                    <li
                      key={r.label}
                      className={`flex items-center gap-1.5 text-xs ${r.met ? 'text-trend-up' : 'text-gray-subtext'}`}
                    >
                      {r.met ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                      {r.label}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {fieldErrors.password && (
              <p className="mt-1 text-xs text-trend-down">{fieldErrors.password}</p>
            )}
          </label>

          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
              Confirm password
            </span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onBlur={() => setConfirmTouched(true)}
              className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-3 text-sm text-white focus:outline-none focus:border-primary-blue/50 transition-all"
              placeholder="••••••••"
            />
            {confirmMismatch && (
              <p className="mt-1 text-xs text-trend-down">Passwords do not match.</p>
            )}
          </label>

          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={acceptTerms}
              onChange={(e) => setAcceptTerms(e.target.checked)}
              className="mt-0.5 rounded border-dark-border bg-dark-bg/60 text-primary-blue focus:ring-primary-blue/50"
            />
            <span className="text-xs text-gray-subtext">
              I agree to the Terms of Service and Privacy Policy.
            </span>
          </label>
          {fieldErrors.terms && <p className="text-xs text-trend-down">{fieldErrors.terms}</p>}

          {formError && <p className="text-sm text-trend-down">{formError}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-primary-rose to-primary-blue text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <UserPlus className="w-4 h-4" />
            )}
            Create account
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-subtext">
          Already have an account?{' '}
          <Link to="/login" className="text-primary-blue hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
};

export default RegisterPage;
