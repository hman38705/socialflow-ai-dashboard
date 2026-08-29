/**
 * FE-048 — Session-expiry warning modal
 *
 * Acceptance criteria:
 *  AC-1  Appears at T-2 minutes: "Stay signed in" or "Sign out now", with a
 *        live countdown.
 *  AC-2  Suppressed while a refresh is already in-flight or the tab is hidden.
 *  AC-3  Auto-logout at expiry preserves unsaved composer content as a draft.
 *  AC-4  Countdown is aria-live="polite" and updates at most once per second.
 *
 * Draft preservation (AC-3 / FE-066):
 *  The modal reads the value of any textarea with data-composer="true" and
 *  persists it to sessionStorage under the key "composer:draft" before
 *  calling logout().
 *
 * Visibility suppression (AC-2):
 *  The modal is not shown when document.visibilityState === "hidden" or when
 *  a refresh is already in-flight (detected via the refreshInFlight prop).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { logout, refreshTokens } from '../../auth/refresh';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How many seconds before expiry to show the modal. */
export const WARN_BEFORE_EXPIRY_S = 120; // 2 minutes

/** Key used to persist unsaved composer content before auto-logout. */
export const COMPOSER_DRAFT_KEY = 'composer:draft';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionExpiryModalProps {
  /**
   * Seconds remaining on the access token.  The parent is responsible for
   * computing this from the token's exp claim and passing it down.
   * When undefined or > WARN_BEFORE_EXPIRY_S the modal is not shown.
   */
  secondsRemaining: number | undefined;
  /**
   * Pass true while a token refresh is already in-flight so the modal
   * suppresses itself (AC-2).
   */
  refreshInFlight?: boolean;
  /**
   * Callback fired when the user clicks "Stay signed in".  If omitted the
   * modal calls refreshTokens() internally.
   */
  onStaySignedIn?: () => void | Promise<void>;
  /**
   * Callback fired after the session has been logged out (either by user
   * action or auto-expiry).  Useful for routing to /login from the parent.
   */
  onLoggedOut?: () => void;
}

// ---------------------------------------------------------------------------
// Draft preservation helper
// ---------------------------------------------------------------------------

/**
 * Reads the current value of the first textarea with data-composer="true"
 * and persists it to sessionStorage so the user can recover it on next login.
 */
export function saveDraft(): void {
  const composer = document.querySelector<HTMLTextAreaElement>('textarea[data-composer="true"]');
  if (composer && composer.value.trim()) {
    try {
      sessionStorage.setItem(COMPOSER_DRAFT_KEY, composer.value);
    } catch {
      // sessionStorage may be unavailable (private mode quota, etc.) — ignore
    }
  }
}

/**
 * Retrieve a previously saved draft (call on composer mount after login).
 */
export function loadDraft(): string | null {
  try {
    return sessionStorage.getItem(COMPOSER_DRAFT_KEY);
  } catch {
    return null;
  }
}

/**
 * Clear the saved draft (call after it has been restored to the composer).
 */
