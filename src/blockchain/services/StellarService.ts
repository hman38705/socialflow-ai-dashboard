// @ts-expect-error - stellar-sdk exports CommonJS module without proper ESM type definitions
import StellarSdk from '@stellar/stellar-sdk';
const { Server, TransactionBuilder, Asset, Operation, Transaction, FeeBumpTransaction } = StellarSdk;
import { NetworkConfig, DEFAULT_NETWORK } from '../config/networks';
import { OfflineQueue } from './OfflineQueue';
import { AppError } from '../../utils/AppError';
import { ErrorCode } from '../../constants/ErrorCodes';

export class StellarService {
  private config: NetworkConfig;
  private pool: typeof Server[];
  private currentServerIndex: number = 0;
  private offlineQueue: OfflineQueue;
  
  // Fee caching
  private cachedBaseFee: number = 100;
  private feeCacheTime: number = 0;
  private FEE_CACHE_TTL = 30000; // 30 seconds

  // Stream cleanup tracking
  private activeStreams: Array<() => void> = [];

  constructor(initialConfig: NetworkConfig = DEFAULT_NETWORK, redisClient?: any) {
    this.config = initialConfig;
    this.pool = this.initializePool(this.config.horizonUrl);
    this.offlineQueue = new OfflineQueue(redisClient);
    // Restore any transactions queued before the last restart
    this.offlineQueue.restoreFromRedis().catch((err) =>
      console.error('Failed to restore offline queue from Redis:', err),
    );
  }

  // --- 2.2 Connection Management ---
  // Fallback Horizon endpoints provide real redundancy; primary URL is always first.
  private static readonly FALLBACK_HORIZON_URLS = [
    'https://horizon.stellar.org',
    'https://horizon-testnet.stellar.org',
    'https://horizon-futurenet.stellar.org',
  ];

  private initializePool(horizonUrl: string): typeof Server[] {
    // Build a deduplicated list: primary URL first, then distinct fallbacks.
    const urls = [
      horizonUrl,
      ...StellarService.FALLBACK_HORIZON_URLS.filter((u) => u !== horizonUrl),
    ].slice(0, 3);
    return urls.map((u) => new Server(u));
  }

  private getServer(): typeof Server {
    const server = this.pool[this.currentServerIndex];
    this.currentServerIndex = (this.currentServerIndex + 1) % this.pool.length;
    return server;
  }

  public setNetwork(newConfig: NetworkConfig): void {
    this.config = newConfig;
    this.pool = this.initializePool(newConfig.horizonUrl);
  }

  public getNetwork(): NetworkConfig {
    return this.config;
  }

  public async getNetworkStatus(): Promise<boolean> {
    try {
      const root = await this.getServer().root();
      return !!root.core_version;
    } catch {
      return false;
    }
  }

  // --- 2.3 Account Operations ---
  public async getAccount(publicKey: string) {
    try {
      return await this.getServer().loadAccount(publicKey);
    } catch (error) {
      throw new AppError(ErrorCode.ERR_NOT_FOUND, `Account not found or invalid: ${publicKey}`);
    }
  }

  public async getBalances(publicKey: string) {
    const account = await this.getAccount(publicKey);
    return account.balances.map((b: any) => ({
      asset: b.asset_type === 'native' ? 'XLM' : (b as any).asset_code,
      issuer: b.asset_type === 'native' ? 'Stellar' : (b as any).asset_issuer,
      balance: parseFloat(b.balance) // Formatting decimal strings to numbers
    }));
  }

  public buildCreateAccount(sourceAccount: any, destination: string, startingBalance: string) {
    return new TransactionBuilder(sourceAccount, { fee: this.cachedBaseFee.toString(), networkPassphrase: this.config.networkPassphrase })
      .addOperation(Operation.createAccount({
        destination,
        startingBalance
      }))
      .setTimeout(30)
      .build();
  }

  // --- 2.5 Fee Estimation ---
  public async getCurrentBaseFee(): Promise<number> {
    if (Date.now() - this.feeCacheTime < this.FEE_CACHE_TTL) {
      return this.cachedBaseFee;
    }
    try {
      const feeStats = await this.getServer().feeStats();
      this.cachedBaseFee = parseInt(feeStats.base_fee.toString(), 10);
      
      // Surge detection logic
      if (parseInt(feeStats.fee_charged.p99, 10) > this.cachedBaseFee * 2) {
        console.warn("Network congestion detected: Surge pricing active");
        this.cachedBaseFee = parseInt(feeStats.fee_charged.p99, 10);
      }
      
      this.feeCacheTime = Date.now();
      return this.cachedBaseFee;
    } catch {
      return 100; // Fallback to minimum fee
    }
  }

  public async estimateFee(operationCount: number): Promise<number> {
    const baseFee = await this.getCurrentBaseFee();
    return baseFee * operationCount;
  }

  // --- 2.6 Asset & Trustline Operations ---
  public parseAsset(assetString: string): typeof Asset {
    if (assetString.toLowerCase() === 'xlm' || assetString.toLowerCase() === 'native') return Asset.native();
    const [code, issuer] = assetString.split(':');
    if (!code || !issuer || code.length > 12) {
        throw new AppError(ErrorCode.ERR_INVALID_FORMAT, "Invalid asset format. Use CODE:ISSUER");
    }
    return new Asset(code, issuer);
  }

  public buildTrustline(sourceAccount: any, assetString: string, limit?: string) {
    const asset = this.parseAsset(assetString);
    return new TransactionBuilder(sourceAccount, { fee: this.cachedBaseFee.toString(), networkPassphrase: this.config.networkPassphrase })
      .addOperation(Operation.changeTrust({ asset, limit }))
      .setTimeout(30)
      .build();
  }

  public buildRemoveTrustline(sourceAccount: any, assetString: string) {
    return this.buildTrustline(sourceAccount, assetString, '0');
  }

  // --- 2.4 & 2.8 Transaction Submission, Offline Queue & Retries ---
  public async queueForOffline(tx: typeof Transaction | typeof FeeBumpTransaction) {
    const xdrString = tx.toXDR();
    return await this.offlineQueue.queueTransaction(xdrString);
  }

  public async submitTransaction(signedTransaction: typeof Transaction | typeof FeeBumpTransaction, maxAttempts = 3): Promise<any> {
    let attempt = 1;
    while (attempt <= maxAttempts) {
      try {
        const response = await this.getServer().submitTransaction(signedTransaction);
        return response;
      } catch (error: any) {
        if (attempt === maxAttempts) {
          console.error("Tx failed after max retries.");
          throw new AppError(ErrorCode.ERR_MAX_RETRIES_EXCEEDED, error.message || 'Transaction submission failed after maximum retries');
        }
        // Exponential backoff
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        attempt++;
      }
    }
  }

  // --- 2.7 Transaction Monitoring (SSE) ---
  public streamTransactions(publicKey: string, callback: (tx: any) => void) {
    const closeStream = this.getServer().transactions()
      .forAccount(publicKey)
      .cursor('now')
      .stream({
        onmessage: (tx: any) => {
          callback(tx);
        },
        onerror: (error: any) => {
          console.error("Stream error, attempting to reconnect...", error);
          // SDK auto-reconnects natively in most cases, but we log it.
        }
      });
    
    this.activeStreams.push(closeStream);
    return closeStream;
  }

  public cleanupStreams() {
    this.activeStreams.forEach(close => close());
    this.activeStreams = [];
  }
}

export const stellarService = new StellarService();