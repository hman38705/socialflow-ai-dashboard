import React, { useState } from 'react';
import { GlassCard } from '../components/ui/GlassCard';
import TwoFactorSetup from '../components/TwoFactorSetup';
import { PasswordRotationModal } from '../components/PasswordRotationModal';
import { TranslationPanel } from '../components/TranslationPanel';
import WebhookManager from '../components/WebhookManager';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

type Tab = 'profile' | 'security' | 'integrations' | 'localization';

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'profile', label: 'Profile', icon: 'person' },
  { id: 'security', label: 'Security', icon: 'shield' },
  { id: 'integrations', label: 'Integrations', icon: 'webhook' },
  { id: 'localization', label: 'Localization', icon: 'translate' },
];

export const SettingsPage: React.FC = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('profile');
  const [pwOpen, setPwOpen] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const handlePasswordSubmit = async (): Promise<void> => {
    setPwLoading(true);
    // Frontend-only: simulate the rotation round-trip.
    await new Promise((r) => setTimeout(r, 700));
    setPwLoading(false);
    setPwOpen(false);
    toast('Password updated successfully.', 'success');
  };

  return (
    <div className="space-y-8 pb-20">
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
              tab === t.id
                ? 'bg-primary-blue/20 border-primary-blue/40 text-primary-blue'
                : 'border-dark-border text-gray-400 hover:text-white hover:border-white/20'
            }`}
          >
            <MaterialIcon name={t.icon} className="text-lg" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <GlassCard className="max-w-2xl space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-purple to-pink-500 p-0.5">
              <div className="w-full h-full rounded-2xl bg-dark-bg flex items-center justify-center">
                <span className="text-xl font-black text-white">{user?.name?.[0] ?? 'A'}</span>
              </div>
            </div>
            <div>
              <p className="text-lg font-bold text-white">{user?.name}</p>
              <p className="text-sm text-gray-subtext">{user?.plan}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">Display name</span>
              <input
                defaultValue={user?.name}
                className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-blue/50"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">Email</span>
              <input
                defaultValue={user?.email}
                className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-blue/50"
              />
            </label>
          </div>

          <button
            onClick={() => toast('Profile changes saved.', 'success')}
            className="btn-primary px-6 py-2.5 text-sm"
          >
            Save Changes
          </button>
        </GlassCard>
      )}

      {tab === 'security' && (
        <div className="space-y-8 max-w-2xl">
          <GlassCard>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-lg font-bold text-white">Password</h3>
                <p className="text-sm text-gray-subtext">Rotate your password regularly to stay secure.</p>
              </div>
              <button
                onClick={() => setPwOpen(true)}
                className="px-5 py-2.5 rounded-xl border border-dark-border text-sm font-bold text-gray-200 hover:text-white hover:border-white/20 transition-all"
              >
                Change Password
              </button>
            </div>
          </GlassCard>

          <GlassCard>
            <h3 className="text-lg font-bold text-white mb-4">Two-Factor Authentication</h3>
            <TwoFactorSetup
              onSetupComplete={() => toast('Two-factor authentication enabled.', 'success')}
              onDisableComplete={() => toast('Two-factor authentication disabled.', 'info')}
              onCancel={() => undefined}
            />
          </GlassCard>
        </div>
      )}

      {tab === 'integrations' && (
        <GlassCard>
          <WebhookManager />
        </GlassCard>
      )}

      {tab === 'localization' && (
        <GlassCard>
          <TranslationPanel />
        </GlassCard>
      )}

      <PasswordRotationModal
        isOpen={pwOpen}
        onClose={() => setPwOpen(false)}
        onSubmit={handlePasswordSubmit}
        isLoading={pwLoading}
      />
    </div>
  );
};
