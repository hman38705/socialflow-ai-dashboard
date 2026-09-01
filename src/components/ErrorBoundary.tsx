import React from 'react';
import { useLocation } from 'react-router-dom';
import { captureError } from '../lib/telemetry';

/**
 * Application ErrorBoundary (FE-008).
 *
 * Catches render errors below it and shows a fallback card instead of a
 * blank screen. Forwards to the FE-125 telemetry sink, which is a no-op
 * when unconfigured (no DSN), so this never adds console noise or network
 * calls in an environment without telemetry set up.
 */

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
  correlationId: string;
}

function generateCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `err-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null, correlationId: '' };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error, correlationId: generateCorrelationId() };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ componentStack: errorInfo.componentStack ?? null });
    captureError(error, {
      correlationId: this.state.correlationId,
      componentStack: errorInfo.componentStack,
    });
  }

  handleReset = (): void => {
    this.setState({ error: null, componentStack: null, correlationId: '' });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    const { error, componentStack, correlationId } = this.state;
    if (!error) {
      return this.props.children;
    }

    const isDev = import.meta.env.DEV;

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-dark-bg">
        <div className="relative z-10 w-full max-w-lg rounded-2xl border border-dark-border bg-dark-surface backdrop-blur-xl p-10 text-center shadow-elev-3">
          <h1 className="text-xl font-bold text-white mb-2">Something went wrong</h1>
          <p className="text-sm text-gray-subtext mb-6">{error.message}</p>

          {isDev && componentStack && (
            <pre className="mb-6 max-h-64 overflow-auto rounded-xl bg-black/40 p-4 text-left text-xs text-trend-down">
              {componentStack}
            </pre>
          )}
          {!isDev && (
            <p className="mb-6 text-xs text-gray-subtext">
              Correlation ID: <span className="font-mono">{correlationId}</span>
            </p>
          )}

          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={this.handleReset}
              className="py-3 px-6 rounded-xl bg-gradient-to-r from-primary-rose to-primary-blue text-white text-sm font-semibold transition-opacity"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="py-3 px-6 rounded-xl border border-dark-border text-white text-sm font-semibold hover:bg-white/5 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * Route-aware wrapper: remounts the boundary (via `key={location.key}`)
 * whenever the route changes, so a caught error resets automatically on
 * navigation instead of requiring a manual "Try again" click.
 */
export function RouteErrorBoundary({ children }: { children: React.ReactNode }): React.JSX.Element {
  const location = useLocation();
  return <ErrorBoundary key={location.key}>{children}</ErrorBoundary>;
}
