/**
 * Blockchain Module Entry Point
 * Exports all wallet-related types, services, and providers
 */

// Types
export type {
  NetworkType,
  WalletProvider,
  WalletProviderMetadata,
  WalletConnection,
  WalletSession,
  SignTransactionResult,
  SignAuthEntryResult,
  WalletError,
  WalletException
} from './types/wallet';

// Services
export { WalletService, walletService } from './services/WalletService';

// Providers
export { FreighterProvider } from './services/providers/FreighterProvider';
export { AlbedoProvider } from './services/providers/AlbedoProvider';
