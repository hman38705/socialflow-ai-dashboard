import { prisma } from '../../lib/prisma';
import { AuditLogStore } from '../../models/AuditLog';
import { auditLogger } from '../AuditLogger';

jest.mock('../../lib/prisma', () => ({
  prisma: {
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
  },
}));

const prismaMock = prisma as { auditLog: { create: jest.Mock } };

describe('AuditLogger', () => {
  beforeEach(() => {
    prismaMock.auditLog.create.mockResolvedValue({});
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('appends to AuditLogStore on log()', async () => {
    const before = AuditLogStore.recent(1000).length;

    await auditLogger.log({ actorId: 'u1', action: 'auth:login' });

    const entries = AuditLogStore.recent(1000);
    expect(entries.length).toBe(before + 1);
    expect(entries[0]).toMatchObject({ actorId: 'u1', action: 'auth:login' });
  });

  it('persists to prisma with correct fields', async () => {
    await auditLogger.log({
      actorId: 'u2',
      action: 'post:delete',
      organizationId: 'org1',
      resourceType: 'post',
      resourceId: 'p1',
      metadata: { reason: 'spam' },
      ip: '1.2.3.4',
      userAgent: 'TestAgent/1',
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u2',
        action: 'post:delete',
        organizationId: 'org1',
        resource: 'post',
        resourceId: 'p1',
        ipAddress: '1.2.3.4',
        userAgent: 'TestAgent/1',
      }),
    });
  });

  it('redacts sensitive fields in metadata before persisting', async () => {
    await auditLogger.log({
      actorId: 'u3',
      action: 'auth:change-password',
      metadata: { password: 'secret123', reason: 'reset' },
    });

    const { data } = prismaMock.auditLog.create.mock.calls[0][0];
    expect(data.metadata.password).toBe('[REDACTED]');
    expect(data.metadata.reason).toBe('reset');
  });

  it('passes undefined metadata when none provided', async () => {
    await auditLogger.log({ actorId: 'u4', action: 'auth:logout' });

    const { data } = prismaMock.auditLog.create.mock.calls[0][0];
    expect(data.metadata).toBeUndefined();
  });

  it('stores null for optional fields when not provided', async () => {
    await auditLogger.log({ actorId: 'u5', action: 'ai:generate' });

    const { data } = prismaMock.auditLog.create.mock.calls[0][0];
    expect(data.organizationId).toBeNull();
    expect(data.resource).toBeNull();
    expect(data.resourceId).toBeNull();
  });

  it('does not throw when prisma.auditLog.create rejects', async () => {
    prismaMock.auditLog.create.mockRejectedValueOnce(new Error('DB down'));

    await expect(
      auditLogger.log({ actorId: 'u6', action: 'auth:login' }),
    ).resolves.toBeUndefined();
  });

  it('still appends to store even when prisma rejects', async () => {
    prismaMock.auditLog.create.mockRejectedValueOnce(new Error('DB down'));

    const before = AuditLogStore.recent(1000).length;
    await auditLogger.log({ actorId: 'u7', action: 'post:create' });

    expect(AuditLogStore.recent(1000).length).toBe(before + 1);
  });

  describe('AuditLogStore queries', () => {
    it('forActor returns entries for the given actorId', async () => {
      await auditLogger.log({ actorId: 'actor-q', action: 'post:update' });

      const entries = AuditLogStore.forActor('actor-q');
      expect(entries.length).toBeGreaterThan(0);
      entries.forEach((e) => expect(e.actorId).toBe('actor-q'));
    });

    it('forResource returns entries matching resourceType and resourceId', async () => {
      await auditLogger.log({
        actorId: 'uR',
        action: 'post:delete',
        resourceType: 'post',
        resourceId: 'res-42',
      });

      const entries = AuditLogStore.forResource('post', 'res-42');
      expect(entries.length).toBeGreaterThan(0);
      entries.forEach((e) => {
        expect(e.resourceType).toBe('post');
        expect(e.resourceId).toBe('res-42');
      });
    });
  });
});
