import {
    SorobanRpc,
    TransactionBuilder,
    Operation,
    BASE_FEE,
    xdr,
    Keypair,
    hash,
} from '@stellar/stellar-sdk';
import {
    WasmDeploymentParams,
    WasmDeploymentResult,
    SorobanConfig,
} from '../types/soroban';
import { DEFAULT_TIMEOUT } from '../config/soroban.config';

/**
 * SmartContractDeployer - Handles WASM contract deployment
 */
export class SmartContractDeployer {
    constructor(
        private server: SorobanRpc.Server,
        private networkPassphrase: string,
        private config: SorobanConfig
    ) {}

    /**
     * Deploy WASM contract (admin function)
     */
    async deployWasm(
        params: WasmDeploymentParams,
        sourceAccount: string,
        signTransaction: (xdr: string) => Promise<string>,
        pollTransactionStatus: (txHash: string) => Promise<any>
    ): Promise<WasmDeploymentResult> {
        try {
            const account = await this.server.getAccount(sourceAccount);

            // Step 1: Upload WASM
            const wasmHash = hash(params.wasmBuffer);

            const uploadOp = Operation.uploadContractWasm({
                wasm: params.wasmBuffer,
            });

            let uploadTx = new TransactionBuilder(account, {
                fee: BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(uploadOp)
                .setTimeout(DEFAULT_TIMEOUT)
                .build();

            // Prepare and sign upload transaction
            const preparedUploadTx = await this.server.prepareTransaction(uploadTx);
            const signedUploadXdr = await signTransaction(preparedUploadTx.toXDR());
            const signedUploadTx = TransactionBuilder.fromXDR(
                signedUploadXdr,
                this.networkPassphrase
            );

            // Submit upload transaction
            const uploadResponse = await this.server.sendTransaction(signedUploadTx);

            if (uploadResponse.status === 'ERROR') {
                return {
                    success: false,
                    error: 'Failed to upload WASM',
                };
            }

            // Wait for upload confirmation
            await pollTransactionStatus(uploadResponse.hash);

            // Step 2: Create contract instance
            const salt = params.salt || Buffer.from(Keypair.random().rawPublicKey());

            const createOp = Operation.createCustomContract({
                wasmHash,
                salt,
            });

            // Refresh account sequence
            const refreshedAccount = await this.server.getAccount(sourceAccount);

            let createTx = new TransactionBuilder(refreshedAccount, {
                fee: BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(createOp)
                .setTimeout(DEFAULT_TIMEOUT)
                .build();

            // Prepare and sign create transaction
            const preparedCreateTx = await this.server.prepareTransaction(createTx);
            const signedCreateXdr = await signTransaction(preparedCreateTx.toXDR());
            const signedCreateTx = TransactionBuilder.fromXDR(
                signedCreateXdr,
                this.networkPassphrase
            );

            // Submit create transaction
            const createResponse = await this.server.sendTransaction(signedCreateTx);

            if (createResponse.status === 'ERROR') {
                return {
                    success: false,
                    error: 'Failed to create contract instance',
                };
            }

            // Wait for creation confirmation
            const createResult = await pollTransactionStatus(createResponse.hash);

            if (!createResult.success) {
                return {
                    success: false,
                    error: createResult.error,
                };
            }

            // Extract contract ID from result
            const contractId = this.extractContractId(createResult.result);

            return {
                success: true,
                contractId,
                wasmHash: wasmHash.toString('hex'),
                transactionHash: createResponse.hash,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown deployment error',
            };
        }
    }

    /**
     * Extract contract ID from deployment result
     */
    private extractContractId(result?: xdr.ScVal): string | undefined {
        try {
            if (!result) return undefined;

            if (result.switch().name === 'scvAddress') {
                const address = result.address();
                if (address.switch().name === 'scAddressTypeContract') {
                    return address.contractId().toString('hex');
                }
            }

            return undefined;
        } catch (error) {
            console.error('Error extracting contract ID:', error);
            return undefined;
        }
    }
}
