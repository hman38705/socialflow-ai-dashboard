/**
 * Freighter Wallet Provider Implementation
 * Requirements: 1.2, 1.3, 15.2
 */

import {
  WalletProvider,
  WalletProviderMetadata,
  NetworkType,
  SignTransactionResult,
  SignAuthEntryResult,
  WalletError,
  WalletException
} from '../../types/wallet';

// Freighter API types
interface FreighterAPI {
  isConnected(): Promise<boolean>;
  getPublicKey(): Promise<string>;
  signTransaction(xdr: string, options?: { network?: string; networkPassphrase?: string }): Promise<string>;
  signAuthEntry(entry: string, options?: { networkPassphrase?: string }): Promise<string>;
}

declare global {
  interface Window {
    freighter?: FreighterAPI;
  }
}

const NETWORK_PASSPHRASES = {
  PUBLIC: 'Public Global Stellar Network ; September 2015',
  TESTNET: 'Test SDF Network ; September 2015'
};

export class FreighterProvider implements WalletProvider {
  public metadata: WalletProviderMetadata = {
    name: 'Freighter',
    icon: '🚀',
    description: 'Freighter Wallet - Stellar wallet browser extension'
  };

  private connectedPublicKey: string | null = null;

  isInstalled(): boolean {
    return typeof window !== 'undefined' && typeof window.freighter !== 'undefined';
  }

  async connect(_network: NetworkType): Promise<string> {
    if (!this.isInstalled()) {
      throw new WalletException(
        WalletError.NOT_INSTALLED,
        'Freighter wallet extension is not installed. Please install it from https://freighter.app'
      );
    }

    try {
      const publicKey = await window.freighter!.getPublicKey();
      
      if (!publicKey) {
        throw new WalletException(
          WalletError.USER_REJECTED,
          'User rejected the connection request'
        );
      }

      this.connectedPublicKey = publicKey;
      
      return publicKey;
    } catch (error) {
      if (error instanceof WalletException) {
        throw error;
      }

      // Check for user rejection
      if (error instanceof Error && error.message.includes('User declined')) {
        throw new WalletException(
          WalletError.USER_REJECTED,
          'User rejected the connection request',
          error
        );
      }

      throw new WalletException(
        WalletError.CONNECTION_FAILED,
        'Failed to connect to Freighter wallet',
        error
      );
    }
  }

  async disconnect(): Promise<void> {
    this.connectedPublicKey = null;
  }

  getPublicKey(): string | null {
    return this.connectedPublicKey;
  }

  async signTransaction(xdr: string, network: NetworkType): Promise<SignTransactionResult> {
    if (!this.isInstalled()) {
      throw new WalletException(
        WalletError.NOT_INSTALLED,
        'Freighter wallet extension is not installed'
      );
    }

    if (!this.connectedPublicKey) {
      throw new WalletException(
        WalletError.CONNECTION_FAILED,
        'Wallet is not connected. Please connect first.'
      );
    }

    try {
      const networkPassphrase = NETWORK_PASSPHRASES[network];
      
      const signedXDR = await window.freighter!.signTransaction(xdr, {
        network: network.toLowerCase(),
        networkPassphrase
      });

      return {
        signedXDR,
        publicKey: this.connectedPublicKey
      };
    } catch (error) {
      // Check for user rejection
      if (error instanceof Error && (
        error.message.includes('User declined') ||
        error.message.includes('rejected')
      )) {
        throw new WalletException(
          WalletError.USER_REJECTED,
          'User rejected the transaction signing request',
          error
        );
      }

      throw new WalletException(
        WalletError.SIGNING_FAILED,
        'Failed to sign transaction with Freighter',
        error
      );
    }
  }

  async signAuthEntry(entry: string, network: NetworkType): Promise<SignAuthEntryResult> {
    if (!this.isInstalled()) {
      throw new WalletException(
        WalletError.NOT_INSTALLED,
        'Freighter wallet extension is not installed'
      );
    }

    if (!this.connectedPublicKey) {
      throw new WalletException(
        WalletError.CONNECTION_FAILED,
        'Wallet is not connected. Please connect first.'
      );
    }

    try {
      const networkPassphrase = NETWORK_PASSPHRASES[network];
      
      const signature = await window.freighter!.signAuthEntry(entry, {
        networkPassphrase
      });

      return {
        signature,
        publicKey: this.connectedPublicKey
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('User declined')) {
        throw new WalletException(
          WalletError.USER_REJECTED,
          'User rejected the auth entry signing request',
          error
        );
      }

      throw new WalletException(
        WalletError.SIGNING_FAILED,
        'Failed to sign auth entry with Freighter',
        error
      );
    }
  }
}
