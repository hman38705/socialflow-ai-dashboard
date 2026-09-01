import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

// === Component

/**
 * App shell for the authenticated area. Two-column CSS grid (fixed sidebar + fluid
 * content) that collapses to a single column below `md`, where the sidebar becomes an
 * overlay drawer. The `<main>` region is the only vertical scroller.
 *
 * Renders `<Outlet />`, so it is used as a React Router layout route.
 */
export const DashboardLayout: React.FC = () => {
  const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);

  return (
    <div className="grid h-screen grid-cols-1 bg-dark-bg md:grid-cols-[auto_1fr]">
      <a
        href="#main"
        className="sr-only rounded-lg bg-primary-blue px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        Skip to content
      </a>

      <Sidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />

      <div className="flex min-w-0 flex-col overflow-hidden">
        <Topbar onOpenMobileNav={() => setMobileNavOpen(true)} />
        <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto p-6 outline-none">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
