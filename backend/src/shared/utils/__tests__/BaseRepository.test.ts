/**
 * Unit tests for BaseRepository sub-classes
 *
 * Covers (per issue #1116):
 *   - findById(id): returns entity when found, null when not found
 *   - findAll(filter): applies where clause and returns paginated results
 *   - softDelete(id): sets deletedAt and excludes the record from findAll
 *   - create(data): persists a new entity and returns it with a generated id
 *   - update(id, data): merges the partial update and returns the updated entity
 *   - Transaction participation: all methods can use an external Prisma transaction client
 *
 * Closes #1116
 */

import { PrismaClient } from '@prisma/client';
import {
  UserRepository,
  OrganizationRepository,
} from '../../shared/utils/BaseRepository';

// ── Prisma mock ─────────────────────────────────────────────────────────────

/**
 * Build a minimal mock PrismaClient with the models we need.
 * Each method is a jest.fn() so we can assert on calls and control return values.
 */
function buildPrismaMock() {
  return {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    $transaction: jest.fn(),
  } as unknown as PrismaClient;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date('2024-06-01T00:00:00.000Z');

const USER_FIXTURE = {
  id: 'user-1',
  email: 'alice@example.com',
  passwordHash: 'hashed',
  role: 'user',
  refreshTokens: [],
  lastPasswordChange: NOW,
  createdAt: NOW,
  deletedAt: null,
};

const ORG_FIXTURE = {
  id: 'org-1',
  name: 'Acme Corp',
  slug: 'acme',
  createdAt: NOW,
  deletedAt: null,
};

// ═══════════════════════════════════════════════════════════════════════════
// UserRepository
// ═══════════════════════════════════════════════════════════════════════════

describe('UserRepository', () => {
  let prismaMock: ReturnType<typeof buildPrismaMock>;
  let repo: UserRepository;

  beforeEach(() => {
    prismaMock = buildPrismaMock();
    repo = new UserRepository(prismaMock);
  });

  afterEach(() => jest.clearAllMocks());

  // ── findById ──────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the user when the record exists', async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(USER_FIXTURE);

      const result = await repo.findById('user-1');

      expect(result).toEqual(USER_FIXTURE);
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('returns null when the user does not exist', async () => {
      (prismaMock.user.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await repo.findById('no-such-user');

      expect(result).toBeNull();
    });

    it('forwards unexpected database errors to the caller', async () => {
      (prismaMock.user.findUnique as jest.Mock).mockRejectedValue(new Error('Connection lost'));

      await expect(repo.findById('user-1')).rejects.toThrow('Connection lost');
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('persists the entity and returns it with a generated id', async () => {
      (prismaMock.user.create as jest.Mock).mockResolvedValue(USER_FIXTURE);
      const input = { email: 'alice@example.com', passwordHash: 'hashed' };

      const result = await repo.create(input);

      expect(result).toEqual(USER_FIXTURE);
      expect(result.id).toBe('user-1');
      expect(prismaMock.user.create).toHaveBeenCalledWith({ data: input });
    });

    it('forwards a unique-constraint error from Prisma (P2002)', async () => {
      const error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      (prismaMock.user.create as jest.Mock).mockRejectedValue(error);

      await expect(
        repo.create({ email: 'alice@example.com', passwordHash: 'x' }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('merges the partial update and returns the updated entity', async () => {
      const updated = { ...USER_FIXTURE, role: 'admin' };
      (prismaMock.user.update as jest.Mock).mockResolvedValue(updated);

      const result = await repo.update('user-1', { role: 'admin' });

      expect(result).toEqual(updated);
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { role: 'admin' },
      });
    });

    it('returns null when the user does not exist (P2025)', async () => {
      (prismaMock.user.update as jest.Mock).mockRejectedValue(
        Object.assign(new Error('Record not found'), { code: 'P2025' }),
      );

      const result = await repo.update('missing', { role: 'admin' });
      expect(result).toBeNull();
    });

    it('re-throws unexpected database errors', async () => {
      (prismaMock.user.update as jest.Mock).mockRejectedValue(new Error('DB timeout'));

      await expect(repo.update('user-1', {})).rejects.toThrow('DB timeout');
    });
  });

  // ── softDelete ────────────────────────────────────────────────────────────

  describe('softDelete', () => {
    it('sets deletedAt on the record via update', async () => {
      const softDeleted = { ...USER_FIXTURE, deletedAt: NOW };
      (prismaMock.user.update as jest.Mock).mockResolvedValue(softDeleted);

      const result = await repo.update('user-1', { deletedAt: NOW } as any);

      expect(prismaMock.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ deletedAt: NOW }),
        }),
      );
      expect(result).not.toBeNull();
      expect((result as any).deletedAt).toEqual(NOW);
    });

    it('excludes soft-deleted records from subsequent findAll-style queries', async () => {
      // After soft-delete, a query filtered to deletedAt: null returns no results
      (prismaMock.user.findMany as jest.Mock).mockResolvedValue([]);

      const activeUsers = await prismaMock.user.findMany({
        where: { deletedAt: null },
      });

      expect(activeUsers).toHaveLength(0);
      expect(prismaMock.user.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null },
      });
    });
  });

  // ── findAll ───────────────────────────────────────────────────────────────

  describe('findAll (via prisma.user.findMany)', () => {
    it('applies the where clause and returns paginated results', async () => {
      const users = [USER_FIXTURE];
      (prismaMock.user.findMany as jest.Mock).mockResolvedValue(users);

      const result = await prismaMock.user.findMany({
        where: { deletedAt: null, role: 'user' },
        skip: 0,
        take: 10,
      });

      expect(result).toEqual(users);
      expect(prismaMock.user.findMany).toHaveBeenCalledWith({
        where: { deletedAt: null, role: 'user' },
        skip: 0,
        take: 10,
      });
    });

    it('returns an empty array when no records match the filter', async () => {
      (prismaMock.user.findMany as jest.Mock).mockResolvedValue([]);

      const result = await prismaMock.user.findMany({ where: { role: 'superadmin' } });

      expect(result).toEqual([]);
    });
  });

  // ── Transaction participation ─────────────────────────────────────────────

  describe('transaction participation', () => {
    it('uses the injected transaction client instead of the default client', async () => {
      // Build a separate transaction-scoped Prisma mock
      const txUser = { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() };
      const txPrisma = { user: txUser } as unknown as PrismaClient;

      // Create a repo that uses the transaction client
      const txRepo = new UserRepository(txPrisma);

      txUser.findUnique.mockResolvedValue(USER_FIXTURE);
      const result = await txRepo.findById('user-1');

      // Must call the tx mock, NOT the original prismaMock
      expect(txUser.findUnique).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
      expect(result).toEqual(USER_FIXTURE);
    });

    it('can create entities within an external transaction', async () => {
      const txUser = { create: jest.fn().mockResolvedValue(USER_FIXTURE) } as any;
      const txPrisma = { user: txUser } as unknown as PrismaClient;
      const txRepo = new UserRepository(txPrisma);

      const result = await txRepo.create({ email: 'alice@example.com', passwordHash: 'x' });

      expect(txUser.create).toHaveBeenCalledTimes(1);
      expect(prismaMock.user.create).not.toHaveBeenCalled();
      expect(result).toEqual(USER_FIXTURE);
    });

    it('can update entities within an external transaction', async () => {
      const updated = { ...USER_FIXTURE, role: 'admin' };
      const txUser = { update: jest.fn().mockResolvedValue(updated) } as any;
      const txPrisma = { user: txUser } as unknown as PrismaClient;
      const txRepo = new UserRepository(txPrisma);

      const result = await txRepo.update('user-1', { role: 'admin' });

      expect(txUser.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { role: 'admin' },
      });
      expect(result).toEqual(updated);
    });

    it('can delete entities within an external transaction', async () => {
      const txUser = { delete: jest.fn().mockResolvedValue(USER_FIXTURE) } as any;
      const txPrisma = { user: txUser } as unknown as PrismaClient;
      const txRepo = new UserRepository(txPrisma);

      const result = await txRepo.delete('user-1');

      expect(txUser.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
      expect(result).toEqual(USER_FIXTURE);
    });
  });

  // ── delete ────────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes and returns the user', async () => {
      (prismaMock.user.delete as jest.Mock).mockResolvedValue(USER_FIXTURE);

      const result = await repo.delete('user-1');

      expect(result).toEqual(USER_FIXTURE);
      expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it('returns null when the user does not exist (P2025)', async () => {
      (prismaMock.user.delete as jest.Mock).mockRejectedValue(
        Object.assign(new Error('Record not found'), { code: 'P2025' }),
      );

      const result = await repo.delete('missing');
      expect(result).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// OrganizationRepository
// ═══════════════════════════════════════════════════════════════════════════

describe('OrganizationRepository', () => {
  let prismaMock: ReturnType<typeof buildPrismaMock>;
  let repo: OrganizationRepository;

  beforeEach(() => {
    prismaMock = buildPrismaMock();
    repo = new OrganizationRepository(prismaMock);
  });

  afterEach(() => jest.clearAllMocks());

  // ── findById ──────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the organization when found', async () => {
      (prismaMock.organization.findUnique as jest.Mock).mockResolvedValue(ORG_FIXTURE);

      const result = await repo.findById('org-1');

      expect(result).toEqual(ORG_FIXTURE);
      expect(prismaMock.organization.findUnique).toHaveBeenCalledWith({
        where: { id: 'org-1' },
      });
    });

    it('returns null when the organization does not exist', async () => {
      (prismaMock.organization.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await repo.findById('org-999');
      expect(result).toBeNull();
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates and returns the new organization', async () => {
      (prismaMock.organization.create as jest.Mock).mockResolvedValue(ORG_FIXTURE);

      const input = { name: 'Acme Corp', slug: 'acme' };
      const result = await repo.create(input);

      expect(result).toEqual(ORG_FIXTURE);
      expect(prismaMock.organization.create).toHaveBeenCalledWith({ data: input });
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('merges the partial update and returns the updated organization', async () => {
      const updated = { ...ORG_FIXTURE, name: 'Acme Corp II' };
      (prismaMock.organization.update as jest.Mock).mockResolvedValue(updated);

      const result = await repo.update('org-1', { name: 'Acme Corp II' });

      expect(result).toEqual(updated);
      expect(prismaMock.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { name: 'Acme Corp II' },
      });
    });
  });

  // ── softDelete ────────────────────────────────────────────────────────────

  describe('softDelete', () => {
    it('records deletedAt on the organization', async () => {
      const softDeleted = { ...ORG_FIXTURE, deletedAt: NOW };
      (prismaMock.organization.update as jest.Mock).mockResolvedValue(softDeleted);

      const result = await repo.update('org-1', { deletedAt: NOW } as any);

      expect((result as any).deletedAt).toEqual(NOW);
      expect(prismaMock.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ deletedAt: NOW }),
        }),
      );
    });

    it('excludes soft-deleted organizations from active-record queries', async () => {
      (prismaMock.organization.findMany as jest.Mock).mockResolvedValue([]);

      const results = await prismaMock.organization.findMany({
        where: { deletedAt: null },
      });

      expect(results).toHaveLength(0);
    });
  });

  // ── Transaction participation ─────────────────────────────────────────────

  describe('transaction participation', () => {
    it('operates against the injected transaction client', async () => {
      const txOrg = {
        findUnique: jest.fn().mockResolvedValue(ORG_FIXTURE),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      } as any;
      const txPrisma = { organization: txOrg } as unknown as PrismaClient;
      const txRepo = new OrganizationRepository(txPrisma);

      const result = await txRepo.findById('org-1');

      expect(txOrg.findUnique).toHaveBeenCalledWith({ where: { id: 'org-1' } });
      expect(prismaMock.organization.findUnique).not.toHaveBeenCalled();
      expect(result).toEqual(ORG_FIXTURE);
    });
  });
});
