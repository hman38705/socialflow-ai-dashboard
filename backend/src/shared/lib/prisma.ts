/**
 * Re-export the canonical Prisma client so that consumers of this module
 * (e.g. `__tests__/orgScopedModels.test.ts` and `__tests__/integration/setup.ts`)
 * share the exact same client instance as the rest of the application.
 *
 * This guarantees behavioral parity with the live client, including the
 * soft-delete middleware (deletes are rewritten to updates and soft-deleted
 * `User`/`Listing`/`Post`/`Organization`/`WebhookSubscription` rows are
 * filtered from every query) and the environment-aware connection-pool /
 * PgBouncer configuration.
 *
 * Mirrors the pattern used to fix the equivalent `shared/config/runtime.ts`
 * divergence.
 */
export { prisma, ORG_SCOPED_MODELS } from '../../lib/prisma';
