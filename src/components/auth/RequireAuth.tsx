import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { LoadingScreen } from '../ui/Spinner';

// === Open-redirect guard

/**
 * Sanitize a `next` value taken from the URL. Only a same-origin, relative path is allowed
 * back through; absolute URLs, protocol-relative (`//host`), and backslash tricks fall back
 * to `/`.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw) return '/';
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return '/';
  }
  if (!value.startsWith('/')) return '/';
  // `//evil.tld` and `/\evil.tld` are treated as network-path references by browsers.
  if (value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (/^\/[^/]*:/.test(value)) return '/';
  return value;
}

// === Fallback 403 (FE-041's ForbiddenPage is on another branch)

const InlineForbidden: React.FC = () => (
  <div
    role="alert"
    className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-primary-rose/25 bg-primary-rose/5 px-6 py-12 text-center"
  >
    <ShieldAlert className="h-10 w-10 text-primary-rose" aria-hidden="true" />
    <p className="text-sm font-semibold text-white/90">Access denied</p>
    <p className="max-w-sm text-xs text-gray-subtext">
      You are signed in but do not have permission to view this page.
    </p>
  </div>
);

// === Component

interface RequireAuthProps {
  /** Route content. Falls back to `<Outlet />` for use as a layout route. */
  children?: React.ReactNode;
  /** When set, the signed-in user must hold at least one of these roles. */
  roles?: string[];
  /** Rendered instead of the built-in 403 when a `roles` check fails. */
  forbiddenFallback?: React.ReactNode;
}

export const RequireAuth: React.FC<RequireAuthProps> = ({ children, roles, forbiddenFallback }) => {
  const { status, user } = useAuth();
  const location = useLocation();

  // Still resolving the session: hold on the loading screen so a refresh never flashes the
  // login page for a user who is in fact authenticated.
  if (status === 'idle' || status === 'loading') {
    return <LoadingScreen />;
  }

  if (status !== 'authenticated' || !user) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  if (roles && roles.length > 0) {
    // `AuthUser` has no `roles` field yet; read it defensively for when it does.
    const userRoles = (user as { roles?: string[] }).roles ?? [];
    const authorized = roles.some((role) => userRoles.includes(role));
    if (!authorized) {
      return <>{forbiddenFallback ?? <InlineForbidden />}</>;
    }
  }

  return <>{children ?? <Outlet />}</>;
};

export default RequireAuth;
