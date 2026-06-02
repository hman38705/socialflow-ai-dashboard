import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { config } from '../config/config';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const tracer = trace.getTracer('socialflow-db');

// Models that support soft delete (have a deletedAt field)
const SOFT_DELETE_MODELS = new Set(['User', 'Listing', 'Post', 'Organization', 'WebhookSubscription']);

// Models that should be scoped to an organization
export const ORG_SCOPED_MODELS = new Set([
  'Post',
  'AnalyticsEntry',
  'Listing',
  'OrganizationMember',
  'AuditLog',
  'AIGenerationResult',
]);

const POOL_DEFAULTS = {
  development: { connection_limit: 5,  pool_timeout: 10 },
  test:        { connection_limit: 2,  pool_timeout: 10 },
  production:  { connection_limit: 10, pool_timeout: 20 },
} as const;

function buildDatasourceUrl(): string {
  const base = config.DATABASE_URL;
  const env = config.NODE_ENV;
  const defaults = POOL_DEFAULTS[env];

  let connectionLimit = config.DB_CONNECTION_LIMIT ?? defaults.connection_limit;
  const poolTimeout   = config.DB_POOL_TIMEOUT     ?? defaults.pool_timeout;

  // PgBouncer in transaction mode multiplexes server connections, so each
  // application process must use connection_limit=1 to avoid holding idle
  // server connections open.
  if (config.PGBOUNCER_MODE) {
    if (connectionLimit !== 1) {
      console.warn(
        `[prisma] PGBOUNCER_MODE=true detected: overriding connection_limit from ${connectionLimit} to 1. ` +
        'PgBouncer transaction mode requires connection_limit=1 per process.',
      );
    }
    connectionLimit = 1;
  }

  const url = new URL(base);
  url.searchParams.set('connection_limit', String(connectionLimit));
  url.searchParams.set('pool_timeout',     String(poolTimeout));

  console.log(
    `[prisma] Effective pool config — connection_limit: ${connectionLimit}, ` +
    `pool_timeout: ${poolTimeout}s, pgbouncer_mode: ${config.PGBOUNCER_MODE ?? false}`,
  );

  return url.toString();
}

/**
 * Prisma v7 query extension that handles:
 * 1. Soft delete — rewrites delete/find operations for soft-delete models
 * 2. Org scoping — filters by organizationId when __orgId is present
 * 3. Tracing — wraps every query in an OpenTelemetry span
 */
function createExtendedClient() {
  const connectionString = buildDatasourceUrl();
  const adapter = new PrismaPg({ connectionString });
  const base = new PrismaClient({ adapter });

  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: {
          model: string;
          operation: string;
          args: Record<string, any>;
          query: (args: Record<string, any>) => Promise<any>;
        }) {
          // ── Soft delete ────────────────────────────────────────────────
          if (SOFT_DELETE_MODELS.has(model)) {
            if (operation === 'delete') {
              return query({ ...args, data: { deletedAt: new Date() } });
            }
            if (operation === 'deleteMany') {
              return (base as any)[model.charAt(0).toLowerCase() + model.slice(1)].updateMany({
                ...args,
                data: { deletedAt: new Date() },
              });
            }
            if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
              const newOp = operation === 'findUnique' ? 'findFirst' : 'findFirstOrThrow';
              const newArgs = { ...args, where: { ...args.where, deletedAt: null } };
              return (base as any)[model.charAt(0).toLowerCase() + model.slice(1)][newOp](newArgs);
            }
            if (['findFirst', 'findFirstOrThrow', 'findMany'].includes(operation)) {
              args = { ...args, where: { ...args.where, deletedAt: null } };
            }
          }

          // ── Org scoping ────────────────────────────────────────────────
          if (ORG_SCOPED_MODELS.has(model)) {
            const orgId: string | undefined = args.__orgId;
            if (orgId) {
              const newArgs = { ...args };
              delete newArgs.__orgId;

              const readOps = ['findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy'];
              const writeOps = ['create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany'];

              if (readOps.includes(operation)) {
                newArgs.where = { ...newArgs.where, organizationId: orgId };
              } else if (writeOps.includes(operation)) {
                if (operation === 'create' || operation === 'upsert') {
                  newArgs.data = { ...newArgs.data, organizationId: orgId };
                } else if (operation === 'createMany') {
                  const data = Array.isArray(newArgs.data) ? newArgs.data : [newArgs.data];
                  newArgs.data = data.map((d: Record<string, unknown>) => ({ ...d, organizationId: orgId }));
                } else {
                  newArgs.where = { ...newArgs.where, organizationId: orgId };
                }
              }
              args = newArgs;
            }
          }

          // ── Tracing ────────────────────────────────────────────────────
          const span = tracer.startSpan(`db.${model}.${operation}`, {
            attributes: {
              'db.system': 'postgresql',
              'db.operation': operation,
              'db.prisma.model': model,
            },
          });
          try {
            const result = await query(args);
            span.setStatus({ code: SpanStatusCode.OK });
            return result;
          } catch (err) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
            span.recordException(err as Error);
            throw err;
          } finally {
            span.end();
          }
        },
      },
    },
  });
}

export const prisma = globalForPrisma.prisma ?? (createExtendedClient() as unknown as PrismaClient);

if (config.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
