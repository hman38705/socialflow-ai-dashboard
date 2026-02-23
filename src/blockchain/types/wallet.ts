/**
 * Wallet Type Definitions and Interfaces
 * Requirements: 1.1, 1.2, 15.2
 */

export type NetworkType = 'PUBLIC' | 'TESTNET';

export interface WalletProviderMetadata {
  name: string;
  icon: string;
  description: string;
}

export enum WalletConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR'
}

export interface WalletConnection {
  publicKey: string;
  provider: string;
  network: NetworkType;
  connectedAt: number;
}

export interface SignTransactionResult {
  signedXDR: string;
  publicKey: string;
}

export interface SignAuthEntryResult {
  signature: string;
  publicKey: string;
}

export interface WalletProvider {
  metadata: WalletProviderMetadata;
  
  /**
   * Check if the wallet provider is installed in the browser
   */
  isInstalled(): boolean;
  
  /**
   * Connect to the wallet and request public key
   * @param network - The Stellar network to connect to
   * @returns Promise resolving to the public key
   */
  connect(network: NetworkType): Promise<string>;
  
  /**
   * Disconnect from the wallet
   */
  disconnect(): Promise<void>;
  
  /**
   * Get the currently connected public key
   * @returns The public key or null if not connected
   */
  getPublicKey(): string | null;
  
  /**
   * Sign a transaction XDR
   * @param xdr - The transaction XDR to sign
   * @param network - The network passphrase
   * @returns Promise resolving to signed transaction result
   */
  signTransaction(xdr: string, network: NetworkType): Promise<SignTransactionResult>;
  
  /**
   * Sign an auth entry for Stellar authentication
   * @param entry - The auth entry to sign
   * @param network - The network passphrase
   * @returns Promise resolving to signature result
   */
  signAuthEntry(entry: string, network: NetworkType): Promise<SignAuthEntryResult>;
}

export interface WalletSession {
  providerName: string;
  publicKey: string;
  network: NetworkType;
  lastActivity: number;
  connectedAt: number;
}

export enum WalletError {
  NOT_INSTALLED = 'WALLET_NOT_INSTALLED',
  USER_REJECTED = 'USER_REJECTED',
  CONNECTION_FAILED = 'CONNECTION_FAILED',
  SIGNING_FAILED = 'SIGNING_FAILED',
  SESSION_EXPIRED = 'SESSION_EXPIRED',
  INVALID_NETWORK = 'INVALID_NETWORK',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

export class WalletException extends Error {
  constructor(
    public code: WalletError,
    message: string,
    public originalError?: unknown
  ) {
    super(message);
    this.name = 'WalletException';
  }
}
