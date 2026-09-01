import React, { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { trackEvent } from '../lib/telemetry';

// === Component

/**
 * 404 page. Logs a single `route.not_found` telemetry event for the unknown path,
 * guarded so re-renders (theme changes, parent updates) do not re-fire it.
 */
export const NotFoundPage: React.FC = () => {
  const { pathname } = useLocation();
  const logged = useRef<string | null>(null);

  useEffect(() => {
    if (logged.current === pathname) return;
    logged.current = pathname;
    trackEvent('route.not_found', { path: pathname });
  }, [pathname]);

  return (
    <div
      role="status"
      className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-dark-border bg-white/[0.02] px-6 py-12 text-center"
    >
      <Compass className="h-10 w-10 text-gray-subtext" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-white/90">Page not found</p>
        <p className="max-w-sm text-xs text-gray-subtext">
          The page you are looking for does not exist or has moved.
        </p>
      </div>
      <div className="mt-1 flex items-center gap-3 text-sm">
        <Link
          to="/"
          className="rounded-xl bg-primary-blue/15 px-4 py-2 font-semibold text-primary-blue hover:bg-primary-blue/25"
        >
          Back to dashboard
        </Link>
        <a href="mailto:support@socialflow.ai" className="text-gray-subtext hover:text-white">
          Contact support
        </a>
      </div>
    </div>
  );
};

export default NotFoundPage;
