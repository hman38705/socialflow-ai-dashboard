// @jest-environment node

const mockGetAccount = jest.fn();
const mockPrepareTransaction = jest.fn();
const mockSendTransaction = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const TransactionBuilder = jest.fn().mockImplementation(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue({ toXDR: jest.fn().mockReturnValue('unsigned-xdr') }),
  }));
  (TransactionBuilder as any).fromXDR = jest.fn().mockReturnValue({ type: 'signedTx' });

  return {
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount: mockGetAccount,
        prepareTransaction: mockPrepareTransaction,
        sendTransaction: mockSendTransaction,
      })),
      Api: {
        GetTransactionStatus: { SUCCESS: 'SUCCESS', FAILED: 'FAILED' },
      },
    },
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockReturnValue({ type: 'op' }),
    })),
    TransactionBuilder,
    BASE_FEE: '100',
  };
});

import { SmartContractInvoker } from '../SmartContractInvoker';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { ContractCallType, ContractInvocationParams, SorobanConfig } from '../../types/soroban';

const config: SorobanConfig = { rpcUrl: 'https://soroban-testnet.stellar.org', networkPassphrase: 'Test SDF Network ; September 2015' };
const serverInstance = new (SorobanRpc.Server as any)('url');

const baseParams: ContractInvocationParams = { contractId: 'CTEST', method: 'transfer', args: [] };

afterEach(() => jest.clearAllMocks());

describe('SmartContractInvoker', () => {
  describe('constructor', () => {
    it('creates an instance', () => {
      const invoker = new SmartContractInvoker(serverInstance, config.networkPassphrase, config);
      expect(invoker).toBeInstanceOf(SmartContractInvoker);
    });
  });

  describe('invoke — READ_ONLY', () => {
    it('returns simulation result for read-only call', async () => {
      const simResult = { success: true, result: 'val', events: [] };
      const simulate = jest.fn().mockResolvedValue(simResult);
      const invoker = new SmartContractInvoker(serverInstance, config.networkPassphrase, config);
      const result = await invoker.invoke(baseParams, 'GSRC', ContractCallType.READ_ONLY, undefined, simulate);
      expect(result.success).toBe(true);
      expect(result.result).toBe('val');
    });

    it('returns failure when simulation fails', async () => {
      const simulate = jest.fn().mockResolvedValue({ success: false, error: 'gas exceeded' });
      const invoker = new SmartContractInvoker(serverInstance, config.networkPassphrase, config);
      const result = await invoker.invoke(baseParams, 'GSRC', ContractCallType.READ_ONLY, undefined, simulate);
      expect(result.success).toBe(false);
      expect(result.errorType).toBe('SIMULATION_FAILED');
    });

    it('returns error when simulate function is not provided', async () => {
      const invoker = new SmartContractInvoker(serverInstance, config.networkPassphrase, config);
      const result = await invoker.invoke(baseParams, 'GSRC', ContractCallType.READ_ONLY);
      expect(result.success).toBe(false);
      expect(result.errorType).toBe('SIMULATION_FAILED');
    });
  });

  describe('invoke — STATE_CHANGING', () => {
    it('returns error when signTransaction is missing', async () => {
      const simulate = jest.fn().mockResolvedValue({ success: true });
      const invoker = new SmartContractInvoker(serverInstance, config.networkPassphrase, config);
      const result = await invoker.invoke(baseParams, 'GSRC', ContractCallType.STATE_CHANGING, undefined, simulate);
      expect(result.success).toBe(false);
      expect(result.error).toContain('ERR_AUTH_REQUIRED');
    });

    it('submits transaction and returns poll result on success', async () => {
      const simulate = jest.fn().mockResolvedValue({ success: true });
      const signTx = jest.fn().mockResolvedValue('signed-xdr');
      const pollResult = { success: true, transactionHash: 'abc123' };
      const poll = jest.fn().mockResolvedValue(pollResult);
      mockGetAccount.mockResolvedValueOnce({ id: 'GSRC', sequenceNumber: () => '1' });
      const prepTx = { toXDR: jest.fn().mockReturnValue('prep-xdr') };
      mockPrepareTransaction.mockResolvedValueOnce(prepTx);
      mockSendTransaction.mockResolvedValueOnce({ status: 'PENDING', hash: 'abc123' });

      const invoker = new SmartContractInvoker(serverInstance, config.networkPassphrase, config);
      const result = await invoker.invoke(baseParams, 'GSRC', ContractCallType.STATE_CHANGING, signTx, simulate, poll);
      expect(result.success).toBe(true);
      expect(result.transactionHash).toBe('abc123');
    });

    it('returns TRANSACTION_FAILED when server returns ERROR status', async () => {
      const simulate = jest.fn().mockResolvedValue({ success: true });
      const signTx = jest.fn().mockResolvedValue('signed-xdr');
      const poll = jest.fn();
      mockGetAccount.mockResolvedValueOnce({ id: 'GSRC' });
      const prepTx = { toXDR: jest.fn().mockReturnValue('prep-xdr') };
      mockPrepareTransaction.mockResolvedValueOnce(prepTx);
      mockSendTransaction.mockResolvedValueOnce({ status: 'ERROR', errorResult: { toXDR: jest.fn().mockReturnValue('err-xdr') } });

      const invoker = new SmartContractInvoker(serverInstance, config.networkPassphrase, config);
      const result = await invoker.invoke(baseParams, 'GSRC', ContractCallType.STATE_CHANGING, signTx, simulate, poll);
      expect(result.success).toBe(false);
      expect(result.errorType).toBe('TRANSACTION_FAILED');
    });

    it('returns OUT_OF_GAS error type for out-of-gas exceptions', async () => {
      const simulate = jest.fn().mockResolvedValue({ success: true });
      const signTx = jest.fn().mockResolvedValue('signed-xdr');
      const poll = jest.fn();
      mockGetAccount.mockResolvedValueOnce({ id: 'GSRC' });
      mockPrepareTransaction.mockRejectedValueOnce(new Error('out of gas: insufficient budget'));

      const invoker = new SmartContractInvoker(serverInstance, config.networkPassphrase, config);
      const result = await invoker.invoke(baseParams, 'GSRC', ContractCallType.STATE_CHANGING, signTx, simulate, poll);
      expect(result.success).toBe(false);
      expect(result.errorType).toBe('OUT_OF_GAS');
    });
  });
});
