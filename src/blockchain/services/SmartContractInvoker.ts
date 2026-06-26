import {
    SorobanRpc,
    Contract,
    TransactionBuilder,
    BASE_FEE,
} from '@stellar/stellar-sdk';
import {
    ContractInvocationParams,
    ContractInvocationResult,
    ContractCallType,
    SorobanConfig,
} from '../types/soroban';
import { DEFAULT_TIMEOUT } from '../config/soroban.config';

/**
 * SmartContractInvoker - Handles contract method invocation
 */
export class SmartContractInvoker {
    constructor(
        private server: SorobanRpc.Server,
        private networkPassphrase: string,
        private config: SorobanConfig
    ) {}

    /**
     * Invoke a contract method (helper for both read-only and state-changing calls)
     */
    async invoke(
        params: ContractInvocationParams,
        sourceAccount: string,
        callType: ContractCallType = ContractCallType.READ_ONLY,
        signTransaction?: (xdr: string) => Promise<string>,
        simulate?: (params: ContractInvocationParams, sourceAccount: string) => Promise<any>,
        pollTransactionStatus?: (txHash: string) => Promise<ContractInvocationResult>
    ): Promise<ContractInvocationResult> {
        try {
            // Step 1: Simulate to get resource usage
            if (!simulate) {
                return {
                    success: false,
                    error: 'Simulate function required',
                    errorType: 'SIMULATION_FAILED',
                };
            }

            const simulationResult = await simulate(params, sourceAccount);

            if (!simulationResult.success) {
                return {
                    success: false,
                    error: simulationResult.error,
                    errorType: 'SIMULATION_FAILED',
                };
            }

            // For read-only calls, return simulation result
            if (callType === ContractCallType.READ_ONLY) {
                return {
                    success: true,
                    result: simulationResult.result,
                    events: simulationResult.events,
                };
            }

            // Step 2: For state-changing calls, prepare and submit transaction
            if (!signTransaction || !pollTransactionStatus) {
                return {
                    success: false,
                    error: 'ERR_AUTH_REQUIRED: Sign transaction function required for state-changing calls',
                    errorType: 'TRANSACTION_FAILED',
                };
            }

            const contract = new Contract(params.contractId);
            const account = await this.server.getAccount(sourceAccount);

            // Build transaction with proper resource limits
            let transaction = new TransactionBuilder(account, {
                fee: BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(contract.call(params.method, ...params.args))
                .setTimeout(DEFAULT_TIMEOUT)
                .build();

            // Prepare transaction with simulation results
            const preparedTx = await this.server.prepareTransaction(transaction);

            // Step 3: Request wallet signature
            const signedXdr = await signTransaction(preparedTx.toXDR());
            const signedTransaction = TransactionBuilder.fromXDR(
                signedXdr,
                this.networkPassphrase
            );

            // Step 4: Submit transaction
            const response = await this.server.sendTransaction(signedTransaction);

            if (response.status === 'ERROR') {
                return {
                    success: false,
                    error: response.errorResult?.toXDR('base64'),
                    errorType: 'TRANSACTION_FAILED',
                };
            }

            // Step 5: Wait for transaction confirmation
            const txHash = response.hash;
            const txResult = await pollTransactionStatus(txHash);

            return txResult;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            // Check for out-of-gas errors
            if (errorMessage.includes('out of gas') || errorMessage.includes('insufficient')) {
                return {
                    success: false,
                    error: errorMessage,
                    errorType: 'OUT_OF_GAS',
                };
            }

            return {
                success: false,
                error: errorMessage,
                errorType: 'UNKNOWN',
            };
        }
    }
}
