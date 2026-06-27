import { SorobanRpc, xdr } from '@stellar/stellar-sdk';

export interface SorobanConfig {
  rpcUrl: string;
  networkPassphrase: string;
}

export enum ContractCallType {
  READ_ONLY = 'READ_ONLY',
  STATE_CHANGING = 'STATE_CHANGING',
}

export interface ContractInvocationParams {
  contractId: string;
  method: string;
  args: xdr.ScVal[];
}

export interface ContractSimulationResult {
  success: boolean;
  result?: xdr.ScVal;
  cost: {
    cpuInstructions: string;
    memoryBytes: string;
  };
  minResourceFee: string;
  error?: string;
  events?: SorobanRpc.Api.EventResponse[];
}

export interface ContractInvocationResult {
  success: boolean;
  transactionHash?: string;
  result?: xdr.ScVal;
  events?: SorobanRpc.Api.EventResponse[];
  error?: string;
  errorType?: string;
}

export interface WasmDeploymentParams {
  wasmBuffer: Buffer;
  salt?: Buffer;
}

export interface WasmDeploymentResult {
  success: boolean;
  contractId?: string;
  wasmHash?: string;
  transactionHash?: string;
  error?: string;
}
