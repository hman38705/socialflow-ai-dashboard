import React, { useCallback, useRef, useState } from 'react';
import { OpenAPI } from '../../api/core/OpenAPI';
import { request as __request } from '../../api/core/request';

const MaterialIcon = ({ name, className }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

// Same storage key AuthContext seeds/reads — this section renders straight
// from the cached auth user and writes back through it so a page reload
// doesn't lose an in-flight edit's result.
const USER_KEY = 'sf_auth_user';
const MAX_AVATAR_BYTES = 2 * 1024 * 1024; // 2MB
const AVATAR_MAX_DIMENSION = 512;

export interface ProfileUser {
  name: string;
  email: string;
  emailVerified?: boolean;
  avatarUrl?: string;
}

function readCachedUser(): ProfileUser {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) return JSON.parse(raw) as ProfileUser;
  } catch {
    // fall through to default
  }
  return { name: '', email: '' };
}

function writeCachedUser(user: ProfileUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/** Downscales an image client-side before it ever leaves the browser. */
function resizeImage(file: File, maxDimension = AVATAR_MAX_DIMENSION): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const scale = maxDimension / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not process image.'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image.'))),
        file.type === 'image/png' ? 'image/png' : 'image/jpeg',
        0.9
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('That file is not a valid image.'));
    };
    img.src = objectUrl;
  });
}

export const ProfileSection: React.FC = () => {
  const [user, setUser] = useState<ProfileUser>(() => readCachedUser());
  const [displayName, setDisplayName] = useState(user.name);
  const [isSavingName, setIsSavingName] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((kind: 'success' | 'error', message: string) => {
    setNotice({ kind, message });
    setTimeout(() => setNotice(null), 3800);
  }, []);

  // Re-fetches the current user so every mutation leaves the page showing
  // the server's view, not just an optimistic guess.
  const refreshUser = useCallback(async () => {
    try {
      const fresh = await __request<ProfileUser>(OpenAPI, { method: 'GET', url: '/users/me' });
      setUser(fresh);
      setDisplayName(fresh.name);
      writeCachedUser(fresh);
    } catch {
      // Best-effort — keep whatever we already have cached/optimistic.
    }
  }, []);

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed || trimmed === user.name) return;

    setIsSavingName(true);
    try {
      await __request(OpenAPI, {
        method: 'PATCH',
        url: '/users/me',
        body: { displayName: trimmed },
        mediaType: 'application/json',
      });
      const next = { ...user, name: trimmed };
      setUser(next);
      writeCachedUser(next);
      await refreshUser();
      showToast('success', 'Profile updated.');
    } catch {
      showToast('error', 'Could not save your display name.');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setAvatarError(null);

    // Reject oversized files before doing any work — never resize or
    // attempt to upload a file that's already over the cap.
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError('Image must be smaller than 2MB.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setAvatarError('Please choose an image file.');
      return;
    }

    setIsUploadingAvatar(true);
    try {
      const resized = await resizeImage(file);
      await __request(OpenAPI, {
        method: 'POST',
        url: '/users/me/avatar',
        formData: { avatar: resized },
        mediaType: 'multipart/form-data',
      });
      await refreshUser();
      showToast('success', 'Avatar updated.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not upload avatar.';
      setAvatarError(message);
      showToast('error', message);
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6 rounded-2xl border border-dark-border bg-dark-surface p-6">
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

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploadingAvatar}
          className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-purple to-primary-rose p-0.5 disabled:opacity-60"
          aria-label="Change avatar"
        >
          <div className="w-full h-full rounded-2xl bg-dark-bg flex items-center justify-center overflow-hidden">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xl font-black text-white">{user.name?.[0]?.toUpperCase() ?? '?'}</span>
            )}
          </div>
          {isUploadingAvatar && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded-2xl">
              <MaterialIcon name="progress_activity" className="animate-spin text-white text-lg" />
            </div>
          )}
        </button>
        <div>
          <p className="text-lg font-bold text-white">{user.name || 'Unnamed'}</p>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs font-semibold text-primary-blue hover:text-primary-blue/80"
          >
            Change photo
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
          />
        </div>
      </div>
      {avatarError && (
        <p role="alert" className="text-sm text-primary-rose">
          {avatarError}
        </p>
      )}

      <form onSubmit={handleSaveName} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
            Display name
          </span>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-blue/50"
          />
        </label>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-widest text-gray-subtext">
            Email {!user.emailVerified && <span className="normal-case text-gray-subtext/70">(unverified)</span>}
          </span>
          <input
            value={user.email}
            readOnly={!user.emailVerified}
            disabled={!user.emailVerified}
            className="mt-2 w-full rounded-xl bg-dark-bg/60 border border-dark-border px-4 py-2.5 text-sm text-white focus:outline-none focus:border-primary-blue/50 disabled:opacity-60 disabled:cursor-not-allowed"
          />
          {!user.emailVerified && (
            <span className="text-xs text-gray-subtext mt-1 inline-block">
              Verify your email before you can change it.
            </span>
          )}
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={isSavingName || !displayName.trim() || displayName.trim() === user.name}
            className="px-6 py-2.5 rounded-xl bg-primary-blue text-white text-sm font-bold hover:bg-primary-blue/90 disabled:opacity-60 transition-all"
          >
            {isSavingName ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ProfileSection;
