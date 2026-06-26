import {
    SorobanRpc,
    Contract,
    TransactionBuilder,
    BASE_FEE,
    xdr,
} from '@stellar/stellar-sdk';
import {
    ContractInvocationParams,
    ContractSimulationResult,
    SorobanConfig,
} from '../types/soroban';
import { DEFAULT_TIMEOUT } from '../config/soroban.config';

/**
 * SmartContractReader - Handles contract state reading and simulation
 */
export class SmartContractReader {
    constructor(
        private server: SorobanRpc.Server,
        private networkPassphrase: string,
        private config: SorobanConfig
    ) {}

    /**
     * Simulate a contract invocation (read-only)
     */
    async simulate(
        params: ContractInvocationParams,
        sourceAccount: string
    ): Promise<ContractSimulationResult> {
        try {
            const contract = new Contract(params.contractId);
            const account = await this.server.getAccount(sourceAccount);

            // Build transaction for simulation
            const transaction = new TransactionBuilder(account, {
                fee: BASE_FEE,
                networkPassphrase: this.networkPassphrase,
            })
                .addOperation(
                    contract.call(params.method, ...params.args)
                )
                .setTimeout(DEFAULT_TIMEOUT)
                .build();

            // Simulate the transaction
            const simulation = await this.server.simulateTransaction(transaction);

            if (SorobanRpc.Api.isSimulationError(simulation)) {
                return {
                    success: false,
                    cost: { cpuInstructions: '0', memoryBytes: '0' },
                    minResourceFee: '0',
                    error: simulation.error,
                };
            }

            if (!SorobanRpc.Api.isSimulationSuccess(simulation)) {
                return {
                    success: false,
                    cost: { cpuInstructions: '0', memoryBytes: '0' },
                    minResourceFee: '0',
                    error: 'Simulation failed with unknown error',
                };
            }

            return {
                success: true,
                result: simulation.result?.retval,
                cost: {
                    cpuInstructions: simulation.cost?.cpuInsns || '0',
                    memoryBytes: simulation.cost?.memBytes || '0',
                },
                minResourceFee: simulation.minResourceFee || '0',
                events: simulation.events,
            };
        } catch (error) {
            return {
                success: false,
                cost: { cpuInstructions: '0', memoryBytes: '0' },
                minResourceFee: '0',
                error: error instanceof Error ? error.message : 'Unknown simulation error',
            };
        }
    }

    /**
     * Get contract events by filter
     */
    async getContractEvents(
        contractId: string,
        startLedger?: number,
        endLedger?: number
    ): Promise<SorobanRpc.Api.EventResponse[]> {
        try {
            const response = await this.server.getEvents({
                filters: [
                    {
                        type: 'contract',
                        contractIds: [contractId],
                    },
                ],
                startLedger,
                limit: 100,
            });

            return response.events || [];
        } catch (error) {
            console.error('Error fetching contract events:', error);
            return [];
        }
    }

    /**
     * Parse events from transaction metadata
     */
    parseTransactionEvents(
        txResponse: SorobanRpc.Api.GetSuccessfulTransactionResponse
    ): SorobanRpc.Api.EventResponse[] {
        try {
            if (!txResponse.resultMetaXdr) {
                return [];
            }

            const meta = xdr.TransactionMeta.fromXDR(txResponse.resultMetaXdr, 'base64');

            // Extract events from transaction meta
            if (meta.switch() === 3 && meta.v3()?.sorobanMeta()?.events()) {
                const events = meta.v3()?.sorobanMeta()?.events() || [];

                return events.map((event, index) => ({
                    type: event.type().name,
                    ledger: txResponse.ledger.toString(),
                    ledgerClosedAt: txResponse.createdAt,
                    contractId: event.contractId()?.toString('hex'),
                    id: `${txResponse.hash}-${index}`,
                    pagingToken: `${txResponse.ledger}-${index}`,
                    topic: event.body().value()?.topics?.() || [],
                    value: event.body().value()?.data?.(),
                    inSuccessfulContractCall: true,
                    txHash: txResponse.hash,
                }));
            }

            return [];
        } catch (error) {
            console.error('Error parsing transaction events:', error);
            return [];
        }
    }
}
