import React from 'react';
import { Link } from 'react-router-dom';

export function NotFoundPage(): React.JSX.Element {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-dark-bg">
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-dark-border bg-dark-surface backdrop-blur-xl p-10 text-center shadow-elev-3">
        <h1 className="text-3xl font-bold text-white mb-2">404</h1>
        <p className="text-sm text-gray-subtext mb-6">This page doesn&apos;t exist.</p>
        <Link
          to="/analytics"
          className="inline-block py-3 px-6 rounded-xl bg-gradient-to-r from-primary-rose to-primary-blue text-white text-sm font-semibold"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}

export default NotFoundPage;
