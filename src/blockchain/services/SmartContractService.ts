import {
    SorobanRpc,
} from '@stellar/stellar-sdk';
import {
    ContractInvocationParams,
    ContractSimulationResult,
    ContractInvocationResult,
    WasmDeploymentParams,
    WasmDeploymentResult,
    SorobanConfig,
    ContractCallType,
} from '../types/soroban';
import { SOROBAN_NETWORKS, STELLAR_POLL_TIMEOUT_MS } from '../config/soroban.config';
import { SmartContractDeployer } from './SmartContractDeployer';
import { SmartContractInvoker } from './SmartContractInvoker';
import { SmartContractReader } from './SmartContractReader';

/**
 * SmartContractService - Facade for Soroban smart contract interactions
 * 
 * Delegates to focused modules:
 * - SmartContractDeployer: WASM deployment
 * - SmartContractInvoker: Contract method invocation
 * - SmartContractReader: State reading and simulation
 */
export class SmartContractService {
    private server: SorobanRpc.Server;
    private config: SorobanConfig;
    private networkPassphrase: string;
    private deployer: SmartContractDeployer;
    private invoker: SmartContractInvoker;
    private reader: SmartContractReader;

    constructor(network: 'TESTNET' | 'MAINNET' | 'FUTURENET' = 'TESTNET') {
        this.config = SOROBAN_NETWORKS[network];
        this.server = new SorobanRpc.Server(this.config.rpcUrl, {
            allowHttp: network !== 'MAINNET',
        });
        this.networkPassphrase = this.config.networkPassphrase;
        this.deployer = new SmartContractDeployer(this.server, this.networkPassphrase, this.config);
        this.invoker = new SmartContractInvoker(this.server, this.networkPassphrase, this.config);
        this.reader = new SmartContractReader(this.server, this.networkPassphrase, this.config);
    }

    /**
     * Simulate a contract invocation (read-only)
     */
    async simulate(
        params: ContractInvocationParams,
        sourceAccount: string
    ): Promise<ContractSimulationResult> {
        return this.reader.simulate(params, sourceAccount);
    }

    /**
     * Invoke a contract method
     */
    async invoke(
        params: ContractInvocationParams,
        sourceAccount: string,
        callType: ContractCallType = ContractCallType.READ_ONLY,
        signTransaction?: (xdr: string) => Promise<string>
    ): Promise<ContractInvocationResult> {
        return this.invoker.invoke(
            params,
            sourceAccount,
            callType,
            signTransaction,
            (p, s) => this.simulate(p, s),
            (h) => this.pollTransactionStatus(h)
        );
    }

    /**
     * Deploy WASM contract (admin function)
     */
    async deployWasm(
        params: WasmDeploymentParams,
        sourceAccount: string,
        signTransaction: (xdr: string) => Promise<string>
    ): Promise<WasmDeploymentResult> {
        return this.deployer.deployWasm(
            params,
            sourceAccount,
            signTransaction,
            (h) => this.pollTransactionStatus(h)
        );
    }

    /**
     * Get contract events by filter
     */
    async getContractEvents(
        contractId: string,
        startLedger?: number,
        endLedger?: number
    ): Promise<SorobanRpc.Api.EventResponse[]> {
        return this.reader.getContractEvents(contractId, startLedger, endLedger);
    }

    /**
     * Get current network health
     */
    async getHealth(): Promise<{ status: string; ledger?: number }> {
        try {
            const health = await this.server.getHealth();
            const latestLedger = await this.server.getLatestLedger();

            return {
                status: health.status,
                ledger: latestLedger.sequence,
            };
        } catch (error) {
            return {
                status: 'error',
            };
        }
    }

    /**
     * Poll transaction status until it's confirmed or fails
     */
    private async pollTransactionStatus(
        txHash: string,
        maxAttempts: number = 10
    ): Promise<ContractInvocationResult> {
        let attempts = 0;
        const startTime = Date.now();

        while (attempts < maxAttempts) {
            if (Date.now() - startTime > STELLAR_POLL_TIMEOUT_MS) {
                return {
                    success: false,
                    error: `Transaction polling timeout exceeded (${STELLAR_POLL_TIMEOUT_MS}ms). Transaction may be stuck in mempool.`,
                    errorType: 'SERVICE_UNAVAILABLE',
                };
            }

            try {
                const txResponse = await this.server.getTransaction(txHash);

                if (txResponse.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
                    const events = this.reader.parseTransactionEvents(txResponse);

                    return {
                        success: true,
                        transactionHash: txHash,
                        result: txResponse.returnValue,
                        events,
                    };
                }

                if (txResponse.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
                    return {
                        success: false,
                        transactionHash: txHash,
                        error: 'Transaction failed',
                        errorType: 'TRANSACTION_FAILED',
                    };
                }

                await new Promise((resolve) => setTimeout(resolve, 1000));
                attempts++;
            } catch (error) {
                attempts++;
                if (attempts >= maxAttempts) {
                    return {
                        success: false,
                        error: 'Transaction polling timeout',
                        errorType: 'SERVICE_UNAVAILABLE',
                    };
                }
            }
        }

        return {
            success: false,
            error: 'Transaction confirmation timeout',
            errorType: 'SERVICE_UNAVAILABLE',
        };
    }
}

// Export singleton instance for testnet
export const sorobanService = new SmartContractService('TESTNET');
