import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { OpenAPI } from '../api/core/OpenAPI';
import { request as __request } from '../api/core/request';
import type { AuthTokens } from '../api/models/AuthTokens';
import { verifyState } from '../auth/oauthState';

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

// Same storage keys AuthContext uses, so a successful callback leaves the
// app in an authenticated state without needing its own parallel auth store.
const TOKEN_KEY = 'sf_auth_token';
const REFRESH_TOKEN_KEY = 'sf_auth_refresh_token';

type CallbackState = 'exchanging' | 'error';

async function exchangeCode(code: string): Promise<AuthTokens> {
  return __request<AuthTokens>(OpenAPI, {
    method: 'POST',
    url: '/auth/oauth/callback',
    body: { code },
    mediaType: 'application/json',
  });
}

export const AuthCallbackPage: React.FC = () => {
  const navigate = useNavigate();
  const [state, setState] = useState<CallbackState>('exchanging');
  const [errorMessage, setErrorMessage] = useState('Something went wrong finishing sign-in.');
  // Guards against React 18/19 StrictMode's double-invoked effect consuming
  // the (single-use) stored oauth state twice.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const returnedState = params.get('state');
    const providerError = params.get('error');
    const providerErrorDescription = params.get('error_description');

    // Strip code/state/error params from the URL and history immediately —
    // they must not linger in the address bar, browser history, or get
    // re-read if this effect ever ran a second time.
    window.history.replaceState(null, '', window.location.pathname);

    if (providerError) {
      setErrorMessage(providerErrorDescription || `Sign-in was cancelled (${providerError}).`);
      setState('error');
      return;
    }

    // Verify before doing anything else — a mismatched or missing state
    // must abort the flow and never reach the token exchange.
    if (!verifyState(returnedState)) {
      setErrorMessage('This sign-in link could not be verified. Please try again.');
      setState('error');
      return;
    }

    if (!code) {
      setErrorMessage('No authorization code was returned.');
      setState('error');
      return;
    }

    exchangeCode(code)
      .then((tokens) => {
        localStorage.setItem(TOKEN_KEY, tokens.accessToken);
        localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
        navigate('/', { replace: true });
      })
      .catch(() => {
        setErrorMessage('We could not complete sign-in with your provider. Please try again.');
        setState('error');
      });
  }, [navigate]);

  return (
    <div className="relative min-h-screen flex items-center justify-center p-6 bg-dark-bg overflow-hidden">
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-dark-border bg-dark-surface backdrop-blur-xl p-10 shadow-elev-3 text-center">
        {state === 'exchanging' && (
          <div data-testid="auth-callback-exchanging" className="flex flex-col items-center gap-3">
            <MaterialIcon name="progress_activity" className="animate-spin text-3xl text-primary-blue" />
            <p className="text-sm text-gray-subtext">Finishing sign-in…</p>
          </div>
        )}

        {state === 'error' && (
          <div data-testid="auth-callback-error" className="space-y-4">
            <div className="flex items-center justify-center gap-2 text-primary-rose">
              <MaterialIcon name="error" className="text-2xl" />
              <h2 className="text-lg font-bold text-white">Sign-in failed</h2>
            </div>
            <p role="alert" className="text-sm text-gray-subtext leading-relaxed">
              {errorMessage}
            </p>
            <Link
              to="/login"
              className="inline-flex items-center gap-2 w-full justify-center py-3 rounded-xl bg-primary-blue text-white text-sm font-bold hover:bg-primary-blue/90 transition-all"
            >
              <MaterialIcon name="refresh" className="text-lg" />
              Try again
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};

export default AuthCallbackPage;
