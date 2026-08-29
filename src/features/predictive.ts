import * as React from 'react';
import { isFeatureEnabled } from '../config/env';

/**
 * Predictive Feature Flag and Graceful Absence Handling
 * FE-098
 *
 * Acceptance criteria:
 * - A VITE_FEATURE_PREDICTIVE flag gates the widget, page, dashboard, and the sidebar entry.
 * - Disabled means no imports are pulled into the initial bundle (lazy-loaded behind the flag).
 * - A 404/501 from the predictive endpoints auto-disables the feature for the session and logs once.
 * - With the feature off, the composer layout has no empty gap where the panel used to be.
 */

const SESSION_STORAGE_KEY = 'sf_feature_predictive_session_disabled';
let hasLoggedAbsence = false;
let sessionDisabledInMemory = false;

/**
 * Check if the predictive feature is currently enabled for this session.
 * Takes into account both the build/env feature flag and runtime 404/501 auto-disablement.
 */
export function isPredictiveEnabled(): boolean {
  if (sessionDisabledInMemory) {
    return false;
  }

  if (typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
    try {
      if (window.sessionStorage.getItem(SESSION_STORAGE_KEY) === 'true') {
        sessionDisabledInMemory = true;
        return false;
      }
    } catch {
      // Ignore sessionStorage access errors
    }
  }

  return isFeatureEnabled('VITE_FEATURE_PREDICTIVE');
}

/**
 * Auto-disable the predictive feature for the remainder of the session.
 * Logs a single warning message on first disablement.
 */
export function disablePredictiveForSession(statusOrReason?: number | string): void {
  sessionDisabledInMemory = true;

  if (typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
    try {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, 'true');
    } catch {
      // Ignore sessionStorage access errors
    }
  }

  if (!hasLoggedAbsence) {
    hasLoggedAbsence = true;
    const reasonText = statusOrReason ? ` (received ${statusOrReason})` : '';
    console.warn(
      `[Predictive Feature] Predictive endpoint returned 404/501 or is absent${reasonText}. Feature automatically disabled for this session.`,
    );
  }
}

/**
 * Handles API errors from predictive calls.
 * If status code is 404 or 501, automatically disables the predictive feature for the session.
 * Returns true if error triggered auto-disablement, false otherwise.
 */
export function handlePredictiveApiError(error: unknown): boolean {
  const errObj = error as
    | {
        status?: number;
        statusCode?: number;
        response?: { status?: number };
        status_code?: number;
      }
    | null
    | undefined;

  const status =
    errObj?.status ?? errObj?.statusCode ?? errObj?.response?.status ?? errObj?.status_code;

  if (status === 404 || status === 501) {
    disablePredictiveForSession(status);
    return true;
  }

  return false;
}

/**
 * Reset session disabled state (primarily for testing and debug resets).
 */
export function resetPredictiveSession(): void {
  sessionDisabledInMemory = false;
  hasLoggedAbsence = false;
  if (typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined') {
    try {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore sessionStorage errors
    }
  }
}

/**
 * Hook to reactively observe predictive feature availability in React components.
 */
export function usePredictiveFeature() {
  const [enabled, setEnabled] = React.useState<boolean>(() => isPredictiveEnabled());

  React.useEffect(() => {
    setEnabled(isPredictiveEnabled());
  }, []);

  const disable = (reason?: number | string) => {
    disablePredictiveForSession(reason);
    setEnabled(false);
  };

  return {
    isEnabled: enabled,
    disableForSession: disable,
  };
}

/**
 * Lazy loaded component helper.
 * Ensures predictive components are dynamically imported ONLY if the feature is enabled,
 * avoiding pulling them into the initial bundle when disabled.
 */
export function lazyLoadPredictive<P extends object>(
  factory: () => Promise<
    { default: React.ComponentType<P> } | Record<string, React.ComponentType<P>>
  >,
  namedExport?: string,
): React.LazyExoticComponent<React.ComponentType<P>> {
  return React.lazy(async () => {
    if (!isPredictiveEnabled()) {
      return { default: (() => null) as React.ComponentType<P> };
    }
    const module = await factory();
    if (namedExport && (module as Record<string, React.ComponentType<P>>)[namedExport]) {
      return { default: (module as Record<string, React.ComponentType<P>>)[namedExport] };
    }
    if ('default' in module) {
      return module as { default: React.ComponentType<P> };
    }
    const firstExport = Object.values(module)[0] as React.ComponentType<P>;
    return { default: firstExport };
  });
}

/**
 * Helper to filter navigation / sidebar menu items.
 * Removes any item designated for the predictive feature when disabled.
 */
export function filterPredictiveNavItems<
  T extends { path?: string; id?: string; key?: string; feature?: string; label?: string },
>(items: T[]): T[] {
  if (isPredictiveEnabled()) {
    return items;
  }
  return items.filter((item) => {
    const isPredictive =
      item.feature === 'predictive' ||
      item.id === 'predictor' ||
      item.id === 'predictive' ||
      item.path === '/predictor' ||
      item.path === '/predictive' ||
      item.label === 'AI Predictor';
    return !isPredictive;
  });
}

/**
 * Slot wrapper component for composer layout.
 * Ensures that if predictive feature is disabled, nothing (no wrapper, no empty gap) is rendered.
 */
export const PredictiveComposerSlot: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
  className?: string;
}> = ({ children, fallback = null, className }) => {
  if (!isPredictiveEnabled()) {
    return fallback ? React.createElement(React.Fragment, null, fallback) : null;
  }
  return className
    ? React.createElement('div', { className }, children)
    : React.createElement(React.Fragment, null, children);
};
