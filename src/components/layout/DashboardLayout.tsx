import React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { NotificationsPanel } from './NotificationsPanel';
import { useComposer } from '../../contexts/ComposerContext';
import { useAuth } from '../../contexts/AuthContext';

interface PageMeta {
  title: string;
  subtitle: string;
}

const PAGE_META: Record<string, PageMeta> = {
  '/': { title: 'Welcome Back', subtitle: 'Your AI agents summarized 4,502 social signals today.' },
  '/analytics': { title: 'Analytics', subtitle: 'Cross-platform performance across the last 28 days.' },
  '/scheduler': { title: 'Scheduler', subtitle: 'Plan, queue, and publish across every channel.' },
  '/predictor': { title: 'AI Predictor', subtitle: 'Forecast reach before you hit publish.' },
  '/settings': { title: 'Settings', subtitle: 'Manage your profile, security, and integrations.' },
};

export const DashboardLayout: React.FC = () => {
  const location = useLocation();
  const { openComposer } = useComposer();
  const { user } = useAuth();

  const meta = PAGE_META[location.pathname] ?? { title: 'Dashboard', subtitle: '' };
  const firstName = (user?.name ?? 'Alex').split(' ')[0];
  const heading = location.pathname === '/' ? `${meta.title}, ${firstName}!` : meta.title;

  return (
    <div className="layout-grid relative min-h-screen bg-[#030303]">
      <div className="bg-glow" />

      <Sidebar />

      <main className="min-h-screen p-8 transition-all relative z-10 min-w-0 overflow-x-hidden">
        <header className="flex items-center justify-between mb-12 gap-6">
          <div className="min-w-0">
            <h2 className="text-3xl font-bold tracking-tight text-white mb-2 truncate">{heading}</h2>
            <p className="text-sm text-gray-subtext">{meta.subtitle}</p>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={openComposer}
              className="btn-primary px-6 py-2 text-sm"
            >
              <span className="material-symbols-outlined text-sm">add</span>
              Create New Post
            </button>
            <NotificationsPanel />
          </div>
        </header>

        <section key={location.pathname} className="animate-in fade-in slide-in-from-bottom-4 duration-700">
          <Outlet />
        </section>
      </main>
    </div>
  );
};