export function clearDraft(): void {
  try {
    sessionStorage.removeItem(COMPOSER_DRAFT_KEY);
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const SessionExpiryModal: React.FC<SessionExpiryModalProps> = ({
  secondsRemaining,
  refreshInFlight = false,
  onStaySignedIn,
  onLoggedOut,
}) => {
  // Internal countdown derived from the prop — counts down once per second.
  const [countdown, setCountdown] = useState<number>(secondsRemaining ?? WARN_BEFORE_EXPIRY_S);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoLogoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep mutable refs for callback props so we don't re-run effects on each render.
  const onLoggedOutRef = useRef(onLoggedOut);
  const onStaySignedInRef = useRef(onStaySignedIn);
  useEffect(() => {
    onLoggedOutRef.current = onLoggedOut;
  }, [onLoggedOut]);
  useEffect(() => {
    onStaySignedInRef.current = onStaySignedIn;
  }, [onStaySignedIn]);

  // Sync countdown to new prop values (e.g. parent refreshes secondsRemaining).
  useEffect(() => {
    if (secondsRemaining !== undefined) {
      setCountdown(secondsRemaining);
    }
  }, [secondsRemaining]);

  // Determine whether the modal should be visible.
  const tabVisible = typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true;

  const shouldShow =
    secondsRemaining !== undefined &&
    secondsRemaining <= WARN_BEFORE_EXPIRY_S &&
    secondsRemaining >= 0 &&
    !refreshInFlight &&
    tabVisible;

  // ---------------------------------------------------------------------------
  // Stable auto-logout callback (uses refs so effects don't need to list it)
  // ---------------------------------------------------------------------------

  const isLoggingOutRef = useRef(false);

  const doLogout = useCallback(async () => {
    if (isLoggingOutRef.current) return;
    isLoggingOutRef.current = true;
    setIsLoggingOut(true);

    // AC-3: persist unsaved composer draft before logging out.
    saveDraft();

    try {
      await logout('session-expired');
    } finally {
      onLoggedOutRef.current?.();
    }
  }, []); // stable — no deps (uses refs internally)

  // ---------------------------------------------------------------------------
  // Countdown tick (AC-4: at most once per second)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!shouldShow) {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return undefined;
    }

    intervalRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          intervalRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1_000);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [shouldShow]); // intentional: only re-run when modal visibility changes

  // ---------------------------------------------------------------------------
  // Auto-logout when countdown reaches zero
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!shouldShow || countdown > 0) return;
    doLogout();
  }, [countdown, shouldShow, doLogout]);

  // ---------------------------------------------------------------------------
  // Auto-logout timer (fallback: fires exactly when secondsRemaining elapses)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!shouldShow || secondsRemaining === undefined) return undefined;

    if (autoLogoutTimerRef.current !== null) {
      clearTimeout(autoLogoutTimerRef.current);
    }

    autoLogoutTimerRef.current = setTimeout(() => {
      autoLogoutTimerRef.current = null;
      doLogout();
    }, secondsRemaining * 1_000);

    return () => {
      if (autoLogoutTimerRef.current !== null) {
        clearTimeout(autoLogoutTimerRef.current);
        autoLogoutTimerRef.current = null;
      }
    };
  }, [shouldShow, secondsRemaining, doLogout]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleStaySignedIn = useCallback(async () => {
    if (autoLogoutTimerRef.current !== null) {
      clearTimeout(autoLogoutTimerRef.current);
      autoLogoutTimerRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    try {
      const handler = onStaySignedInRef.current;
      if (handler) {
        await handler();
      } else {
        await refreshTokens();
      }
    } catch {
      // Refresh failed — refresh.ts handles logout/navigation.
    }
  }, []);

  const handleSignOutNow = useCallback(async () => {
    if (autoLogoutTimerRef.current !== null) {
      clearTimeout(autoLogoutTimerRef.current);
      autoLogoutTimerRef.current = null;
    }
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    saveDraft();

    try {
      await logout();
    } finally {
      onLoggedOutRef.current?.();
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Render — nothing when suppressed
  // ---------------------------------------------------------------------------

  if (!shouldShow) return null;

  const minutes = Math.floor(countdown / 60);
  const seconds = countdown % 60;
  const timeLabel = minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}s`;

  return (
    /* Backdrop */
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-expiry-title"
      aria-describedby="session-expiry-desc"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
      }}
    >
      {/* Modal panel */}
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: '2rem',
          maxWidth: 400,
          width: '90%',
          boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        }}
      >
        <h2 id="session-expiry-title" style={{ marginTop: 0 }}>
          Your session is about to expire
        </h2>

        <p id="session-expiry-desc">You will be automatically signed out in:</p>

        {/* AC-4: aria-live="polite", updates at most once per second */}
        <p
          aria-live="polite"
          aria-atomic="true"
          data-testid="session-expiry-countdown"
          style={{
            fontSize: '2rem',
            fontWeight: 'bold',
            textAlign: 'center',
            margin: '1rem 0',
          }}
        >
          {timeLabel}
        </p>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
          <button
            type="button"
            data-testid="session-expiry-sign-out"
            onClick={handleSignOutNow}
            disabled={isLoggingOut}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: 4,
              border: '1px solid #ccc',
              background: '#fff',
              cursor: isLoggingOut ? 'not-allowed' : 'pointer',
            }}
          >
            Sign out now
          </button>

          <button
            type="button"
            data-testid="session-expiry-stay"
            onClick={handleStaySignedIn}
            disabled={isLoggingOut}
            style={{
              padding: '0.5rem 1rem',
              borderRadius: 4,
              border: 'none',
              background: '#0070f3',
              color: '#fff',
              cursor: isLoggingOut ? 'not-allowed' : 'pointer',
            }}
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
};

export default SessionExpiryModal;
