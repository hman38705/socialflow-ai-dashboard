import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

// === Component

/** 403 page. Shown when the user is authenticated but lacks access to a resource. */
export const ForbiddenPage: React.FC = () => {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-2xl border border-primary-rose/25 bg-primary-rose/5 px-6 py-12 text-center"
    >
      <ShieldAlert className="h-10 w-10 text-primary-rose" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-white/90">Access denied</p>
        <p className="max-w-sm text-xs text-gray-subtext">
          You do not have permission to view this page. Ask an organization owner for access.
        </p>
      </div>
      <div className="mt-1 flex items-center gap-3 text-sm">
        <Link
          to="/"
          className="rounded-xl bg-primary-rose/15 px-4 py-2 font-semibold text-primary-rose hover:bg-primary-rose/25"
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

export default ForbiddenPage;
