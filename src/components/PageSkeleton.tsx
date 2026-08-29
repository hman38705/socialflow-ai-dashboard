import React from 'react';

/** Full-page loading fallback shown behind the single top-level Suspense
 * boundary while a lazy-loaded page module downloads (FE-003). */
export function PageSkeleton(): React.JSX.Element {
  return (
    <div className="min-h-screen p-6 bg-dark-bg animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-48 rounded-lg bg-dark-surface mb-6" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="h-24 rounded-2xl bg-dark-surface" />
        <div className="h-24 rounded-2xl bg-dark-surface" />
        <div className="h-24 rounded-2xl bg-dark-surface" />
      </div>
      <div className="h-64 rounded-2xl bg-dark-surface" />
    </div>
  );
}

export default PageSkeleton;
