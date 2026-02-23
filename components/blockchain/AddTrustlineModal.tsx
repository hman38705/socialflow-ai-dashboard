import React, { useState, useCallback } from 'react';
import { X, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import stellarService from '../../services/stellarService';
import walletService from '../../services/walletService';

interface AddTrustlineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  onError: (error: string) => void;
}

export const AddTrustlineModal: React.FC<AddTrustlineModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onError
}) => {
  const [assetCode, setAssetCode] = useState('');
  const [assetIssuer, setAssetIssuer] = useState('');
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [estimatedFee, _setEstimatedFee] = useState<string>('0.00001');

  // Validate asset input
  const validateAsset = useCallback(() => {
    if (!assetCode.trim()) {
      setValidationError('Asset code is required');
      return false;
    }
    
    if (assetCode.length > 12) {
      setValidationError('Asset code must be 12 characters or less');
      return false;
    }

    if (!assetIssuer.trim()) {
      // Native XLM doesn't need issuer
      if (assetCode.toUpperCase() !== 'XLM') {
        setValidationError('Issuer address is required for non-native assets');
        return false;
      }
    } else {
      // Validate Stellar address format (starts with G, base32)
      const stellarAddressRegex = /^G[A-Z0-9]{55}$/;
      if (!stellarAddressRegex.test(assetIssuer.trim())) {
        setValidationError('Invalid Stellar issuer address');
        return false;
      }
    }

    setValidationError(null);
    return true;
  }, [assetCode, assetIssuer]);

  // Handle input changes
  const handleAssetCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAssetCode(e.target.value.toUpperCase());
    setValidationError(null);
  };

  const handleAssetIssuerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAssetIssuer(e.target.value.toUpperCase());
    setValidationError(null);
  };

  // Create trustline
  const handleCreateTrustline = useCallback(async () => {
    if (!validateAsset()) return;

    const publicKey = walletService.getConnectedWallet();
    if (!publicKey) {
      onError('No wallet connected');
      return;
    }

    setLoading(true);
    try {
      const xdr = await stellarService.createTrustline(
        publicKey,
        assetCode.trim(),
        assetIssuer.trim()
      );

      const signedXDR = await walletService.signTransaction(xdr);
      await stellarService.submitTransaction(signedXDR);
      
      onSuccess();
      
      // Reset form
      setAssetCode('');
      setAssetIssuer('');
    } catch (err: any) {
      console.error('Failed to create trustline:', err);
      onError(err.message || 'Failed to create trustline');
    } finally {
      setLoading(false);
    }
  }, [assetCode, assetIssuer, validateAsset, onSuccess, onError]);

  // Handle close
  const handleClose = useCallback(() => {
    if (!loading) {
      setAssetCode('');
      setAssetIssuer('');
      setValidationError(null);
      onClose();
    }
  }, [loading, onClose]);

  if (!isOpen) return null;

  const isXLM = assetCode.toUpperCase() === 'XLM';

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-2xl max-w-lg w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <h2 className="text-xl font-semibold text-white">Add Trustline</h2>
          <button
            onClick={handleClose}
            disabled={loading}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Description */}
          <p className="text-gray-400 text-sm">
            Add a trustline to track an asset in your portfolio. This requires a one-time 
            minimum balance of 1 XLM per trustline.
          </p>

          {/* Asset Code Input */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Asset Code
            </label>
            <input
              type="text"
              value={assetCode}
              onChange={handleAssetCodeChange}
              placeholder="e.g., USDC, BTC, TEST"
              disabled={loading}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <p className="text-gray-500 text-xs mt-1">
              Native XLM doesn't require an issuer
            </p>
          </div>

          {/* Asset Issuer Input */}
          {!isXLM && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Issuer Address
              </label>
              <input
                type="text"
                value={assetIssuer}
                onChange={handleAssetIssuerChange}
                placeholder="G..."
                disabled={loading}
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
              />
            </div>
          )}

          {/* Validation Error */}
          {validationError && (
            <div className="flex items-center gap-2 text-red-400 text-sm">
              <AlertCircle className="w-4 h-4" />
              {validationError}
            </div>
          )}

          {/* Asset Preview */}
          {(assetCode && (isXLM || assetIssuer)) && !validationError && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Asset Preview</h4>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">
                    {isXLM ? 'XLM' : assetCode.slice(0, 3)}
                  </span>
                </div>
                <div>
                  <p className="text-white font-medium">{assetCode}</p>
                  {!isXLM && (
                    <p className="text-gray-500 text-xs">
                      Issuer: {assetIssuer.slice(0, 8)}...{assetIssuer.slice(-4)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Estimated Fee */}
          <div className="bg-gray-800/50 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-sm">Estimated Fee</span>
              <span className="text-white font-medium">{estimatedFee} XLM</span>
            </div>
            <p className="text-gray-500 text-xs mt-2">
              Fee may vary based on network conditions
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-6 border-t border-gray-800">
          <button
            onClick={handleClose}
            disabled={loading}
            className="flex-1 px-4 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateTrustline}
            disabled={loading || !assetCode || (!isXLM && !assetIssuer)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <CheckCircle className="w-5 h-5" />
                Add Trustline
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AddTrustlineModal;
