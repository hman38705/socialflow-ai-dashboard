/**
 * Albedo Wallet Provider Implementation
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

// Albedo API types
interface AlbedoIntent {
  intent: string;
  pubkey?: string;
  network?: string;
  tx?: string;
  submit?: boolean;
}

interface AlbedoPublicKeyResponse {
  pubkey: string;
  signed_message?: string;
}

interface AlbedoTxResponse {
  signed_envelope_xdr: string;
  tx_hash: string;
  pubkey: string;
}

interface AlbedoAPI {
  publicKey(options?: { token?: string; require_existing?: boolean }): Promise<AlbedoPublicKeyResponse>;
  tx(options: { xdr: string; network?: string; submit?: boolean; pubkey?: string }): Promise<AlbedoTxResponse>;
  signMessage(options: { message: string; pubkey?: string }): Promise<{ message_signature: string; pubkey: string }>;
  implicitFlow(intent: AlbedoIntent): Promise<any>;
}

declare global {
  interface Window {
    albedo?: AlbedoAPI;
  }
}

export class AlbedoProvider implements WalletProvider {
  public metadata: WalletProviderMetadata = {
    name: 'Albedo',
    icon: '⭐',
    description: 'Albedo - Secure Stellar wallet with intent-based API'
  };

  private connectedPublicKey: string | null = null;

  isInstalled(): boolean {
    // Albedo is loaded via CDN, check if it's available
    return typeof window !== 'undefined' && typeof window.albedo !== 'undefined';
  }

  async connect(_network: NetworkType): Promise<string> {
    if (!this.isInstalled()) {
      // Try to load Albedo dynamically
      await this.loadAlbedo();
      
      if (!this.isInstalled()) {
        throw new WalletException(
          WalletError.NOT_INSTALLED,
          'Albedo wallet is not available. Please ensure you have internet connection.'
        );
      }
    }

    try {
      // Request public key with optional account selection
      const response = await window.albedo!.publicKey({
        require_existing: false
      });

      if (!response.pubkey) {
        throw new WalletException(
          WalletError.USER_REJECTED,
          'User rejected the connection request or no account selected'
        );
      }

      this.connectedPublicKey = response.pubkey;
      
      return response.pubkey;
    } catch (error) {
      if (error instanceof WalletException) {
        throw error;
      }

      // Check for user rejection
      if (error instanceof Error && (
        error.message.includes('canceled') ||
        error.message.includes('rejected')
      )) {
        throw new WalletException(
          WalletError.USER_REJECTED,
          'User rejected the connection request',
          error
        );
      }

      throw new WalletException(
        WalletError.CONNECTION_FAILED,
        'Failed to connect to Albedo wallet',
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
        'Albedo wallet is not available'
      );
    }

    if (!this.connectedPublicKey) {
      throw new WalletException(
        WalletError.CONNECTION_FAILED,
        'Wallet is not connected. Please connect first.'
      );
    }

    try {
      const networkName = network === 'PUBLIC' ? 'public' : 'testnet';
      
      const response = await window.albedo!.tx({
        xdr,
        network: networkName,
        submit: false, // Don't auto-submit, let the app handle submission
        pubkey: this.connectedPublicKey
      });

      return {
        signedXDR: response.signed_envelope_xdr,
        publicKey: response.pubkey
      };
    } catch (error) {
      // Check for user rejection
      if (error instanceof Error && (
        error.message.includes('canceled') ||
        error.message.includes('rejected') ||
        error.message.includes('denied')
      )) {
        throw new WalletException(
          WalletError.USER_REJECTED,
          'User rejected the transaction signing request',
          error
        );
      }

      throw new WalletException(
        WalletError.SIGNING_FAILED,
        'Failed to sign transaction with Albedo',
        error
      );
    }
  }

  async signAuthEntry(entry: string, _network: NetworkType): Promise<SignAuthEntryResult> {
    if (!this.isInstalled()) {
      throw new WalletException(
        WalletError.NOT_INSTALLED,
        'Albedo wallet is not available'
      );
    }

    if (!this.connectedPublicKey) {
      throw new WalletException(
        WalletError.CONNECTION_FAILED,
        'Wallet is not connected. Please connect first.'
      );
    }

    try {
      // Use signMessage for auth entry signing
      const response = await window.albedo!.signMessage({
        message: entry,
        pubkey: this.connectedPublicKey
      });

      return {
        signature: response.message_signature,
        publicKey: response.pubkey
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('canceled')) {
        throw new WalletException(
          WalletError.USER_REJECTED,
          'User rejected the auth entry signing request',
          error
        );
      }

      throw new WalletException(
        WalletError.SIGNING_FAILED,
        'Failed to sign auth entry with Albedo',
        error
      );
    }
  }

  /**
   * Dynamically load Albedo SDK from CDN
   */
  private async loadAlbedo(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined') {
        reject(new Error('Window is not defined'));
        return;
      }

      // Check if already loaded
      if (window.albedo) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@albedo-link/intent@latest/lib/albedo.intent.js';
      script.async = true;
      
      script.onload = () => {
        // Wait a bit for the library to initialize
        setTimeout(() => {
          if (window.albedo) {
            resolve();
          } else {
            reject(new Error('Albedo failed to initialize'));
          }
        }, 100);
      };
      
      script.onerror = () => {
        reject(new Error('Failed to load Albedo SDK'));
      };

      document.head.appendChild(script);
    });
  }
}
