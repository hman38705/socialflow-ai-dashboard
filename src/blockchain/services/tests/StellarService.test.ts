// @jest-environment node

const mockRoot = jest.fn().mockResolvedValue({ core_version: '19.10.0' });
const mockLoadAccount = jest.fn();
const mockFeeStats = jest.fn();
const mockSubmitTransaction = jest.fn();
const mockTransactions = jest.fn();

const mockServerInstance = {
  root: mockRoot,
  loadAccount: mockLoadAccount,
  feeStats: mockFeeStats,
  submitTransaction: mockSubmitTransaction,
  transactions: mockTransactions,
};

const mockTransactionBuilder = jest.fn().mockImplementation(() => ({
  addOperation: jest.fn().mockReturnThis(),
  setTimeout: jest.fn().mockReturnThis(),
  build: jest.fn().mockReturnValue({ toXDR: jest.fn().mockReturnValue('base64-xdr') }),
}));

jest.mock('@stellar/stellar-sdk', () => {
  return {
    __esModule: true,
    default: {
      Server: jest.fn().mockImplementation(() => mockServerInstance),
      TransactionBuilder: mockTransactionBuilder,
      Asset: {
        native: jest.fn().mockReturnValue({ type: 'native' }),
        ...(jest.fn().mockImplementation((code: string, issuer: string) => ({ code, issuer })) as any),
      },
      Operation: {
        createAccount: jest.fn().mockReturnValue({ type: 'createAccount' }),
        changeTrust: jest.fn().mockReturnValue({ type: 'changeTrust' }),
      },
      Transaction: class {},
      FeeBumpTransaction: class {},
    },
  };
});

// Mock OfflineQueue so StellarService constructor doesn't trigger Redis restore
jest.mock('../OfflineQueue', () => ({
  OfflineQueue: jest.fn().mockImplementation(() => ({
    restoreFromRedis: jest.fn().mockResolvedValue(undefined),
    queueTransaction: jest.fn().mockResolvedValue('tx_mock_id'),
    getQueuedTransactions: jest.fn().mockResolvedValue([]),
  })),
}));

import { StellarService } from '../StellarService';
import { DEFAULT_NETWORK } from '../../config/networks';

describe('StellarService', () => {
  let service: StellarService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFeeStats.mockResolvedValue({ base_fee: '100', fee_charged: { p99: '150' } });
    service = new StellarService(DEFAULT_NETWORK);
  });

  describe('constructor / init', () => {
    it('creates an instance with the default network', () => {
      expect(service).toBeInstanceOf(StellarService);
    });

    it('exposes the configured network', () => {
      expect(service.getNetwork()).toMatchObject({ horizonUrl: DEFAULT_NETWORK.horizonUrl });
    });
  });

  describe('setNetwork / getNetwork', () => {
    it('updates the active network', () => {
      const newConfig = { ...DEFAULT_NETWORK, horizonUrl: 'https://horizon.stellar.org', name: 'Mainnet' };
      service.setNetwork(newConfig);
      expect(service.getNetwork().horizonUrl).toBe('https://horizon.stellar.org');
    });
  });

  describe('getNetworkStatus', () => {
    it('returns true when server returns core_version', async () => {
      mockRoot.mockResolvedValueOnce({ core_version: '19.10.0' });
      expect(await service.getNetworkStatus()).toBe(true);
    });

    it('returns false when server call throws', async () => {
      mockRoot.mockRejectedValueOnce(new Error('timeout'));
      expect(await service.getNetworkStatus()).toBe(false);
    });
  });

  describe('getAccount', () => {
    it('returns account data from server', async () => {
      const fakeAccount = { id: 'GXYZ', balances: [] };
      mockLoadAccount.mockResolvedValueOnce(fakeAccount);
      const result = await service.getAccount('GXYZ');
      expect(result).toEqual(fakeAccount);
    });

    it('throws AppError when account not found', async () => {
      mockLoadAccount.mockRejectedValueOnce(new Error('Not Found'));
      await expect(service.getAccount('GBAD')).rejects.toThrow();
    });
  });

  describe('getBalances', () => {
    it('maps native XLM balance', async () => {
      mockLoadAccount.mockResolvedValueOnce({
        balances: [{ asset_type: 'native', balance: '100.5000000' }],
      });
      const balances = await service.getBalances('GXYZ');
      expect(balances[0]).toEqual({ asset: 'XLM', issuer: 'Stellar', balance: 100.5 });
    });

    it('maps non-native asset balance', async () => {
      mockLoadAccount.mockResolvedValueOnce({
        balances: [{ asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GCENTER', balance: '50.0000000' }],
      });
      const balances = await service.getBalances('GXYZ');
      expect(balances[0]).toMatchObject({ asset: 'USDC', issuer: 'GCENTER', balance: 50 });
    });
  });

  describe('getCurrentBaseFee', () => {
    it('fetches from server and caches result', async () => {
      mockFeeStats.mockResolvedValueOnce({ base_fee: '200', fee_charged: { p99: '210' } });
      const fee = await service.getCurrentBaseFee();
      expect(fee).toBe(200);
    });

    it('returns 100 fallback on fee stats error', async () => {
      mockFeeStats.mockRejectedValueOnce(new Error('network error'));
      const fee = await service.getCurrentBaseFee();
      expect(fee).toBe(100);
    });
  });

  describe('estimateFee', () => {
    it('multiplies base fee by operation count', async () => {
      mockFeeStats.mockResolvedValueOnce({ base_fee: '100', fee_charged: { p99: '110' } });
      const estimate = await service.estimateFee(3);
      expect(estimate).toBe(300);
    });
  });

  describe('parseAsset', () => {
    it('returns native asset for "xlm"', () => {
      const asset = service.parseAsset('xlm');
      expect(asset).toBeDefined();
    });

    it('throws AppError for malformed asset string', () => {
      expect(() => service.parseAsset('BADFORMAT')).toThrow();
    });

    it('throws AppError for asset code > 12 chars', () => {
      expect(() => service.parseAsset('VERYLONGCODE123:GCENTER')).toThrow();
    });
  });

  describe('submitTransaction', () => {
    it('returns server response on success', async () => {
      const fakeResponse = { hash: 'abc123', ledger: 100 };
      mockSubmitTransaction.mockResolvedValueOnce(fakeResponse);
      const mockTx = {} as any;
      const result = await service.submitTransaction(mockTx, 1);
      expect(result).toEqual(fakeResponse);
    });

    it('throws AppError after max retries exhausted', async () => {
      mockSubmitTransaction.mockRejectedValue(new Error('server error'));
      await expect(service.submitTransaction({} as any, 1)).rejects.toThrow();
    });
  });

  describe('queueForOffline', () => {
    it('delegates to OfflineQueue.queueTransaction', async () => {
      const mockTx = { toXDR: jest.fn().mockReturnValue('base64-xdr') } as any;
      const id = await service.queueForOffline(mockTx);
      expect(typeof id).toBe('string');
    });
  });

  describe('cleanupStreams', () => {
    it('does not throw when no streams are active', () => {
      expect(() => service.cleanupStreams()).not.toThrow();
    });
  });
});
