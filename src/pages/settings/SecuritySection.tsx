import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OpenAPI } from '../../api/core/OpenAPI';
import { request as __request } from '../../api/core/request';
import { AuthService } from '../../api/services/AuthService';
import { ApiError } from '../../api/core/ApiError';

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

const TOKEN_KEY = 'sf_auth_token';
const REFRESH_TOKEN_KEY = 'sf_auth_refresh_token';
const USER_KEY = 'sf_auth_user';

export interface SecurityUser {
  email: string;
  twoFactorEnabled?: boolean;
}

function readCachedUser(): SecurityUser {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) return JSON.parse(raw) as SecurityUser;
  } catch {
    // fall through
  }
  return { email: '', twoFactorEnabled: false };
}

function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

type TwoFactorStep = 'idle' | 'setup' | 'disable';

export const SecuritySection: React.FC = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<SecurityUser>(() => readCachedUser());
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const showToast = useCallback((kind: 'success' | 'error', message: string) => {
    setNotice({ kind, message });
    setTimeout(() => setNotice(null), 3800);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const fresh = await __request<SecurityUser>(OpenAPI, { method: 'GET', url: '/users/me' });
      setUser(fresh);
      localStorage.setItem(USER_KEY, JSON.stringify(fresh));
    } catch {
      // best-effort
    }
  }, []);

  // ── Change password ──────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }
    setIsChangingPassword(true);
    try {
      await AuthService.postAuthChangePassword({ requestBody: { currentPassword, newPassword } });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      await refreshUser();
      showToast('success', 'Password updated.');
    } catch (err) {
      setPasswordError(
        err instanceof ApiError && err.status === 400
          ? 'Current password is incorrect.'
          : 'Could not update your password.'
      );
    } finally {
      setIsChangingPassword(false);
    }
  };

  // ── Two-factor authentication ────────────────────────────────────────
  const [twoFactorStep, setTwoFactorStep] = useState<TwoFactorStep>('idle');
  const [setupSecret, setSetupSecret] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const [isTwoFactorBusy, setIsTwoFactorBusy] = useState(false);

  const startSetup = async () => {
    setTwoFactorError(null);
    setIsTwoFactorBusy(true);
    try {
      const { secret } = await __request<{ secret: string }>(OpenAPI, {
        method: 'POST',
        url: '/auth/2fa/setup',
      });
      setSetupSecret(secret);
      setSetupCode('');
      setTwoFactorStep('setup');
    } catch {
      setTwoFactorError('Could not start two-factor setup.');
    } finally {
      setIsTwoFactorBusy(false);
    }
  };

  const confirmSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(setupCode)) {
      setTwoFactorError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setTwoFactorError(null);
    setIsTwoFactorBusy(true);
    try {
      const { recoveryCodes: codes } = await __request<{ recoveryCodes: string[] }>(OpenAPI, {
        method: 'POST',
        url: '/auth/2fa/enable',
        body: { secret: setupSecret, code: setupCode },
        mediaType: 'application/json',
      });
      setSetupSecret('');
      setSetupCode('');
      setRecoveryCodes(codes);
      setTwoFactorStep('idle');
      await refreshUser();
      showToast('success', 'Two-factor authentication enabled.');
    } catch {
      setTwoFactorError('Invalid code. Please try again.');
    } finally {
      setIsTwoFactorBusy(false);
    }
  };

  // Disabling 2FA always requires the account password, even though the
  // user is already signed in — it's the one thing standing between an
  // unattended session and turning off a security control.
  const confirmDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disablePassword) {
      setTwoFactorError('Enter your password to disable two-factor authentication.');
      return;
    }
    setTwoFactorError(null);
    setIsTwoFactorBusy(true);
    try {
      await __request(OpenAPI, {
        method: 'POST',
        url: '/auth/2fa/disable',
        body: { password: disablePassword },
        mediaType: 'application/json',
      });
      setDisablePassword('');
      setTwoFactorStep('idle');
      await refreshUser();
      showToast('success', 'Two-factor authentication disabled.');
    } catch (err) {
      setTwoFactorError(
        err instanceof ApiError && err.status === 401 ? 'Incorrect password.' : 'Could not disable two-factor authentication.'
      );
    } finally {
      setIsTwoFactorBusy(false);
    }
  };

  const regenerateRecoveryCodes = async () => {
    setTwoFactorError(null);
    setIsTwoFactorBusy(true);
    try {
      const { recoveryCodes: codes } = await __request<{ recoveryCodes: string[] }>(OpenAPI, {
        method: 'POST',
        url: '/auth/2fa/recovery-codes/regenerate',
      });
      setRecoveryCodes(codes);
      showToast('success', 'Recovery codes regenerated.');
    } catch {
      setTwoFactorError('Could not regenerate recovery codes.');
    } finally {
      setIsTwoFactorBusy(false);
    }
  };

  // ── Danger zone ───────────────────────────────────────────────────────
  const [isSigningOutAll, setIsSigningOutAll] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleSignOutAllSessions = async () => {
    setIsSigningOutAll(true);
    try {
      await __request(OpenAPI, { method: 'POST', url: '/auth/sessions/revoke-all' });
      clearSession();
      navigate('/login', { replace: true });
    } catch {
      showToast('error', 'Could not sign out of all sessions.');
      setIsSigningOutAll(false);
    }
  };

  const deleteConfirmTarget = user.email;
  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deleteConfirmText !== deleteConfirmTarget) {
      setDeleteError(`Type "${deleteConfirmTarget}" exactly to confirm.`);
      return;
    }
    setDeleteError(null);
    setIsDeleting(true);
    try {
      await __request(OpenAPI, { method: 'DELETE', url: '/users/me' });
      clearSession();
      navigate('/login', { replace: true });
    } catch {
      setDeleteError('Could not delete your account. Please try again.');
      setIsDeleting(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      {notice && (
        <div
          role="status"
          className={`text-sm px-4 py-2.5 rounded-xl border ${
            notice.kind === 'success'
              ? 'border-trend-up/30 text-trend-up bg-trend-up/10'
              : 'border-primary-rose/30 text-primary-rose bg-primary-rose/10'
          }`}
        >
          {notice.message}
        </div>
      )}

      <section className="rounded-2xl border border-dark-border bg-dark-surface p-6 space-y-4">
        <h3 className="text-lg font-bold text-white">Password</h3>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            className="w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-blue/50"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            autoComplete="new-password"
            className="w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-blue/50"
          />
          <input
            type="password"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            className="w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-blue/50"
          />
          {passwordError && (
            <p role="alert" className="text-sm text-primary-rose">
              {passwordError}
            </p>
          )}
          <button
            type="submit"
            disabled={isChangingPassword || !currentPassword || !newPassword}
            className="px-5 py-2.5 rounded-xl border border-dark-border text-sm font-bold text-gray-200 hover:text-white hover:border-white/20 disabled:opacity-60 transition-all"
          >
            {isChangingPassword ? 'Updating…' : 'Change password'}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-dark-border bg-dark-surface p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">Two-factor authentication</h3>
          <span
            className={`text-xs font-bold px-3 py-1 rounded-full ${
              user.twoFactorEnabled
                ? 'bg-trend-up/15 text-trend-up border border-trend-up/30'
                : 'bg-white/5 text-gray-subtext border border-dark-border'
            }`}
          >
            {user.twoFactorEnabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        {twoFactorStep === 'idle' && (
          <div className="flex flex-wrap gap-3">
            {!user.twoFactorEnabled ? (
              <button
                onClick={startSetup}
                disabled={isTwoFactorBusy}
                className="px-5 py-2.5 rounded-xl bg-primary-blue text-white text-sm font-bold hover:bg-primary-blue/90 disabled:opacity-60 transition-all"
              >
                Enable two-factor authentication
              </button>
            ) : (
              <>
                <button
                  onClick={regenerateRecoveryCodes}
                  disabled={isTwoFactorBusy}
                  className="px-5 py-2.5 rounded-xl border border-dark-border text-sm font-bold text-gray-200 hover:text-white hover:border-white/20 disabled:opacity-60 transition-all"
                >
                  Regenerate recovery codes
                </button>
                <button
                  onClick={() => {
                    setTwoFactorError(null);
                    setDisablePassword('');
                    setTwoFactorStep('disable');
                  }}
                  className="px-5 py-2.5 rounded-xl border border-primary-rose/30 text-sm font-bold text-primary-rose hover:bg-primary-rose/10 transition-all"
                >
                  Disable two-factor authentication
                </button>
              </>
            )}
          </div>
        )}

        {twoFactorStep === 'setup' && (
          <form onSubmit={confirmSetup} className="space-y-3">
            <p className="text-sm text-gray-subtext">
              Add this key to your authenticator app, then enter the 6-digit code it generates.
            </p>
            <code className="block px-4 py-2.5 rounded-xl bg-dark-bg/60 border border-dark-border text-sm text-primary-teal break-all">
              {setupSecret}
            </code>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={setupCode}
              onChange={(e) => setSetupCode(e.target.value.replace(/\D/g, ''))}
              placeholder="6-digit code"
              className="w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-blue/50"
            />
            {twoFactorError && (
              <p role="alert" className="text-sm text-primary-rose">
                {twoFactorError}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setTwoFactorStep('idle')}
                className="flex-1 px-4 py-2.5 rounded-xl border border-dark-border text-sm font-bold text-gray-200 hover:text-white transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isTwoFactorBusy}
                className="flex-1 px-4 py-2.5 rounded-xl bg-primary-blue text-white text-sm font-bold hover:bg-primary-blue/90 disabled:opacity-60 transition-all"
              >
                {isTwoFactorBusy ? 'Verifying…' : 'Verify & enable'}
              </button>
            </div>
          </form>
        )}

        {twoFactorStep === 'disable' && (
          <form onSubmit={confirmDisable} className="space-y-3">
            <p className="text-sm text-gray-subtext">Confirm your password to disable two-factor authentication.</p>
            <input
              type="password"
              value={disablePassword}
              onChange={(e) => setDisablePassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              className="w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-blue/50"
            />
            {twoFactorError && (
              <p role="alert" className="text-sm text-primary-rose">
                {twoFactorError}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setTwoFactorStep('idle')}
                className="flex-1 px-4 py-2.5 rounded-xl border border-dark-border text-sm font-bold text-gray-200 hover:text-white transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isTwoFactorBusy}
                className="flex-1 px-4 py-2.5 rounded-xl bg-primary-rose text-white text-sm font-bold hover:bg-primary-rose/90 disabled:opacity-60 transition-all"
              >
                {isTwoFactorBusy ? 'Disabling…' : 'Disable'}
              </button>
            </div>
          </form>
        )}

        {recoveryCodes && (
          <div className="space-y-2">
            <p className="text-sm text-gray-subtext">
              Save these recovery codes somewhere safe — each can only be used once.
            </p>
            <ul className="grid grid-cols-2 gap-2 bg-dark-bg/60 border border-dark-border rounded-xl p-4">
              {recoveryCodes.map((code) => (
                <li key={code} className="font-mono text-sm text-white">
                  {code}
                </li>
              ))}
            </ul>
            <button
              onClick={() => setRecoveryCodes(null)}
              className="text-xs font-semibold text-primary-blue hover:text-primary-blue/80"
            >
              Done
            </button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-primary-rose/30 bg-primary-rose/5 p-6 space-y-4">
        <h3 className="text-lg font-bold text-white">Danger zone</h3>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-white">Sign out of all sessions</p>
            <p className="text-xs text-gray-subtext">Ends every active session, including this one.</p>
          </div>
          <button
            onClick={handleSignOutAllSessions}
            disabled={isSigningOutAll}
            className="shrink-0 px-4 py-2 rounded-xl border border-dark-border text-sm font-bold text-gray-200 hover:text-white hover:border-white/20 disabled:opacity-60 transition-all"
          >
            {isSigningOutAll ? 'Signing out…' : 'Sign out everywhere'}
          </button>
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-white">Delete account</p>
            <p className="text-xs text-gray-subtext">Permanently deletes your account and all its data.</p>
          </div>
          <button
            onClick={() => {
              setDeleteError(null);
              setDeleteConfirmText('');
              setDeleteModalOpen(true);
            }}
            className="shrink-0 px-4 py-2 rounded-xl bg-primary-rose text-white text-sm font-bold hover:bg-primary-rose/90 transition-all"
          >
            Delete account
          </button>
        </div>
      </section>

      {deleteModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
          <div className="w-full max-w-md rounded-2xl border border-dark-border bg-dark-elev p-6 space-y-4">
            <h3 className="text-lg font-bold text-white">Delete your account?</h3>
            <p className="text-sm text-gray-subtext">
              This can't be undone. Type <span className="font-mono text-white">{deleteConfirmTarget}</span> to
              confirm.
            </p>
            <form onSubmit={handleDeleteAccount} className="space-y-3">
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                className="w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-rose/50"
                autoFocus
              />
              {deleteError && (
                <p role="alert" className="text-sm text-primary-rose">
                  {deleteError}
                </p>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setDeleteModalOpen(false)}
                  disabled={isDeleting}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-dark-border text-sm font-bold text-gray-200 hover:text-white disabled:opacity-60 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDeleting || deleteConfirmText !== deleteConfirmTarget}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-primary-rose text-white text-sm font-bold hover:bg-primary-rose/90 disabled:opacity-60 transition-all"
                >
                  {isDeleting ? 'Deleting…' : 'Delete permanently'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SecuritySection;
