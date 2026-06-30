// @jest-environment node

const mockGetAccount = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockGetEvents = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const TransactionBuilder = jest.fn().mockImplementation(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue({ type: 'tx' }),
  }));
  (TransactionBuilder as any).fromXDR = jest.fn().mockReturnValue({ type: 'signedTx' });

  return {
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount: mockGetAccount,
        simulateTransaction: mockSimulateTransaction,
        getEvents: mockGetEvents,
      })),
      Api: {
        isSimulationError: jest.fn((s: any) => s && s._isError === true),
        isSimulationSuccess: jest.fn((s: any) => s && s._isSuccess === true),
        GetTransactionStatus: { SUCCESS: 'SUCCESS', FAILED: 'FAILED', NOT_FOUND: 'NOT_FOUND' },
      },
    },
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockReturnValue({ type: 'op' }),
    })),
    TransactionBuilder,
    BASE_FEE: '100',
    xdr: {
      TransactionMeta: {
        fromXDR: jest.fn().mockReturnValue({ switch: () => 0, v3: jest.fn() }),
      },
    },
  };
});

import { SmartContractReader } from '../SmartContractReader';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { ContractInvocationParams, SorobanConfig } from '../../types/soroban';

const config: SorobanConfig = { rpcUrl: 'https://soroban-testnet.stellar.org', networkPassphrase: 'Test SDF Network ; September 2015' };
const serverInstance = new (SorobanRpc.Server as any)('url');

const baseParams: ContractInvocationParams = {
  contractId: 'CTEST',
  method: 'get_value',
  args: [],
};

afterEach(() => jest.clearAllMocks());

describe('SmartContractReader', () => {
  describe('constructor', () => {
    it('creates an instance', () => {
      const reader = new SmartContractReader(serverInstance, config.networkPassphrase, config);
      expect(reader).toBeInstanceOf(SmartContractReader);
    });
  });

  describe('simulate', () => {
    it('returns success result on successful simulation', async () => {
      const fakeAccount = { id: 'GSRC', sequenceNumber: () => '1' };
      mockGetAccount.mockResolvedValueOnce(fakeAccount);
      const simResult = {
        _isSuccess: true,
        result: { retval: { type: 'scvInt64' } },
        cost: { cpuInsns: '1000', memBytes: '500' },
        minResourceFee: '100',
        events: [],
      };
      mockSimulateTransaction.mockResolvedValueOnce(simResult);
      (SorobanRpc.Api.isSimulationError as jest.Mock).mockReturnValueOnce(false);
      (SorobanRpc.Api.isSimulationSuccess as jest.Mock).mockReturnValueOnce(true);

      const reader = new SmartContractReader(serverInstance, config.networkPassphrase, config);
      const result = await reader.simulate(baseParams, 'GSRC');
      expect(result.success).toBe(true);
      expect(result.minResourceFee).toBe('100');
    });

    it('returns failure when simulation returns an error', async () => {
      mockGetAccount.mockResolvedValueOnce({ id: 'GSRC' });
      mockSimulateTransaction.mockResolvedValueOnce({ _isError: true, error: 'gas limit exceeded' });
      (SorobanRpc.Api.isSimulationError as jest.Mock).mockReturnValueOnce(true);

      const reader = new SmartContractReader(serverInstance, config.networkPassphrase, config);
      const result = await reader.simulate(baseParams, 'GSRC');
      expect(result.success).toBe(false);
      expect(result.error).toBe('gas limit exceeded');
    });

    it('returns failure when getAccount throws', async () => {
      mockGetAccount.mockRejectedValueOnce(new Error('account not found'));
      const reader = new SmartContractReader(serverInstance, config.networkPassphrase, config);
      const result = await reader.simulate(baseParams, 'GMISSING');
      expect(result.success).toBe(false);
      expect(result.error).toContain('account not found');
    });
  });

  describe('getContractEvents', () => {
    it('returns events array on success', async () => {
      const events = [{ id: 'evt1' }, { id: 'evt2' }];
      mockGetEvents.mockResolvedValueOnce({ events });
      const reader = new SmartContractReader(serverInstance, config.networkPassphrase, config);
      const result = await reader.getContractEvents('CTEST', 1, 100);
      expect(result).toHaveLength(2);
    });

    it('returns empty array on network error', async () => {
      mockGetEvents.mockRejectedValueOnce(new Error('horizon error'));
      const reader = new SmartContractReader(serverInstance, config.networkPassphrase, config);
      const result = await reader.getContractEvents('CTEST');
      expect(result).toEqual([]);
    });
  });

  describe('parseTransactionEvents', () => {
    it('returns empty array when resultMetaXdr is absent', () => {
      const reader = new SmartContractReader(serverInstance, config.networkPassphrase, config);
      const result = reader.parseTransactionEvents({} as any);
      expect(result).toEqual([]);
    });
  });
});
