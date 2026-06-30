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
    },
    TransactionBuilder,
    Operation: {
      uploadContractWasm: jest.fn().mockReturnValue({ type: 'uploadWasm' }),
      createCustomContract: jest.fn().mockReturnValue({ type: 'createContract' }),
    },
    BASE_FEE: '100',
    xdr: {
      ScVal: class {},
    },
    Keypair: {
      random: jest.fn().mockReturnValue({ rawPublicKey: () => Buffer.from('salt') }),
    },
    hash: jest.fn().mockReturnValue(Buffer.from('wasm-hash')),
  };
});

import { SmartContractDeployer } from '../SmartContractDeployer';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { SorobanConfig, WasmDeploymentParams } from '../../types/soroban';

const config: SorobanConfig = { rpcUrl: 'https://soroban-testnet.stellar.org', networkPassphrase: 'Test SDF Network ; September 2015' };
const serverInstance = new (SorobanRpc.Server as any)('url');

const fakeAccount = { id: 'GSRC', sequenceNumber: () => '1' };
const fakeDeployParams: WasmDeploymentParams = { wasmBuffer: Buffer.from('wasm-binary') };
const prepTx = { toXDR: jest.fn().mockReturnValue('prep-xdr') };

afterEach(() => jest.clearAllMocks());

describe('SmartContractDeployer', () => {
  describe('constructor', () => {
    it('creates an instance', () => {
      const deployer = new SmartContractDeployer(serverInstance, config.networkPassphrase, config);
      expect(deployer).toBeInstanceOf(SmartContractDeployer);
    });
  });

  describe('deployWasm', () => {
    it('returns success with contractId on full happy path', async () => {
      mockGetAccount
        .mockResolvedValueOnce(fakeAccount)
        .mockResolvedValueOnce(fakeAccount);
      mockPrepareTransaction.mockResolvedValue(prepTx);
      mockSendTransaction
        .mockResolvedValueOnce({ status: 'PENDING', hash: 'upload-hash' })
        .mockResolvedValueOnce({ status: 'PENDING', hash: 'create-hash' });

      const signTx = jest.fn().mockResolvedValue('signed-xdr');
      const pollStatus = jest.fn().mockResolvedValue({ success: true, result: undefined });

      const deployer = new SmartContractDeployer(serverInstance, config.networkPassphrase, config);
      const result = await deployer.deployWasm(fakeDeployParams, 'GSRC', signTx, pollStatus);
      expect(result.success).toBe(true);
      expect(pollStatus).toHaveBeenCalledTimes(2);
    });

    it('returns failure when upload transaction errors', async () => {
      mockGetAccount.mockResolvedValueOnce(fakeAccount);
      mockPrepareTransaction.mockResolvedValueOnce(prepTx);
      const signTx = jest.fn().mockResolvedValue('signed-xdr');
      mockSendTransaction.mockResolvedValueOnce({ status: 'ERROR' });
      const pollStatus = jest.fn();

      const deployer = new SmartContractDeployer(serverInstance, config.networkPassphrase, config);
      const result = await deployer.deployWasm(fakeDeployParams, 'GSRC', signTx, pollStatus);
      expect(result.success).toBe(false);
      expect(result.error).toContain('upload WASM');
    });

    it('returns failure when create transaction errors', async () => {
      mockGetAccount
        .mockResolvedValueOnce(fakeAccount)
        .mockResolvedValueOnce(fakeAccount);
      mockPrepareTransaction.mockResolvedValue(prepTx);
      mockSendTransaction
        .mockResolvedValueOnce({ status: 'PENDING', hash: 'upload-hash' })
        .mockResolvedValueOnce({ status: 'ERROR' });
      const signTx = jest.fn().mockResolvedValue('signed-xdr');
      const pollStatus = jest.fn().mockResolvedValue({ success: true });

      const deployer = new SmartContractDeployer(serverInstance, config.networkPassphrase, config);
      const result = await deployer.deployWasm(fakeDeployParams, 'GSRC', signTx, pollStatus);
      expect(result.success).toBe(false);
      expect(result.error).toContain('contract instance');
    });

    it('returns failure when poll returns failure for create step', async () => {
      mockGetAccount
        .mockResolvedValueOnce(fakeAccount)
        .mockResolvedValueOnce(fakeAccount);
      mockPrepareTransaction.mockResolvedValue(prepTx);
      mockSendTransaction
        .mockResolvedValueOnce({ status: 'PENDING', hash: 'upload-hash' })
        .mockResolvedValueOnce({ status: 'PENDING', hash: 'create-hash' });
      const signTx = jest.fn().mockResolvedValue('signed-xdr');
      const pollStatus = jest.fn()
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'contract init failed' });

      const deployer = new SmartContractDeployer(serverInstance, config.networkPassphrase, config);
      const result = await deployer.deployWasm(fakeDeployParams, 'GSRC', signTx, pollStatus);
      expect(result.success).toBe(false);
      expect(result.error).toBe('contract init failed');
    });

    it('returns failure when getAccount throws', async () => {
      mockGetAccount.mockRejectedValueOnce(new Error('account missing'));
      const signTx = jest.fn();
      const pollStatus = jest.fn();

      const deployer = new SmartContractDeployer(serverInstance, config.networkPassphrase, config);
      const result = await deployer.deployWasm(fakeDeployParams, 'GMISSING', signTx, pollStatus);
      expect(result.success).toBe(false);
      expect(result.error).toContain('account missing');
    });
  });
});
