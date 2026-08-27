import React, { lazy, Suspense, useCallback, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useCredits } from '../hooks/useCredits';
import { UnsavedChangesContext } from '../hooks/useUnsavedChanges';

interface SectionDef {
  key: string;
  path: string;
  label: string;
  Component: React.LazyExoticComponent<() => React.JSX.Element>;
  /** Hidden entirely (not just disabled) when this returns false. */
  visibleWhen?: (ctx: { plan?: string }) => boolean;
}

const SECTIONS: SectionDef[] = [
  {
    key: 'profile',
    path: 'profile',
    label: 'Profile',
    Component: lazy(() => import('./settings/ProfileSection')),
  },
  {
    key: 'security',
    path: 'security',
    label: 'Security',
    Component: lazy(() => import('./settings/SecuritySection')),
  },
  {
    key: 'organization',
    path: 'organization',
    label: 'Organization',
    Component: lazy(() => import('./settings/OrganizationSection')),
  },
  {
    key: 'billing',
    path: 'billing',
    label: 'Billing',
    Component: lazy(() => import('./settings/BillingSection')),
  },
  {
    key: 'webhooks',
    path: 'webhooks',
    label: 'Webhooks',
    Component: lazy(() => import('./settings/WebhooksSection')),
    // Webhooks are a paid-plan integration; free-tier accounts don't see the tab at all.
    visibleWhen: ({ plan }) => plan !== 'free',
  },
  {
    key: 'schedule',
    path: 'schedule',
    label: 'Schedule',
    Component: lazy(() => import('./settings/ScheduleSection')),
  },
  {
    key: 'notifications',
    path: 'notifications',
    label: 'Notifications',
    Component: lazy(() => import('./settings/NotificationsSection')),
  },
];

export function SettingsPage(): React.JSX.Element {
  const { subscription } = useCredits();
  const location = useLocation();
  const navigate = useNavigate();
  const dirtyRef = useRef(false);

  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const visibleSections = SECTIONS.filter(
    (s) => !s.visibleWhen || s.visibleWhen({ plan: subscription?.plan }),
  );
  const activeKey = location.pathname.split('/')[2] || 'profile';

  function go(path: string): void {
    if (path === activeKey) return;
    if (dirtyRef.current && !window.confirm('You have unsaved changes. Leave without saving?')) {
      return;
    }
    dirtyRef.current = false;
    navigate(`/settings/${path}`);
  }

  return (
    <UnsavedChangesContext.Provider value={setDirty}>
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <h1 className="text-2xl font-black text-white">Settings</h1>

        <select
          className="sm:hidden w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white"
          value={activeKey}
          onChange={(e) => go(e.target.value)}
        >
          {visibleSections.map((s) => (
            <option key={s.key} value={s.path}>
              {s.label}
            </option>
          ))}
        </select>

        <div className="flex flex-col sm:flex-row gap-8">
          <nav className="hidden sm:flex sm:flex-col gap-1 w-48 shrink-0">
            {visibleSections.map((s) => (
              <button
                key={s.key}
                onClick={() => go(s.path)}
                className={`text-left px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                  activeKey === s.path
                    ? 'bg-primary-blue/20 text-primary-blue'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="flex-1 min-w-0">
            <Suspense fallback={<p className="text-sm text-gray-subtext">Loading…</p>}>
              <Routes>
                <Route index element={<Navigate to="profile" replace />} />
                {SECTIONS.map((s) => {
                  const isVisible = visibleSections.includes(s);
                  const Component = s.Component;
                  return (
                    <Route
                      key={s.key}
                      path={s.path}
                      element={isVisible ? <Component /> : <Navigate to="profile" replace />}
                    />
                  );
                })}
                <Route path="*" element={<Navigate to="profile" replace />} />
              </Routes>
            </Suspense>
          </div>
        </div>
      </div>
    </UnsavedChangesContext.Provider>
  );
}

export default SettingsPage;
