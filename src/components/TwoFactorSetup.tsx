import React, { useState, useEffect } from 'react';
import { twoFactorService, TwoFactorUnavailableError } from '../services/twoFactorService';
import QRCodeDisplay from './QRCodeDisplay';

type SetupStep =
  | 'IDLE'
  | 'GENERATING_CODES'
  | 'SHOWING_CODES'
  | 'QR_DISPLAY'
  | 'CONFIRMING'
  | 'DISABLING'
  | 'DONE';

interface TwoFactorSetupProps {
  onSetupComplete: () => void;
  onDisableComplete: () => void;
  onCancel: () => void;
}

const TwoFactorSetup: React.FC<TwoFactorSetupProps> = ({
  onSetupComplete,
  onDisableComplete,
  onCancel,
}) => {
  const [step, setStep] = useState<SetupStep>('IDLE');
  const [secret, setSecret] = useState('');
  const [uri, setUri] = useState('');
  const [token, setToken] = useState('');
  const [disableToken, setDisableToken] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesAcknowledged, setCodesAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isEnabled = twoFactorService.isEnabled();

  // Clear TOTP secret from state on component unmount
  useEffect(() => {
    return () => {
      setSecret('');
      setUri('');
      setToken('');
    };
  }, []);

  // ── Enable flow ─────────────────────────────────────────────────────────────

  const handleStartSetup = () => {
    setError(null);
    setLoading(true);
    try {
      const codes = twoFactorService.generateRecoveryCodes();
      setRecoveryCodes(codes);
      setCodesAcknowledged(false);
      setStep('SHOWING_CODES');
    } catch (e) {
      setError('Failed to generate recovery codes.');
    } finally {
      setLoading(false);
    }
  };

  const handleCodesAcknowledged = () => {
    if (!codesAcknowledged) {
      setError('Please confirm you have saved your recovery codes.');
      return;
    }
    setError(null);
    const { secret: s, uri: u } = twoFactorService.generateSecret('SocialFlow');
    setSecret(s);
    setUri(u);
    setToken('');
    setStep('QR_DISPLAY');
  };

  const handleConfirmToken = async () => {
    setError(null);
    if (!/^\d{6}$/.test(token)) {
      setError('Please enter a 6-digit code.');
      return;
    }
    const valid = await twoFactorService.verifyToken(secret, token);
    if (!valid) {
      setError('Invalid code. Please try again.');
      return;
    }
    setLoading(true);
    try {
      await twoFactorService.enable(secret);
      await twoFactorService.storeRecoveryCodes(recoveryCodes);
      setSecret('');
      setUri('');
      setToken('');
      setStep('DONE');
      onSetupComplete();
    } catch (e) {
      setError(e instanceof TwoFactorUnavailableError ? e.message : 'Failed to enable 2FA.');
    } finally {
      setLoading(false);
    }
  };

  const handleFinishSetup = () => {
    if (!codesAcknowledged) {
      setError('Please confirm you have saved your recovery codes.');
      return;
    }
    setStep('DONE');
    onSetupComplete();
  };

  // ── Disable flow ────────────────────────────────────────────────────────────

  const handleStartDisable = () => {
    setError(null);
    setDisableToken('');
    setStep('DISABLING');
  };

  const handleConfirmDisable = async () => {
    setError(null);
    setLoading(true);
    try {
      const validTotp = await twoFactorService.verifyStoredToken(disableToken);
      const validRecovery = !validTotp && await twoFactorService.verifyRecoveryCode(disableToken);
      if (!validTotp && !validRecovery) {
        setError('Invalid code. 2FA has not been disabled.');
        return;
      }
      await twoFactorService.disable();
      setStep('DONE');
      onDisableComplete();
    } catch (e) {
      setError(e instanceof TwoFactorUnavailableError ? e.message : 'Failed to disable 2FA.');
    } finally {
      setLoading(false);
    }
  };

  // ── Regenerate recovery codes ───────────────────────────────────────────────

  const handleRegenerateCodes = async () => {
    setError(null);
    setLoading(true);
    try {
      const codes = await twoFactorService.regenerateRecoveryCodes();
      setRecoveryCodes(codes);
      setCodesAcknowledged(false);
      setStep('SHOWING_CODES');
    } catch (e) {
      setError('Failed to regenerate recovery codes.');
    } finally {
      setLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-md mx-auto">
      <h2 className="text-xl font-bold mb-4">Two-Factor Authentication</h2>

      {step === 'IDLE' && (
        <div className="space-y-3">
          {!isEnabled ? (
            <button
              onClick={handleStartSetup}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              Enable Two-Factor Authentication
            </button>
          ) : (
            <>
              <p className="text-green-600 text-sm font-medium">✓ Two-Factor Authentication is enabled</p>
              <button
                onClick={handleRegenerateCodes}
                disabled={loading}
                className="w-full px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
              >
                Regenerate Recovery Codes
              </button>
              <button
                onClick={handleStartDisable}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                Disable Two-Factor Authentication
              </button>
            </>
          )}
          <button onClick={onCancel} className="w-full px-4 py-2 text-gray-600 hover:underline">
            Cancel
          </button>
          {error && <p className="text-red-600 text-sm">{error}</p>}
        </div>
      )}

      {step === 'QR_DISPLAY' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Scan this QR code with your authenticator app, then enter the 6-digit code below.
          </p>
          <QRCodeDisplay uri={uri} secret={secret} />
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder="6-digit code"
            value={token}
            onChange={e => setToken(e.target.value.replace(/\D/g, ''))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-3">
            <button onClick={onCancel} className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handleConfirmToken}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Verifying…' : 'Verify'}
            </button>
          </div>
        </div>
      )}

      {step === 'SHOWING_CODES' && (
        <div className="space-y-4">
          <p className="text-sm font-medium text-gray-700">
            Save these recovery codes in a safe place. Each can only be used once.
          </p>
          <ul className="bg-gray-50 rounded-md p-4 space-y-1">
            {recoveryCodes.map(code => (
              <li key={code} className="font-mono text-sm">{code}</li>
            ))}
          </ul>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={codesAcknowledged}
              onChange={e => setCodesAcknowledged(e.target.checked)}
            />
            I have saved my recovery codes
          </label>
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <button
            onClick={handleCodesAcknowledged}
            disabled={!codesAcknowledged || loading}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Generating QR Code…' : 'Continue to QR Code'}
          </button>
        </div>
      )}

      {step === 'DISABLING' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Enter your current TOTP code or a recovery code to disable 2FA.
          </p>
          <input
            type="text"
            placeholder="TOTP code or recovery code"
            value={disableToken}
            onChange={e => setDisableToken(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-red-600 text-sm">{error}</p>}
          <div className="flex gap-3">
            <button onClick={() => setStep('IDLE')} className="flex-1 px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handleConfirmDisable}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? 'Disabling…' : 'Disable 2FA'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default TwoFactorSetup;
