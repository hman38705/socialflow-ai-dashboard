import React, { useState } from 'react';
import { WalletConnectionStatus } from '../../src/blockchain/types/wallet';
import { connectWallet, setError } from '../../store/blockchainSlice';

// Local interface matching structure used in modal
interface LocalProvider {
  id: string;
  name: string;
  description: string;
  icon: string;
  installed: boolean;
  installUrl?: string;
}

const MaterialIcon = ({ name, className }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

interface WalletConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const WALLET_PROVIDERS: LocalProvider[] = [
  {
    id: 'freighter',
    name: 'Freighter',
    description: 'Stellar wallet browser extension',
    icon: '🚀',
    installed: typeof window !== 'undefined' && !!(window as any).freighter,
    installUrl: 'https://www.freighter.app/'
  },
  {
    id: 'albedo',
    name: 'Albedo',
    description: 'Web-based Stellar wallet',
    icon: '🌟',
    installed: true // Albedo is web-based, always available
  },
  {
    id: 'rabet',
    name: 'Rabet',
    description: 'Stellar & Soroban wallet',
    icon: '🦊',
    installed: typeof window !== 'undefined' && !!(window as any).rabet,
    installUrl: 'https://rabet.io/'
  },
  {
    id: 'xbull',
    name: 'xBull',
    description: 'Multi-chain wallet with Stellar support',
    icon: '🐂',
    installed: typeof window !== 'undefined' && !!(window as any).xBullSDK,
    installUrl: 'https://xbull.app/'
  }
];

export const WalletConnectModal: React.FC<WalletConnectModalProps> = ({ isOpen, onClose }) => {
  const [connectionStatus, setConnectionStatus] = useState<WalletConnectionStatus>(
    WalletConnectionStatus.DISCONNECTED
  );
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConnect = async (provider: LocalProvider) => {
    if (!provider.installed) return;

    setSelectedProvider(provider.id);
    setConnectionStatus(WalletConnectionStatus.CONNECTING);
    setErrorMessage(null);

    try {
      let publicKey: string | null = null;

      // Simulate wallet connection based on provider
      switch (provider.id) {
        case 'freighter':
          if ((window as any).freighter) {
            const result = await (window as any).freighter.getPublicKey();
            publicKey = result;
          }
          break;
        case 'albedo':
          // Mock Albedo connection
          publicKey = 'GBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
          break;
        case 'rabet':
          if ((window as any).rabet) {
            const result = await (window as any).rabet.connect();
            publicKey = result.publicKey;
          }
          break;
        case 'xbull':
          // Mock xBull connection
          publicKey = 'GCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
          break;
      }

      if (!publicKey) {
        throw new Error('Failed to retrieve public key');
      }

      await connectWallet(provider.id, publicKey);
      setConnectedAddress(publicKey);
      setConnectionStatus(WalletConnectionStatus.CONNECTED);

      // Auto-close after 1.5 seconds
      setTimeout(() => {
        onClose();
        resetModal();
      }, 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      setErrorMessage(message);
      setError(message);
      setConnectionStatus(WalletConnectionStatus.ERROR);
    }
  };

  const handleRetry = () => {
    const provider = WALLET_PROVIDERS.find(p => p.id === selectedProvider);
    if (provider) {
      handleConnect(provider);
    }
  };

  const resetModal = () => {
    setConnectionStatus(WalletConnectionStatus.DISCONNECTED);
    setSelectedProvider(null);
    setErrorMessage(null);
    setConnectedAddress(null);
  };

  const handleClose = () => {
    onClose();
    setTimeout(resetModal, 300);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-dark-surface border border-dark-border rounded-3xl shadow-2xl w-full max-w-md mx-4 animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-dark-border">
          <h2 className="text-xl font-semibold text-white">Connect Wallet</h2>
          <button
            onClick={handleClose}
            className="text-gray-subtext hover:text-white transition-colors"
          >
            <MaterialIcon name="close" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {connectionStatus === WalletConnectionStatus.DISCONNECTED && (
            <div className="space-y-3">
              <p className="text-sm text-gray-subtext mb-4">
                Choose a wallet provider to connect to the Stellar network
              </p>
              {WALLET_PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => handleConnect(provider)}
                  disabled={!provider.installed}
                  className={`w-full p-4 rounded-xl border transition-all text-left ${
                    provider.installed
                      ? 'border-dark-border bg-dark-bg hover:border-primary-blue hover:bg-primary-blue/5 cursor-pointer'
                      : 'border-dark-border bg-dark-bg/50 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="text-3xl">{provider.icon}</div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-white">{provider.name}</h3>
                        {!provider.installed && (
                          <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded-full">
                            Not Installed
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-subtext mt-0.5">{provider.description}</p>
                      {!provider.installed && provider.installUrl && (
                        <a
                          href={provider.installUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs text-primary-blue hover:underline mt-1 inline-block"
                        >
                          Install Extension →
                        </a>
                      )}
                    </div>
                    {provider.installed && (
                      <MaterialIcon name="arrow_forward" className="text-gray-subtext" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {connectionStatus === WalletConnectionStatus.CONNECTING && (
            <div className="py-12 text-center">
              <div className="inline-block animate-spin text-primary-blue mb-4">
                <MaterialIcon name="progress_activity" className="text-5xl" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Connecting...</h3>
              <p className="text-sm text-gray-subtext">
                Please approve the connection in your wallet
              </p>
            </div>
          )}

          {connectionStatus === WalletConnectionStatus.ERROR && (
            <div className="py-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-red-500/10 rounded-full mb-4">
                <MaterialIcon name="error" className="text-3xl text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Connection Failed</h3>
              <p className="text-sm text-gray-subtext mb-6">{errorMessage}</p>
              <div className="flex gap-3">
                <button
                  onClick={handleClose}
                  className="flex-1 px-4 py-2.5 bg-dark-bg border border-dark-border text-white rounded-xl hover:bg-dark-border transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleRetry}
                  className="flex-1 px-4 py-2.5 bg-primary-blue text-white rounded-xl hover:bg-primary-blue/90 transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {connectionStatus === WalletConnectionStatus.CONNECTED && connectedAddress && (
            <div className="py-8 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-500/10 rounded-full mb-4">
                <MaterialIcon name="check_circle" className="text-3xl text-green-400" />
              </div>
              <h3 className="text-lg font-semibold text-white mb-2">Connected!</h3>
              <p className="text-sm text-gray-subtext mb-2">Wallet address:</p>
              <p className="text-xs font-mono text-primary-blue bg-dark-bg px-3 py-2 rounded-lg break-all">
                {connectedAddress}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
