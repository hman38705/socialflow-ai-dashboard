import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  CalendarClock,
  ChevronsLeft,
  LogOut,
  PanelLeft,
  Rocket,
  Settings,
  Sparkles,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

// === Constants

const COLLAPSE_KEY = 'sf.sidebar.collapsed';

interface NavItem {
  to: string;
  label: string;
  Icon: typeof BarChart3;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/analytics', label: 'Analytics', Icon: BarChart3 },
  { to: '/scheduler', label: 'Scheduler', Icon: CalendarClock },
  { to: '/predictor', label: 'Predictor', Icon: Sparkles },
  { to: '/settings', label: 'Settings', Icon: Settings },
];

// === Helpers

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === 'true';
  } catch {
    return false;
  }
}

// === Component

interface SidebarProps {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ mobileOpen = false, onCloseMobile }) => {
  const { user, logout } = useAuth();
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, String(collapsed));
    } catch {
      /* storage unavailable - collapse just won't persist */
    }
  }, [collapsed]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [menuOpen]);

  const handleSignOut = useCallback(() => {
    setMenuOpen(false);
    void logout();
  }, [logout]);

  const width = collapsed ? 'w-16' : 'w-60';

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          aria-hidden="true"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`${width} z-50 flex h-screen flex-col border-r border-dark-border bg-dark-elev transition-[width] duration-200 max-md:fixed max-md:inset-y-0 max-md:left-0 ${
          mobileOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'
        } max-md:transition-transform`}
      >
        <div className="flex items-center gap-2 border-b border-dark-border px-3 py-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary-rose to-primary-blue">
            <Rocket className="h-4 w-4 text-white" aria-hidden="true" />
          </span>
          {!collapsed && <span className="font-bold tracking-tight text-white">SocialFlow AI</span>}
          {onCloseMobile && (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close navigation"
              className="ml-auto text-gray-subtext hover:text-white md:hidden"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto p-2">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map(({ to, label, Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  title={collapsed ? label : undefined}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-primary-blue/15 text-primary-blue'
                        : 'text-gray-subtext hover:bg-white/5 hover:text-white'
                    }`
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className={collapsed ? 'sr-only' : ''}>{label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-dark-border p-2">
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-pressed={collapsed}
            className="mb-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-gray-subtext hover:bg-white/5 hover:text-white"
          >
            {collapsed ? (
              <PanelLeft className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
            )}
            {!collapsed && <span>Collapse</span>}
          </button>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-white/5"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary-purple to-primary-rose text-xs font-bold text-white">
                {(user?.email ?? '?').charAt(0).toUpperCase()}
              </span>
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white/90">
                    {user?.email ?? 'Signed in'}
                  </span>
                </span>
              )}
            </button>

            {menuOpen && (
              <div
                role="menu"
                aria-label="User menu"
                className="absolute bottom-full left-0 mb-2 w-48 rounded-xl border border-dark-border bg-dark-elev p-1 shadow-elev-2"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleSignOut}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-primary-rose hover:bg-primary-rose/10"
                >
                  <LogOut className="h-4 w-4" aria-hidden="true" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
