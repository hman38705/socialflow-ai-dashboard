import React, { FormEvent, useState } from 'react';
import { usePasswordRotation, UsePasswordRotationOptions } from '../../hooks/usePasswordRotation';

export interface PasswordRotationModalProps extends UsePasswordRotationOptions {
  isOpen?: boolean;
  onClose?: () => void;
  onSubmit?: (currentPassword: string, newPassword: string) => Promise<void>;
  isLoading?: boolean;
  error?: string;
}

function passwordStrength(password: string) {
  return [
    password.length >= 8,
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;
}

export function PasswordRotationModal({
  isOpen = true,
  onClose,
  onSubmit,
  isLoading: externalLoading,
  error: externalError,
  ...options
}: PasswordRotationModalProps) {
  const rotation = usePasswordRotation({ ...options, onSuccess: onClose });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState('');
  if (!isOpen || (!rotation.isDue && !options.passwordUpdatedAt)) return null;
  const mandatory = rotation.isMandatory;
  const loading = externalLoading ?? rotation.isLoading;
  const error = externalError || localError || rotation.error;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError('');
    if (newPassword !== confirmPassword) return setLocalError('New passwords do not match');
    if (passwordStrength(newPassword) < 4) return setLocalError('Choose a stronger password');
    try {
      if (onSubmit) await onSubmit(currentPassword, newPassword);
      else await rotation.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : 'Failed to change password');
    }
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="password-rotation-title"
      className="password-rotation-modal"
    >
      <h2 id="password-rotation-title">
        {mandatory ? 'Password rotation required' : 'Update your password'}
      </h2>
      <p>
        {mandatory
          ? 'Your password must be updated before you can continue.'
          : `${rotation.daysRemaining} days remaining to update your password.`}
      </p>
      <form onSubmit={submit}>
        <label>
          Current password
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            disabled={loading}
            autoComplete="current-password"
          />
        </label>
        <label>
          New password
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            disabled={loading}
            autoComplete="new-password"
          />
        </label>
        <meter
          min="0"
          max="5"
          value={passwordStrength(newPassword)}
          aria-label="Password strength"
        />
        <label>
          Confirm new password
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            disabled={loading}
            autoComplete="new-password"
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Updating...' : 'Update password'}
        </button>
        {!mandatory && (
          <button
            type="button"
            onClick={() => {
              rotation.dismiss();
              onClose?.();
            }}
            disabled={loading}
          >
            Remind me tomorrow
          </button>
        )}
      </form>
    </div>
  );
}

export default PasswordRotationModal;
