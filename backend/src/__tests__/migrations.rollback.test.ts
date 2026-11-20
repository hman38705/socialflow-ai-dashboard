import Redis from 'ioredis';
import { Logger } from '../lib/logger';
import { runMigrations, rollbackMigration, listMigrations } from '../admin/migrationService';
import {
  ADMIN_MIGRATIONS_SET_KEY,
  ADMIN_MIGRATIONS_LOCK_KEY,
  ADMIN_MIGRATIONS_METADATA_KEY,
  KNOWN_QUEUES_SET_KEY,
} from '../admin/constants';
import { getRedisConnection } from '../config/runtime';
import { writeAuditLog } from '../lib/auditLog';

jest.mock('../lib/auditLog', () => ({
  writeAuditLog: jest.fn(),
}));

const mockWriteAuditLog = writeAuditLog as jest.MockedFunction<typeof writeAuditLog>;

describe('Migration Rollback', () => {
  let redis: Redis;
  let mockLogger: Logger;

  beforeEach(() => {
    redis = new Redis(getRedisConnection());
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    mockWriteAuditLog.mockClear();
  });

  afterEach(async () => {
    await redis.del(
      ADMIN_MIGRATIONS_SET_KEY,
      ADMIN_MIGRATIONS_LOCK_KEY,
      ADMIN_MIGRATIONS_METADATA_KEY,
      KNOWN_QUEUES_SET_KEY,
    );
    redis.disconnect();
  });

  describe('sync_configured_queues rollback', () => {
    const MIGRATION = '20260324_sync_configured_queues';

    it('up → down restores pre-migration state (queues set removed)', async () => {
      // Verify queues set does not exist before migration
      expect(await redis.exists(KNOWN_QUEUES_SET_KEY)).toBe(0);

      // UP: run migration
      const upResult = await runMigrations({ dryRun: false }, mockLogger);
      expect(upResult.lockAcquired).toBe(true);

      // Confirm migration is marked applied
      const appliedAfterUp = await redis.sismember(ADMIN_MIGRATIONS_SET_KEY, MIGRATION);
      expect(appliedAfterUp).toBe(1);

      // DOWN: rollback
      const downResult = await rollbackMigration(MIGRATION, mockLogger);
      expect(downResult.success).toBe(true);

      // Verify schema matches pre-migration state: queues set is gone
      expect(await redis.exists(KNOWN_QUEUES_SET_KEY)).toBe(0);
    });

    it('up → down removes migration from applied set', async () => {
      await runMigrations({ dryRun: false }, mockLogger);
      expect(await redis.sismember(ADMIN_MIGRATIONS_SET_KEY, MIGRATION)).toBe(1);

      await rollbackMigration(MIGRATION, mockLogger);

      expect(await redis.sismember(ADMIN_MIGRATIONS_SET_KEY, MIGRATION)).toBe(0);
    });

    it('up → down removes migration metadata', async () => {
      await runMigrations({ dryRun: false }, mockLogger);
      expect(await redis.hexists(ADMIN_MIGRATIONS_METADATA_KEY, MIGRATION)).toBe(1);

      await rollbackMigration(MIGRATION, mockLogger);

      expect(await redis.hexists(ADMIN_MIGRATIONS_METADATA_KEY, MIGRATION)).toBe(0);
    });

    it('up → down → up re-applies migration cleanly', async () => {
      // UP
      const up1 = await runMigrations({ dryRun: false }, mockLogger);
      expect(up1.executed).toContain(MIGRATION);

      // DOWN
      const down = await rollbackMigration(MIGRATION, mockLogger);
      expect(down.success).toBe(true);

      // UP again — migration should re-execute, not be skipped
      const up2 = await runMigrations({ dryRun: false }, mockLogger);
      expect(up2.executed).toContain(MIGRATION);
      expect(up2.skipped).not.toContain(MIGRATION);
    });

    it('listMigrations reflects unapplied state after rollback', async () => {
      await runMigrations({ dryRun: false }, mockLogger);

      let statuses = await listMigrations();
      expect(statuses.find((s) => s.name === MIGRATION)?.applied).toBe(true);

      await rollbackMigration(MIGRATION, mockLogger);

      statuses = await listMigrations();
      expect(statuses.find((s) => s.name === MIGRATION)?.applied).toBe(false);
    });
  });

  describe('rollback audit logging', () => {
    const MIGRATION = '20260324_sync_configured_queues';

    it('writes exactly one audit entry on a successful rollback', async () => {
      await runMigrations({ dryRun: false }, mockLogger);
      mockWriteAuditLog.mockClear();

      const result = await rollbackMigration(MIGRATION, mockLogger);
      expect(result.success).toBe(true);

      expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
    });

    it('audit entry carries the rollback action and migration identifier', async () => {
      await runMigrations({ dryRun: false }, mockLogger);
      mockWriteAuditLog.mockClear();

      await rollbackMigration(MIGRATION, mockLogger);

      expect(mockWriteAuditLog).toHaveBeenCalledTimes(1);
      const entry = mockWriteAuditLog.mock.calls[0][0] as unknown as Record<string, unknown>;
      expect(entry).toEqual(
        expect.objectContaining({
          action: expect.stringMatching(/rollback/i),
          migration: MIGRATION,
        }),
      );
    });

    it('writes no audit entry when rollback is rejected before execution', async () => {
      const result = await rollbackMigration('nonexistent_migration', mockLogger);
      expect(result.success).toBe(false);

      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });

    it('writes no audit entry when migration was never applied', async () => {
      const result = await rollbackMigration(MIGRATION, mockLogger);
      expect(result.success).toBe(false);

      expect(mockWriteAuditLog).not.toHaveBeenCalled();
    });
  });

  describe('rollback error handling', () => {
    it('returns error when migration name does not exist', async () => {
      const result = await rollbackMigration('nonexistent_migration', mockLogger);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it('returns error when migration was never applied', async () => {
      const result = await rollbackMigration('20260324_sync_configured_queues', mockLogger);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not applied/i);
    });
  });
});
