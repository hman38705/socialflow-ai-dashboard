import { PrismaClient, Prisma } from '@prisma/client';
import { createLogger } from '../lib/logger';

const logger = createLogger('unitOfWork');

/** Prisma interactive-transaction client type */
export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface TransactionOptions {
  /** Max time (ms) Prisma waits to acquire a connection. Default: 2000 */
  maxWait?: number;
  /** Max time (ms) the transaction may run before being aborted. Default: 5000 */
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

export interface IRepository {
  [key: string]: any;
}

export interface IUnitOfWorkContext {
  prisma: TransactionClient;
  repositories: IRepository;
}

export type UnitOfWorkCallback<T> = (context: IUnitOfWorkContext) => Promise<T>;

/**
 * Wraps Prisma interactive transactions with a clean service-layer API.
 *
 * Usage:
 *   const uow = new UnitOfWork(prisma);
 *   const result = await uow.execute(async ({ prisma: tx }) => {
 *     const user = await tx.user.create({ data: userData });
 *     await tx.subscription.create({ data: { userId: user.id, ...subData } });
 *     return user;
 *   });
 */
export class UnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Run `callback` inside a single Prisma interactive transaction.
   * Rolls back automatically on any thrown error.
   */
  async execute<T>(
    callback: UnitOfWorkCallback<T>,
    options?: TransactionOptions,
    repositories?: IRepository,
  ): Promise<T> {
    logger.debug('Starting Unit of Work transaction');
    const result = await this.prisma.$transaction(async (tx) => {
      return callback({ prisma: tx, repositories: repositories ?? {} });
    }, options);
    logger.debug('Unit of Work transaction committed');
    return result;
  }

  /**
   * Run an array of operations sequentially inside one transaction.
   * Each operation receives the same transaction client so later steps
   * can depend on results from earlier ones.
   */
  async executeSequential<T>(
    operations: Array<(tx: TransactionClient) => Promise<T>>,
    options?: TransactionOptions,
  ): Promise<T[]> {
    logger.debug('Starting sequential Unit of Work transaction');
    return this.prisma.$transaction(async (tx) => {
      const results: T[] = [];
      for (const op of operations) {
        results.push(await op(tx));
      }
      return results;
    }, options);
  }

  /**
   * Run an array of independent operations in parallel inside one transaction.
   * Use `executeSequential` when operations depend on each other.
   */
  async executeParallel<T>(
    operations: Array<(tx: TransactionClient) => Promise<T>>,
    options?: TransactionOptions,
  ): Promise<T[]> {
    logger.debug('Starting parallel Unit of Work transaction');
    return this.prisma.$transaction(
      (tx) => Promise.all(operations.map((op) => op(tx))),
      options,
    );
  }
}

export function createUnitOfWork(prisma: PrismaClient): UnitOfWork {
  return new UnitOfWork(prisma);
}
