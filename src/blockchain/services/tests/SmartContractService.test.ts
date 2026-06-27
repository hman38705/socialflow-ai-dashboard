// @jest-environment node

const mockGetHealth = jest.fn();
const mockGetLatestLedger = jest.fn();
const mockGetTransaction = jest.fn();
const mockGetAccount = jest.fn();
const mockPrepareTransaction = jest.fn();
const mockSendTransaction = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockGetEvents = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const TransactionBuilder = jest.fn().mockImplementation(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnValue({ toXDR: jest.fn().mockReturnValue('tx-xdr') }),
  }));
  (TransactionBuilder as any).fromXDR = jest.fn().mockReturnValue({ type: 'signed' });

  return {
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({
        getHealth: mockGetHealth,
        getLatestLedger: mockGetLatestLedger,
        getTransaction: mockGetTransaction,
        getAccount: mockGetAccount,
        prepareTransaction: mockPrepareTransaction,
        sendTransaction: mockSendTransaction,
        simulateTransaction: mockSimulateTransaction,
        getEvents: mockGetEvents,
      })),
      Api: {
        isSimulationError: jest.fn(() => false),
        isSimulationSuccess: jest.fn(() => true),
        GetTransactionStatus: { SUCCESS: 'SUCCESS', FAILED: 'FAILED', NOT_FOUND: 'NOT_FOUND' },
        EventResponse: class {},
      },
    },
    Contract: jest.fn().mockImplementation(() => ({ call: jest.fn().mockReturnValue({ type: 'op' }) })),
    TransactionBuilder,
    BASE_FEE: '100',
    Operation: {
      uploadContractWasm: jest.fn().mockReturnValue({ type: 'upload' }),
      createCustomContract: jest.fn().mockReturnValue({ type: 'create' }),
    },
    xdr: {
      TransactionMeta: { fromXDR: jest.fn().mockReturnValue({ switch: () => 0 }) },
      ScVal: class {},
    },
    Keypair: { random: jest.fn().mockReturnValue({ rawPublicKey: () => Buffer.from('salt') }) },
    hash: jest.fn().mockReturnValue(Buffer.from('wasm-hash')),
  };
});

import { SmartContractService } from '../SmartContractService';
import { ContractCallType } from '../../types/soroban';

afterEach(() => jest.clearAllMocks());

describe('SmartContractService', () => {
  describe('constructor', () => {
    it('creates an instance for TESTNET', () => {
      const svc = new SmartContractService('TESTNET');
      expect(svc).toBeInstanceOf(SmartContractService);
    });
  });

  describe('getHealth', () => {
    it('returns status and ledger sequence on success', async () => {
      mockGetHealth.mockResolvedValueOnce({ status: 'healthy' });
      mockGetLatestLedger.mockResolvedValueOnce({ sequence: 1000 });
      const svc = new SmartContractService('TESTNET');
      const health = await svc.getHealth();
      expect(health.status).toBe('healthy');
      expect(health.ledger).toBe(1000);
    });

    it('returns error status when server is unreachable', async () => {
      mockGetHealth.mockRejectedValueOnce(new Error('connection refused'));
      const svc = new SmartContractService('TESTNET');
      const health = await svc.getHealth();
      expect(health.status).toBe('error');
    });
  });

  describe('simulate', () => {
    it('delegates to SmartContractReader.simulate and returns result', async () => {
      mockGetAccount.mockResolvedValueOnce({ id: 'GSRC' });
      mockSimulateTransaction.mockResolvedValueOnce({
        _isSuccess: true,
        result: { retval: null },
        cost: { cpuInsns: '100', memBytes: '50' },
        minResourceFee: '10',
        events: [],
      });
      const { SorobanRpc } = require('@stellar/stellar-sdk');
      SorobanRpc.Api.isSimulationError.mockReturnValueOnce(false);
      SorobanRpc.Api.isSimulationSuccess.mockReturnValueOnce(true);

      const svc = new SmartContractService('TESTNET');
      const result = await svc.simulate({ contractId: 'CTEST', method: 'get', args: [] }, 'GSRC');
      expect(result.success).toBe(true);
    });
  });

  describe('invoke — READ_ONLY', () => {
    it('returns simulation result for read-only call', async () => {
      mockGetAccount.mockResolvedValueOnce({ id: 'GSRC' });
      mockSimulateTransaction.mockResolvedValueOnce({
        _isSuccess: true,
        result: { retval: null },
        cost: { cpuInsns: '100', memBytes: '50' },
        minResourceFee: '10',
        events: [],
      });
      const { SorobanRpc } = require('@stellar/stellar-sdk');
      SorobanRpc.Api.isSimulationError.mockReturnValueOnce(false);
      SorobanRpc.Api.isSimulationSuccess.mockReturnValueOnce(true);

      const svc = new SmartContractService('TESTNET');
      const result = await svc.invoke(
        { contractId: 'CTEST', method: 'read', args: [] },
        'GSRC',
        ContractCallType.READ_ONLY,
      );
      expect(result.success).toBe(true);
    });
  });

  describe('getContractEvents', () => {
    it('returns events on success', async () => {
      mockGetEvents.mockResolvedValueOnce({ events: [{ id: 'evt1' }] });
      const svc = new SmartContractService('TESTNET');
      const events = await svc.getContractEvents('CTEST');
      expect(events).toHaveLength(1);
    });

    it('returns empty array on error', async () => {
      mockGetEvents.mockRejectedValueOnce(new Error('network error'));
      const svc = new SmartContractService('TESTNET');
      const events = await svc.getContractEvents('CTEST');
      expect(events).toEqual([]);
    });
  });
});
