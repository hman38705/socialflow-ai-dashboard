import { WalletState } from '../types';

// Simple state management without Redux dependency
let walletState: WalletState = {
  isConnected: false,
  publicKey: null,
  provider: null,
  network: 'testnet',
  xlmBalance: null,
  tokenBalances: [],
  isLoading: false,
  error: null
};

const listeners: Set<(state: WalletState) => void> = new Set();

// Load persisted state from localStorage
const loadPersistedState = (): void => {
  try {
    const persisted = localStorage.getItem('walletState');
    if (persisted) {
      const parsed = JSON.parse(persisted);
      walletState = { ...walletState, ...parsed };
    }
  } catch (error) {
    console.error('Failed to load persisted wallet state:', error);
  }
};

// Persist state to localStorage
const persistState = (): void => {
  try {
    localStorage.setItem('walletState', JSON.stringify(walletState));
  } catch (error) {
    console.error('Failed to persist wallet state:', error);
  }
};

// Notify all listeners
const notifyListeners = (): void => {
  listeners.forEach(listener => listener(walletState));
};

// Actions
export const connectWallet = async (provider: string, publicKey: string): Promise<void> => {
  walletState = {
    ...walletState,
    isLoading: true,
    error: null
  };
  notifyListeners();

  try {
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    walletState = {
      ...walletState,
      isConnected: true,
      publicKey,
      provider,
      isLoading: false,
      xlmBalance: '1000.5000000', // Mock balance
      tokenBalances: [
        { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', balance: '500.0000000' },
        { code: 'yXLM', issuer: 'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55', balance: '250.0000000' }
      ]
    };
    persistState();
    notifyListeners();
  } catch (error) {
    walletState = {
      ...walletState,
      isLoading: false,
      error: error instanceof Error ? error.message : 'Connection failed'
    };
    notifyListeners();
  }
};

export const disconnectWallet = (): void => {
  walletState = {
    isConnected: false,
    publicKey: null,
    provider: null,
    network: 'testnet',
    xlmBalance: null,
    tokenBalances: [],
    isLoading: false,
    error: null
  };
  persistState();
  notifyListeners();
};

export const switchWallet = async (provider: string, publicKey: string): Promise<void> => {
  await connectWallet(provider, publicKey);
};

export const setError = (error: string | null): void => {
  walletState = { ...walletState, error };
  notifyListeners();
};

// Selectors
export const getWalletState = (): WalletState => walletState;

export const isWalletConnected = (): boolean => walletState.isConnected;

export const getPublicKey = (): string | null => walletState.publicKey;

export const getProvider = (): string | null => walletState.provider;

// Subscribe to state changes
export const subscribe = (listener: (state: WalletState) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// Initialize
loadPersistedState();
