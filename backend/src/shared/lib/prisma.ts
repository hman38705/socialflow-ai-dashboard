import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { softDeleteMiddleware } from '../middleware/prismaSoftDelete';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const tracer = trace.getTracer('socialflow-db');

// Models that should be scoped to an organization
export const ORG_SCOPED_MODELS = new Set([
  'Post',
  'AnalyticsEntry',
  'Listing',
  'OrganizationMember',
  'AuditLog',
  'AIGenerationResult',
]);

function createInstrumentedPrisma(): PrismaClient {
  const client = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

  // Soft delete: convert deletes to updates and filter out deleted records
  client.$use(softDeleteMiddleware);

  // Wrap every query in a span via Prisma middleware
  // Tracing middleware
  client.$use(async (params, next) => {
    const spanName = `db.${params.model ?? 'unknown'}.${params.action}`;
    const span = tracer.startSpan(spanName, {
      attributes: {
        'db.system': 'postgresql',
        'db.operation': params.action,
        'db.prisma.model': params.model ?? '',
      },
    });

    try {
      const result = await next(params);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err as Error);
      throw err;
    } finally {
      span.end();
    }
  });

  // Org-scoping middleware — filters read/write queries by organizationId when provided
  client.$use(async (params, next) => {
    if (!params.model || !ORG_SCOPED_MODELS.has(params.model)) return next(params);

    const orgId: string | undefined = (params.args as Record<string, unknown>)?.__orgId as
      | string
      | undefined;
    if (!orgId) return next(params);

    // Remove the injected __orgId sentinel before forwarding
    if (params.args && typeof params.args === 'object') {
      delete (params.args as Record<string, unknown>).__orgId;
    }

    const readActions = ['findUnique', 'findFirst', 'findMany', 'count', 'aggregate', 'groupBy'];
    const writeActions = [
      'create',
      'createMany',
      'update',
      'updateMany',
      'upsert',
      'delete',
      'deleteMany',
    ];

    if (readActions.includes(params.action)) {
      params.args = params.args ?? {};
      params.args.where = { ...(params.args.where ?? {}), organizationId: orgId };
    } else if (writeActions.includes(params.action)) {
      if (params.action === 'create' || params.action === 'upsert') {
        params.args.data = { ...(params.args.data ?? {}), organizationId: orgId };
      } else if (params.action === 'createMany') {
        const data = Array.isArray(params.args.data) ? params.args.data : [params.args.data];
        params.args.data = data.map((d: Record<string, unknown>) => ({
          ...d,
          organizationId: orgId,
        }));
      } else {
        params.args.where = { ...(params.args.where ?? {}), organizationId: orgId };
      }
    }

    return next(params);
  });

  return client;
}

export const prisma = globalForPrisma.prisma ?? createInstrumentedPrisma();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
