/**
 * Read/write splitting — disabled in Prisma v7 (middleware API removed).
 * Configure DATABASE_REPLICA_URL when a Prisma v7-compatible adapter is available.
 *
 * replicaClient: a dedicated PrismaClient pointed at DATABASE_REPLICA_URL when
 * set, otherwise falls back to the primary DATABASE_URL. Use this client for
 * all read-only (analytics) queries to reduce primary DB load.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createLogger } from './logger';

const logger = createLogger('readReplica');

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function applyReadWriteSplitting(_primary: PrismaClient): void {
  if (process.env.DATABASE_REPLICA_URL) {
    logger.warn('DATABASE_REPLICA_URL is set but read/write splitting is not active in Prisma v7');
  }
}

/**
 * Read-only Prisma client for analytics queries.
 * Points to DATABASE_REPLICA_URL if configured, otherwise uses the primary.
 */
const replicaAdapter = new PrismaPg({
  connectionString: process.env.DATABASE_REPLICA_URL ?? process.env.DATABASE_URL,
});

export const replicaClient = new PrismaClient({ adapter: replicaAdapter });
