import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { OpenAPI } from '../api/core/OpenAPI';
import { request as __request } from '../api/core/request';

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

/**
 * Always resolves — never lets the caller distinguish "email exists" from
 * "email doesn't exist" via status code, timing, or body shape. The backend
 * is expected to return an identical 202/200 response either way; even if it
 * doesn't (yet), we intentionally collapse every outcome except a genuine
 * client-side validation failure into the same generic success state.
 */
async function requestPasswordReset(email: string): Promise<void> {
  try {
    await __request(OpenAPI, {
      method: 'POST',
      url: '/auth/forgot-password',
      body: { email },
      mediaType: 'application/json',
    });
  } catch {
    // Swallow the error — the UI must not reveal whether it was a 404
    // (unknown email), a validation error, or a network hiccup. If the
    // address was genuinely malformed, the user can just try again.
  }
}

export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^\S+@\S+\.\S+$/.test(trimmed)) {
      setValidationError('Enter a valid email address.');
      return;
    }
    setValidationError(null);
    setIsSubmitting(true);
    await requestPasswordReset(trimmed);
    setIsSubmitting(false);
    // Always land on the same success state, regardless of whether the
    // account exists — this is what prevents account enumeration.
    setSubmitted(true);
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

        {submitted ? (
          <div data-testid="forgot-password-success" className="space-y-4">
            <div className="flex items-center gap-2 text-trend-up">
              <MaterialIcon name="mark_email_read" className="text-2xl" />
              <h2 className="text-lg font-bold text-white">Check your email</h2>
            </div>
            <p className="text-sm text-gray-subtext leading-relaxed">
              If an account exists for <span className="text-white">{email.trim()}</span>, we've
              sent a link to reset your password. It expires shortly, so use it soon.
            </p>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 text-sm font-semibold text-primary-blue hover:text-primary-blue/80 transition-colors"
            >
              <MaterialIcon name="arrow_back" className="text-base" />
              Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-bold text-white mb-1">Forgot your password?</h2>
            <p className="text-sm text-gray-subtext mb-8">
              Enter the email on your account and we'll send you a reset link.
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
                  Email
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-3 text-sm text-white focus:outline-none focus:border-primary-blue/50 transition-all"
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </label>

              {validationError && (
                <p role="alert" className="text-sm text-primary-rose">
                  {validationError}
                </p>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 rounded-xl bg-primary-blue text-white text-sm font-bold flex items-center justify-center gap-2 hover:bg-primary-blue/90 disabled:opacity-60 transition-all"
              >
                {isSubmitting ? (
                  <MaterialIcon name="progress_activity" className="animate-spin text-lg" />
                ) : (
                  <MaterialIcon name="send" className="text-lg" />
                )}
                Send reset link
              </button>

              <Link
                to="/login"
                className="block text-center text-sm font-semibold text-gray-subtext hover:text-white transition-colors"
              >
                Back to sign in
              </Link>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
