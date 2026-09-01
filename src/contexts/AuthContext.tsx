import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AuthService } from '../api/services/AuthService';
import { ApiError } from '../api/core/ApiError';
import { OpenAPI } from '../api/core/OpenAPI';
import type { AuthTokens } from '../api/models/AuthTokens';
import type { Credentials } from '../api/models/Credentials';
import { useToast } from './ToastContext';

// The refresh token has to survive a page reload for silent-refresh-on-mount to
// work, but must never land in localStorage — sessionStorage is the compromise.
// The access token is never persisted at all; it only ever lives in a ref.
export const REFRESH_TOKEN_KEY = 'sf_refresh_token';
export const EMAIL_KEY = 'sf_user_email';
export const AUTH_LOGOUT_EVENT = 'auth:logout';

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthUser {
  id: string;
  email: string;
}

export interface LoginResult {
  twoFactorRequired: boolean;
}

export interface RegisterResult {
  verificationRequired: boolean;
}

// The generated `AuthTokens` model only covers the happy path. The backend may
// also 200 with a two-factor challenge (login) or a verification flag
// (register) that the OpenAPI spec doesn't model yet, so these widen it locally.
type LoginResponse = Partial<AuthTokens> & { twoFactorRequired?: boolean };
type RegisterResponse = Partial<AuthTokens> & { verificationRequired?: boolean };

interface AuthState {
  user: AuthUser | null;
  status: AuthStatus;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<LoginResult>;
  register: (email: string, password: string) => Promise<RegisterResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<boolean>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  completeTwoFactor: (code: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeUserId(accessToken: string): string {
  try {
    const [, payload] = accessToken.split('.');
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const claims = JSON.parse(json) as { sub?: string };
    return claims.sub ?? '';
  } catch {
    return '';
  }
}

function extractMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError && typeof err.body?.message === 'string'
    ? err.body.message
    : fallback;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { showToast } = useToast();
  const [state, setState] = useState<AuthState>({ user: null, status: 'loading', error: null });
  const pendingRef = useRef<{ email: string; password: string } | null>(null);

  useEffect(() => {
    // FE-046: wire OpenAPI.TOKEN to the in-memory tokenStore — the token is
    // never read from localStorage/sessionStorage here.
    OpenAPI.TOKEN = async () => getToken()?.token ?? '';
  }, []);

  const applySession = useCallback((tokens: AuthTokens, email: string) => {
    setToken(tokens.accessToken);
    sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    sessionStorage.setItem(EMAIL_KEY, email);
    pendingRef.current = null;
    setState({
      user: { id: decodeUserId(tokens.accessToken), email },
      status: 'authenticated',
      error: null,
    });
  }, []);

  const clearSession = useCallback(() => {
    clearToken();
    pendingRef.current = null;
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
    sessionStorage.removeItem(EMAIL_KEY);
    window.dispatchEvent(new CustomEvent(AUTH_LOGOUT_EVENT));
  }, []);

  const refresh = useCallback(async (): Promise<boolean> => {
    const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY);
    const email = sessionStorage.getItem(EMAIL_KEY) ?? '';
    if (!refreshToken) {
      clearSession();
      setState({ user: null, status: 'unauthenticated', error: null });
      return false;
    }
    try {
      const tokens = await AuthService.postAuthRefresh({ requestBody: { refreshToken } });
      applySession(tokens, email);
      return true;
    } catch {
      clearSession();
      setState({ user: null, status: 'unauthenticated', error: null });
      return false;
    }
  }, [applySession, clearSession]);

  useEffect(() => {
    // Attempt a silent refresh once on mount so a page reload keeps the session;
    // `status` stays 'loading' until this resolves either way.
    refresh();
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      setState((s) => ({ ...s, status: 'loading', error: null }));
      try {
        const response = (await AuthService.postAuthLogin({
          requestBody: { email, password },
        })) as LoginResponse;

        if (response.twoFactorRequired || !response.accessToken || !response.refreshToken) {
          pendingRef.current = { email, password };
          setState({ user: null, status: 'unauthenticated', error: null });
          return { twoFactorRequired: true };
        }

        applySession(response as AuthTokens, email);
        return { twoFactorRequired: false };
      } catch (err) {
        const message = extractMessage(err, 'Unable to sign in right now.');
        setState({ user: null, status: 'unauthenticated', error: message });
        showToast(message, 'error');
        throw err;
      }
    },
    [applySession, showToast],
  );

  const completeTwoFactor = useCallback(
    async (code: string): Promise<void> => {
      const pending = pendingRef.current;
      if (!pending) {
        throw new Error('No two-factor challenge is in progress.');
      }
      setState((s) => ({ ...s, status: 'loading', error: null }));
      try {
        const requestBody = { ...pending, twoFactorCode: code } as Credentials;
        const tokens = await AuthService.postAuthLogin({ requestBody });
        applySession(tokens, pending.email);
      } catch (err) {
        const message = extractMessage(err, 'That code was not accepted.');
        setState((s) => ({ ...s, status: 'unauthenticated', error: message }));
        showToast(message, 'error');
        throw err;
      }
    },
    [applySession, showToast],
  );

  const register = useCallback(
    async (email: string, password: string): Promise<RegisterResult> => {
      setState((s) => ({ ...s, status: 'loading', error: null }));
      try {
        const response = (await AuthService.postAuthRegister({
          requestBody: { email, password },
        })) as RegisterResponse;

        if (response.verificationRequired || !response.accessToken || !response.refreshToken) {
          setState({ user: null, status: 'unauthenticated', error: null });
          return { verificationRequired: true };
        }

        applySession(response as AuthTokens, email);
        return { verificationRequired: false };
      } catch (err) {
        const message = extractMessage(err, 'Unable to create your account right now.');
        setState({ user: null, status: 'unauthenticated', error: message });
        throw err;
      }
    },
    [applySession],
  );

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY);
    try {
      if (refreshToken) {
        await AuthService.postAuthLogout({ requestBody: { refreshToken } });
      }
    } catch {
      // Tokens are cleared below regardless of whether the server call succeeded.
    } finally {
      clearSession();
      setState({ user: null, status: 'unauthenticated', error: null });
    }
  }, [clearSession]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<void> => {
      try {
        await AuthService.postAuthChangePassword({ requestBody: { currentPassword, newPassword } });
        // The backend revokes all refresh tokens and blacklists the current
        // access token on a password change, so the session must end here too.
        clearSession();
        setState({ user: null, status: 'unauthenticated', error: null });
      } catch (err) {
        const message = extractMessage(err, 'Unable to change your password right now.');
        setState((s) => ({ ...s, error: message }));
        showToast(message, 'error');
        throw err;
      }
    },
    [clearSession, showToast],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, login, register, logout, refresh, changePassword, completeTwoFactor }),
    [state, login, register, logout, refresh, changePassword, completeTwoFactor],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
