/**
 * Usage examples for UnitOfWork and @Transactional.
 * These are illustrative — not production code.
 */
import { PrismaClient } from '@prisma/client';
import { UnitOfWork, TransactionClient } from './UnitOfWork';
import { Transactional } from './Transactional';

// ---------------------------------------------------------------------------
// 1. UnitOfWork.execute — callback style
// ---------------------------------------------------------------------------
export async function createUserWithOrganization(
  prisma: PrismaClient,
  userData: any,
  orgData: any,
) {
  const uow = new UnitOfWork(prisma);

  return uow.execute(async ({ prisma: tx }) => {
    const org  = await tx.organization.create({ data: orgData });
    const user = await tx.user.create({ data: { ...userData, organizationId: org.id } });
    return { user, org };
  });
}

// ---------------------------------------------------------------------------
// 2. UnitOfWork.executeSequential — ordered, dependent operations
// ---------------------------------------------------------------------------
export async function provisionAccount(prisma: PrismaClient, userData: any, subData: any) {
  const uow = new UnitOfWork(prisma);

  return uow.executeSequential([
    (tx) => tx.user.create({ data: userData }),
    async (tx) => {
      const user = await tx.user.findFirstOrThrow({ where: { email: userData.email } });
      return tx.subscription.create({ data: { ...subData, userId: user.id } });
    },
  ]);
}

// ---------------------------------------------------------------------------
// 3. UnitOfWork.executeParallel — independent operations
// ---------------------------------------------------------------------------
export async function updateUserAndOrg(
  prisma: PrismaClient,
  userId: string,
  orgId: string,
  userData: any,
  orgData: any,
) {
  const uow = new UnitOfWork(prisma);

  return uow.executeParallel([
    (tx) => tx.user.update({ where: { id: userId }, data: userData }),
    (tx) => tx.organization.update({ where: { id: orgId }, data: orgData }),
  ]);
}

// ---------------------------------------------------------------------------
// 4. @Transactional decorator — service-layer style
//    The decorator starts a transaction and injects `tx` as the last arg.
//    Pass an existing `tx` to propagate into an outer transaction.
// ---------------------------------------------------------------------------
export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

  @Transactional({ timeout: 10_000 })
  async createWithSubscription(userData: any, subData: any, tx?: TransactionClient) {
    const client = tx ?? this.prisma; // tx is always set by the decorator
    const user = await client.user.create({ data: userData });
    await client.subscription.create({ data: { ...subData, userId: user.id } });
    return user;
  }

  // Calls the decorated method above — passes its own tx for propagation.
  @Transactional()
  async createWithOrgAndSubscription(
    userData: any,
    orgData: any,
    subData: any,
    tx?: TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    const org = await client.organization.create({ data: orgData });
    // Propagates the outer tx into createWithSubscription
    return this.createWithSubscription({ ...userData, organizationId: org.id }, subData, tx);
  }
}
