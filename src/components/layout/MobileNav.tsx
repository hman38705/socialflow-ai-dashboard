import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { BarChart3, CalendarClock, Menu, Settings, Sparkles, X } from 'lucide-react';

// === Nav items (self-contained: FE-034 Sidebar is not on master yet)

const NAV_ITEMS = [
  { to: '/analytics', label: 'Analytics', Icon: BarChart3 },
  { to: '/scheduler', label: 'Scheduler', Icon: CalendarClock },
  { to: '/predictor', label: 'Predictor', Icon: Sparkles },
  { to: '/settings', label: 'Settings', Icon: Settings },
];

// === Media query hook

/** True while the viewport matches `query`. Safe when `matchMedia` is unavailable. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

// === Component

/**
 * Below `md`, a 44x44 hamburger that opens the navigation as a left drawer. The drawer
 * closes automatically on navigation and on Escape.
 */
export const MobileNav: React.FC = () => {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [open, setOpen] = useState<boolean>(false);
  const { pathname } = useLocation();
  const lastPath = useRef<string>(pathname);

  // Close on navigation.
  useEffect(() => {
    if (pathname !== lastPath.current) {
      lastPath.current = pathname;
      setOpen(false);
    }
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Above `md` the persistent sidebar owns navigation; render nothing here.
  if (!isMobile) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-subtext hover:text-white"
      >
        <Menu className="h-5 w-5" aria-hidden="true" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <nav
            aria-label="Main"
            className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col gap-1 border-r border-dark-border bg-dark-elev p-2"
          >
            <div className="mb-2 flex items-center justify-between px-2 py-2">
              <span className="font-bold text-white">SocialFlow AI</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="flex h-11 w-11 items-center justify-center text-gray-subtext hover:text-white"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <ul className="flex flex-col gap-1">
              {NAV_ITEMS.map(({ to, label, Icon }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    className={({ isActive }) =>
                      `flex min-h-[44px] items-center gap-3 rounded-lg px-3 text-sm font-medium ${
                        isActive
                          ? 'bg-primary-blue/15 text-primary-blue'
                          : 'text-gray-subtext hover:bg-white/5 hover:text-white'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </>
      )}
    </>
  );
};

export default MobileNav;
