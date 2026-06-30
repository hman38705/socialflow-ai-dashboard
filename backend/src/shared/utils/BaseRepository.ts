import { PrismaClient } from '@prisma/client';

/**
 * Returns true when the error is a Prisma "record not found" (P2025).
 * Used by update/delete methods to return null instead of throwing.
 */
function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as Record<string, unknown>)['code'] === 'P2025'
  );
}

/**
 * Base Repository class for Unit of Work pattern
 * Provides common CRUD operations within transaction context
 */
export abstract class BaseRepository {
  protected prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get the Prisma client (transaction-scoped if in UoW context)
   */
  protected getClient(): PrismaClient {
    return this.prisma;
  }
}

/**
 * Example User Repository
 */
export class UserRepository extends BaseRepository {
  async findById(id: string) {
    return this.getClient().user.findUnique({
      where: { id },
    });
  }

  async create(data: any) {
    return this.getClient().user.create({
      data,
    });
  }

  /**
   * Merge a partial update and return the updated entity.
   * Returns null when the record does not exist (Prisma P2025).
   * Re-throws all other errors.
   */
  async update(id: string, data: any) {
    try {
      return await this.getClient().user.update({
        where: { id },
        data,
      });
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  /**
   * Hard-delete a user record.
   * Returns null when the record does not exist (Prisma P2025).
   * Re-throws all other errors.
   */
  async delete(id: string) {
    try {
      return await this.getClient().user.delete({
        where: { id },
      });
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }
}

/**
 * Example Organization Repository
 */
export class OrganizationRepository extends BaseRepository {
  async findById(id: string) {
    return this.getClient().organization.findUnique({
      where: { id },
    });
  }

  async create(data: any) {
    return this.getClient().organization.create({
      data,
    });
  }

  /**
   * Merge a partial update and return the updated entity.
   * Returns null when the record does not exist (Prisma P2025).
   * Re-throws all other errors.
   */
  async update(id: string, data: any) {
    try {
      return await this.getClient().organization.update({
        where: { id },
        data,
      });
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  /**
   * Hard-delete an organization record.
   * Returns null when the record does not exist (Prisma P2025).
   * Re-throws all other errors.
   */
  async delete(id: string) {
    try {
      return await this.getClient().organization.delete({
        where: { id },
      });
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }
}

/**
 * Example Subscription Repository
 */
export class SubscriptionRepository extends BaseRepository {
  async findById(id: string) {
    return this.getClient().subscription.findUnique({
      where: { id },
    });
  }

  async create(data: any) {
    return this.getClient().subscription.create({
      data,
    });
  }

  /**
   * Merge a partial update and return the updated entity.
   * Returns null when the record does not exist (Prisma P2025).
   * Re-throws all other errors.
   */
  async update(id: string, data: any) {
    try {
      return await this.getClient().subscription.update({
        where: { id },
        data,
      });
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  /**
   * Hard-delete a subscription record.
   * Returns null when the record does not exist (Prisma P2025).
   * Re-throws all other errors.
   */
  async delete(id: string) {
    try {
      return await this.getClient().subscription.delete({
        where: { id },
      });
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }
}
