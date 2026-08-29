import { useCallback, useEffect, useState } from 'react';
import { AuthService } from '../api/services/AuthService';

export const PASSWORD_ROTATION_DAYS = 90;
export const PASSWORD_ROTATION_DISMISSAL_MS = 24 * 60 * 60 * 1000;

export interface UsePasswordRotationOptions {
  passwordUpdatedAt?: string | Date | null;
  policyWindowDays?: number;
  mandatoryAfterDays?: number;
  now?: () => number;
  storage?: Storage;
  changePassword?: (currentPassword: string, newPassword: string) => Promise<unknown>;
  onSuccess?: () => void;
}

export function usePasswordRotation({
  passwordUpdatedAt,
  policyWindowDays = PASSWORD_ROTATION_DAYS,
  mandatoryAfterDays = policyWindowDays,
  now = Date.now,
  storage = typeof window !== 'undefined' ? window.localStorage : undefined,
  changePassword: changePasswordRequest = (currentPassword, newPassword) =>
    AuthService.postAuthChangePassword({ requestBody: { currentPassword, newPassword } }),
  onSuccess,
}: UsePasswordRotationOptions = {}) {
  const [clock, setClock] = useState(now);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setClock(now());
  }, [now, passwordUpdatedAt]);

  const updatedAt = passwordUpdatedAt ? new Date(passwordUpdatedAt).getTime() : clock;
  const ageDays = Math.max(0, Math.floor((clock - updatedAt) / 86400000));
  const isDue = Boolean(passwordUpdatedAt) && ageDays >= policyWindowDays;
  const isMandatory = Boolean(passwordUpdatedAt) && ageDays >= mandatoryAfterDays;
  const daysRemaining = Math.max(0, policyWindowDays - ageDays);

  const dismiss = useCallback(() => {
    storage?.setItem('passwordRotationDismissedAt', String(now()));
    setClock(now());
  }, [now, storage]);

  const dismissedAt = Number(storage?.getItem('passwordRotationDismissedAt') || 0);
  const isDismissed = isDue && !isMandatory && dismissedAt > 0 && now() - dismissedAt < PASSWORD_ROTATION_DISMISSAL_MS;

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    if (currentPassword === newPassword) {
      const reuseError = new Error('New password must be different from your current password');
      setError(reuseError.message);
      throw reuseError;
    }
    setIsLoading(true);
    setError(null);
    try {
      await changePasswordRequest(currentPassword, newPassword);
      storage?.removeItem('passwordRotationDismissedAt');
      onSuccess?.();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to change password';
      setError(message);
      throw cause;
    } finally {
      setIsLoading(false);
    }
  }, [changePasswordRequest, onSuccess, storage]);

  return { isDue: isDue && !isDismissed, daysRemaining, dismiss, isMandatory, changePassword, isLoading, error };
}