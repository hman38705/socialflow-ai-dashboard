import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu, Plus, Search } from 'lucide-react';
import { useComposer } from '../../contexts/ComposerContext';
import { OrgSwitcher } from './OrgSwitcher';
import { NotificationsPanel } from './NotificationsPanel';

// === Route titles
//
// Single source of truth for page titles. Longest matching prefix wins.

const ROUTE_TITLES: Array<[string, string]> = [
  ['/analytics', 'Analytics'],
  ['/scheduler', 'Scheduler'],
  ['/predictor', 'Predictor'],
  ['/settings', 'Settings'],
  ['/search', 'Search'],
];

export function titleForPath(pathname: string): string {
  const match = ROUTE_TITLES.filter(([prefix]) => pathname.startsWith(prefix)).sort(
    (a, b) => b[0].length - a[0].length,
  )[0];
  return match ? match[1] : 'Dashboard';
}

// === Component

interface TopbarProps {
  onOpenMobileNav?: () => void;
  /** Opens the FE-039 command palette. No-op until that lands. */
  onOpenCommandPalette?: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({ onOpenMobileNav, onOpenCommandPalette }) => {
  const { pathname } = useLocation();
  const { openComposer } = useComposer();
  const title = titleForPath(pathname);

  useEffect(() => {
    document.title = `${title} · SocialFlow AI`;
  }, [title]);

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-dark-border bg-dark-bg/70 px-4 py-3 backdrop-blur">
      {onOpenMobileNav && (
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation"
          className="text-gray-subtext hover:text-white md:hidden"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
      )}

      <h1 className="min-w-0 flex-1 truncate text-lg font-bold text-white">{title}</h1>

      <button
        type="button"
        onClick={() => onOpenCommandPalette?.()}
        className="hidden items-center gap-2 rounded-lg border border-dark-border px-3 py-1.5 text-sm text-gray-subtext hover:text-white sm:flex"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span>Search</span>
        <kbd className="rounded bg-white/10 px-1.5 text-[10px] font-semibold">⌘K</kbd>
      </button>

      <button
        type="button"
        onClick={() => openComposer()}
        className="flex items-center gap-1.5 rounded-lg bg-primary-blue px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-blue/90"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">New post</span>
      </button>

      <NotificationsPanel />
      <OrgSwitcher />
    </header>
  );
};

export default Topbar;
