/**
 * Main Wallet Service Orchestrator
 * Requirements: 1.1, 1.2, 1.7, 15.2, 15.3, 15.4, 15.5
 */

import {
  WalletProvider,
  WalletConnection,
  NetworkType,
  SignTransactionResult,
  SignAuthEntryResult,
  WalletSession,
  WalletError,
  WalletException
} from '../types/wallet';
import { FreighterProvider } from './providers/FreighterProvider';
import { AlbedoProvider } from './providers/AlbedoProvider';

const SESSION_STORAGE_KEY = 'socialflow_wallet_session';
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class WalletService {
  private providers: Map<string, WalletProvider> = new Map();
  private activeConnection: WalletConnection | null = null;
  private sessionCheckInterval: NodeJS.Timeout | null = null;
  private activityTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.registerProviders();
    this.startSessionMonitoring();
  }

  /**
   * Register all available wallet providers
   */
  private registerProviders(): void {
    const freighter = new FreighterProvider();
    const albedo = new AlbedoProvider();

    this.providers.set(freighter.metadata.name, freighter);
    this.providers.set(albedo.metadata.name, albedo);
  }

  /**
   * Get list of all available (installed) wallet providers
   * Requirements: 1.2
   */
  getAvailableProviders(): Array<{ name: string; metadata: any; isInstalled: boolean }> {
    return Array.from(this.providers.entries()).map(([name, provider]) => ({
      name,
      metadata: provider.metadata,
      isInstalled: provider.isInstalled()
    }));
  }

  /**
   * Connect to a specific wallet provider
   * Requirements: 1.2, 1.7
   */
  async connectWallet(providerName: string, network: NetworkType = 'TESTNET'): Promise<WalletConnection> {
    const provider = this.providers.get(providerName);

    if (!provider) {
      throw new WalletException(
        WalletError.UNKNOWN_ERROR,
        `Wallet provider '${providerName}' not found`
      );
    }

    if (!provider.isInstalled()) {
      throw new WalletException(
        WalletError.NOT_INSTALLED,
        `${providerName} wallet is not installed`
      );
    }

    try {
      const publicKey = await provider.connect(network);

      this.activeConnection = {
        publicKey,
        provider: providerName,
        network,
        connectedAt: Date.now()
      };

      // Save session
      await this.saveSession();

      // Reset activity timeout
      this.resetActivityTimeout();

      return this.activeConnection;
    } catch (error) {
      if (error instanceof WalletException) {
        throw error;
      }
      throw new WalletException(
        WalletError.CONNECTION_FAILED,
        `Failed to connect to ${providerName}`,
        error
      );
    }
  }

  /**
   * Disconnect from the current wallet
   * Requirements: 1.2
   */
  async disconnectWallet(): Promise<void> {
    if (!this.activeConnection) {
      return;
    }

    const provider = this.providers.get(this.activeConnection.provider);
    if (provider) {
      await provider.disconnect();
    }

    this.activeConnection = null;
    this.clearSession();
    this.clearActivityTimeout();
  }

  /**
   * Switch to a different wallet provider
   * Requirements: 1.7
   */
  async switchWallet(providerName: string, network?: NetworkType): Promise<WalletConnection> {
    await this.disconnectWallet();
    return this.connectWallet(providerName, network || 'TESTNET');
  }

  /**
   * Get the current active wallet connection
   * Requirements: 1.7
   */
  getActiveConnection(): WalletConnection | null {
    return this.activeConnection;
  }

  /**
   * Sign a transaction with the active wallet
   */
  async signTransaction(xdr: string): Promise<SignTransactionResult> {
    this.validateActiveConnection();
    this.refreshActivity();

    const provider = this.providers.get(this.activeConnection!.provider);
    if (!provider) {
      throw new WalletException(
        WalletError.CONNECTION_FAILED,
        'Wallet provider not found'
      );
    }

    return provider.signTransaction(xdr, this.activeConnection!.network);
  }

  /**
   * Sign an auth entry with the active wallet
   */
  async signAuthEntry(entry: string): Promise<SignAuthEntryResult> {
    this.validateActiveConnection();
    this.refreshActivity();

    const provider = this.providers.get(this.activeConnection!.provider);
    if (!provider) {
      throw new WalletException(
        WalletError.CONNECTION_FAILED,
        'Wallet provider not found'
      );
    }

    return provider.signAuthEntry(entry, this.activeConnection!.network);
  }

  /**
   * Save session to encrypted localStorage
   * Requirements: 1.6, 15.5
   */
  private async saveSession(): Promise<void> {
    if (!this.activeConnection) {
      return;
    }

    const session: WalletSession = {
      providerName: this.activeConnection.provider,
      publicKey: this.activeConnection.publicKey,
      network: this.activeConnection.network,
      lastActivity: Date.now(),
      connectedAt: this.activeConnection.connectedAt
    };

    try {
      const encrypted = this.encryptSession(session);
      localStorage.setItem(SESSION_STORAGE_KEY, encrypted);
    } catch (error) {
      console.error('Failed to save wallet session:', error);
    }
  }

  /**
   * Load session from localStorage and attempt reconnection
   * Requirements: 1.6
   */
  async loadSession(): Promise<boolean> {
    try {
      const encrypted = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!encrypted) {
        return false;
      }

      const session = this.decryptSession(encrypted);
      
      // Check if session is expired
      if (this.isSessionExpired(session)) {
        this.clearSession();
        return false;
      }

      // Attempt to reconnect
      const connection = await this.connectWallet(session.providerName, session.network);
      
      // Verify the public key matches
      if (connection.publicKey !== session.publicKey) {
        console.warn('Session public key mismatch, clearing session');
        await this.disconnectWallet();
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to load wallet session:', error);
      this.clearSession();
      return false;
    }
  }

  /**
   * Clear session from storage
   */
  private clearSession(): void {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  /**
   * Check if session has expired
   * Requirements: 15.3, 15.4
   */
  private isSessionExpired(session: WalletSession): boolean {
    const now = Date.now();
    return (now - session.lastActivity) > SESSION_TIMEOUT_MS;
  }

  /**
   * Refresh session activity timestamp
   * Requirements: 15.3
   */
  private refreshActivity(): void {
    if (this.activeConnection) {
      this.saveSession();
      this.resetActivityTimeout();
    }
  }

  /**
   * Start monitoring session timeout
   * Requirements: 15.3, 15.4
   */
  private startSessionMonitoring(): void {
    // Check session every minute
    this.sessionCheckInterval = setInterval(() => {
      if (this.activeConnection) {
        const encrypted = localStorage.getItem(SESSION_STORAGE_KEY);
        if (encrypted) {
          const session = this.decryptSession(encrypted);
          if (this.isSessionExpired(session)) {
            console.log('Session expired due to inactivity');
            this.disconnectWallet();
          }
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Reset the activity timeout
   * Requirements: 15.3, 15.4
   */
  private resetActivityTimeout(): void {
    this.clearActivityTimeout();
    
    this.activityTimeout = setTimeout(() => {
      console.log('Session timeout reached, disconnecting wallet');
      this.disconnectWallet();
    }, SESSION_TIMEOUT_MS);
  }

  /**
   * Clear the activity timeout
   */
  private clearActivityTimeout(): void {
    if (this.activityTimeout) {
      clearTimeout(this.activityTimeout);
      this.activityTimeout = null;
    }
  }

  /**
   * Validate that there is an active connection
   */
  private validateActiveConnection(): void {
    if (!this.activeConnection) {
      throw new WalletException(
        WalletError.CONNECTION_FAILED,
        'No active wallet connection. Please connect a wallet first.'
      );
    }
  }

  /**
   * Simple encryption for session data
   * Note: In production, use proper encryption library
   * Requirements: 15.5
   */
  private encryptSession(session: WalletSession): string {
    const json = JSON.stringify(session);
    // Simple base64 encoding - in production use proper encryption
    return btoa(json);
  }

  /**
   * Simple decryption for session data
   * Requirements: 15.5
   */
  private decryptSession(encrypted: string): WalletSession {
    try {
      const json = atob(encrypted);
      return JSON.parse(json);
    } catch (error) {
      throw new WalletException(
        WalletError.UNKNOWN_ERROR,
        'Failed to decrypt session data',
        error
      );
    }
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.sessionCheckInterval) {
      clearInterval(this.sessionCheckInterval);
    }
    this.clearActivityTimeout();
  }
}

// Export singleton instance
export const walletService = new WalletService();
