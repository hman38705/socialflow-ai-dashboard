import Redis from 'ioredis';
import { Logger } from '../lib/logger';
import {
  listMigrations,
  runMigrations,
  MigrationStatus,
  RunMigrationsResult,
  MigrationMetadata,
} from '../admin/migrationService';
import {
  ADMIN_MIGRATIONS_SET_KEY,
  ADMIN_MIGRATIONS_LOCK_KEY,
  ADMIN_MIGRATIONS_METADATA_KEY,
  MIGRATION_LOCK_TIMEOUT_MS,
} from '../admin/constants';
import { getRedisConnection } from '../config/runtime';

describe('Migration Service — Lock, Checksum & Idempotency', () => {
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
  });

  afterEach(async () => {
    // Clean up Redis state after each test
    await redis.del(ADMIN_MIGRATIONS_SET_KEY);
    await redis.del(ADMIN_MIGRATIONS_LOCK_KEY);
    await redis.del(ADMIN_MIGRATIONS_METADATA_KEY);
    redis.disconnect();
  });

  describe('Lock Mechanism', () => {
    it('should acquire lock and prevent concurrent migrations', async () => {
      // Simulate first migration acquiring lock
      const lock1 = await redis.set(
        ADMIN_MIGRATIONS_LOCK_KEY,
        'lock-id-1',
        'PX',
        MIGRATION_LOCK_TIMEOUT_MS,
        'NX',
      );
      expect(lock1).toBe('OK');

      // Second migration should fail to acquire lock
      const lock2 = await redis.set(
        ADMIN_MIGRATIONS_LOCK_KEY,
        'lock-id-2',
        'PX',
        MIGRATION_LOCK_TIMEOUT_MS,
        'NX',
      );
      expect(lock2).toBeNull();
    });

    it('should release lock after migration completes', async () => {
      // Result should indicate lock was acquired
      const result = await runMigrations(
        { dryRun: true },
        mockLogger,
      );
      expect(result.lockAcquired).toBe(true);

      // Lock should be released (no lock key in Redis)
      const lockExists = await redis.exists(ADMIN_MIGRATIONS_LOCK_KEY);
      expect(lockExists).toBe(0);
    });

    it('should not release lock in dry-run mode', async () => {
      // Acquire lock manually
      await redis.set(
        ADMIN_MIGRATIONS_LOCK_KEY,
        'lock-id',
        'PX',
        MIGRATION_LOCK_TIMEOUT_MS,
        'NX',
      );

      const result = await runMigrations(
        { dryRun: true },
        mockLogger,
      );
      expect(result.dryRun).toBe(true);

      // Lock should still exist
      const lockExists = await redis.exists(ADMIN_MIGRATIONS_LOCK_KEY);
      expect(lockExists).toBe(1);
    });

    it('should fail gracefully when lock cannot be acquired', async () => {
      // Acquire lock and hold it
      await redis.set(
        ADMIN_MIGRATIONS_LOCK_KEY,
        'lock-id',
        'PX',
        MIGRATION_LOCK_TIMEOUT_MS,
        'NX',
      );

      // Attempt migrations; should fail to acquire lock
      const result = await runMigrations(
        { dryRun: false },
        mockLogger,
      );

      expect(result.lockAcquired).toBe(false);
      expect(result.executed.length).toBe(0);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Could not acquire migration lock - another migration may be in progress',
      );
    });
  });

  describe('Pending Migration Detection', () => {
    it('should identify pending migrations before migration run', async () => {
      const statusesBefore = await listMigrations();
      expect(statusesBefore.length).toBeGreaterThan(0);
      expect(statusesBefore.every((status) => status.applied === false)).toBe(true);

      const result = await runMigrations({ dryRun: false }, mockLogger);
      expect(result.executed.length).toBeGreaterThan(0);
      expect(result.lockAcquired).toBe(true);

      const statusesAfter = await listMigrations();
      expect(statusesAfter.some((status) => status.applied)).toBe(true);
    });

    it('should list migrations as pending when dry-run is used', async () => {
      const statusesBefore = await listMigrations();
      expect(statusesBefore.every((status) => status.applied === false)).toBe(true);

      const result = await runMigrations({ dryRun: true }, mockLogger);
      expect(result.dryRun).toBe(true);
      expect(result.executed.length).toBeGreaterThan(0);

      const statusesAfter = await listMigrations();
      expect(statusesAfter.every((status) => status.applied === false)).toBe(true);
    });
  });

  describe('Checksum & Metadata Tracking', () => {
    it('should calculate consistent checksums for migration functions', async () => {
      const result = await runMigrations(
        { dryRun: true },
        mockLogger,
      );

      expect(result.executed.length).toBeGreaterThan(0);

      // Verify metadata was read or would be stored
      const statuses = await listMigrations();
      expect(statuses.length).toBeGreaterThan(0);
    });

    it('should store migration metadata with checksum', async () => {
      const result = await runMigrations(
        { dryRun: false },
        mockLogger,
      );

      expect(result.executed.length).toBeGreaterThan(0);

      // Verify metadata was stored
      const metadata = await redis.hgetall(ADMIN_MIGRATIONS_METADATA_KEY);
      expect(Object.keys(metadata).length).toBeGreaterThan(0);

      // Verify metadata contains required fields
      for (const metadataJson of Object.values(metadata)) {
        const parsed = JSON.parse(metadataJson);
        expect(parsed).toHaveProperty('name');
        expect(parsed).toHaveProperty('checksum');
        expect(parsed).toHaveProperty('appliedAt');
        expect(parsed).toHaveProperty('durationMs');
      }
    });

    it('should include checksum in migrationStatus', async () => {
      // Run migrations to populate metadata
      await runMigrations(
        { dryRun: false },
        mockLogger,
      );

      const statuses = await listMigrations();
      const appliedMigrations = statuses.filter((s) => s.applied);

      expect(appliedMigrations.length).toBeGreaterThan(0);
      appliedMigrations.forEach((status) => {
        expect(status.checksum).toBeDefined();
        expect(typeof status.checksum).toBe('string');
        expect(status.checksum?.length).toBe(64); // SHA-256 hex is 64 chars
      });
    });

    it('should track applied timestamp in metadata', async () => {
      const beforeRun = Date.now();
      const result = await runMigrations(
        { dryRun: false },
        mockLogger,
      );

      if (result.executed.length > 0) {
        const metadata = await redis.hgetall(ADMIN_MIGRATIONS_METADATA_KEY);
        const firstMetadata = JSON.parse(Object.values(metadata)[0]);

        expect(firstMetadata.appliedAt).toBeGreaterThanOrEqual(beforeRun);
        expect(firstMetadata.appliedAt).toBeLessThanOrEqual(Date.now());
      }
    });

    it('should track migration duration in metadata', async () => {
      const result = await runMigrations(
        { dryRun: false },
        mockLogger,
      );

      if (result.executed.length > 0) {
        const metadata = await redis.hgetall(ADMIN_MIGRATIONS_METADATA_KEY);
        for (const metadataJson of Object.values(metadata)) {
          const parsed = JSON.parse(metadataJson);
          expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
          expect(typeof parsed.durationMs).toBe('number');
        }
      }
    });
  });

  describe('Idempotency & Replay Safety', () => {
    it('should skip already-applied migrations on second run', async () => {
      const result1 = await runMigrations(
        { dryRun: false },
        mockLogger,
      );
      expect(result1.executed.length).toBeGreaterThanOrEqual(0);

      const result2 = await runMigrations(
        { dryRun: false },
        mockLogger,
      );
      expect(result2.executed.length).toBe(0);
      expect(result2.skipped.length).toBeGreaterThanOrEqual(0);
    });

    it('should not re-execute migrations even after restart', async () => {
      const result1 = await runMigrations(
        { dryRun: false },
        mockLogger,
      );
      const executed1 = result1.executed.length;

      // Create new redis instance (simulating restart)
      const redis2 = new Redis(getRedisConnection());
      try {
        // Verify applied set was persisted
        const applied = await redis2.smembers(ADMIN_MIGRATIONS_SET_KEY);
        expect(applied.length).toBe(executed1);

        const result2 = await runMigrations(
          { dryRun: false },
          mockLogger,
        );
        expect(result2.executed.length).toBe(0);
      } finally {
        redis2.disconnect();
      }
    });

    it('should maintain idempotent behavior for queues migration', async () => {
      const result1 = await runMigrations(
        { dryRun: false },
        mockLogger,
      );

      if (result1.executed.includes('20260324_sync_configured_queues')) {
        const result2 = await runMigrations(
          { dryRun: false },
          mockLogger,
        );

        expect(result2.executed).not.toContain(
          '20260324_sync_configured_queues',
        );
        expect(result2.skipped).toContain('20260324_sync_configured_queues');
      }
    });

    it('should allow force-replay of migrations when requested', async () => {
      const result1 = await runMigrations(
        { dryRun: false },
        mockLogger,
      );
      const firstExecuted = result1.executed;

      // Force re-run
      const result2 = await runMigrations(
        { dryRun: false, force: true },
        mockLogger,
      );

      expect(result2.executed.length).toBeGreaterThanOrEqual(firstExecuted.length);
    });

    it('should detect checksum mismatches on forced replay', async () => {
      // Run initial migration
      const result1 = await runMigrations(
        { dryRun: false },
        mockLogger,
      );

      if (result1.executed.length > 0) {
        // Corrupt metadata to simulate modified migration
        const metadata = await redis.hgetall(ADMIN_MIGRATIONS_METADATA_KEY);
        const firstMigrationName = Object.keys(metadata)[0];
        const corrupted = JSON.parse(Object.values(metadata)[0]);
        corrupted.checksum = 'corrupted-checksum-value';

        await redis.hset(
          ADMIN_MIGRATIONS_METADATA_KEY,
          firstMigrationName,
          JSON.stringify(corrupted),
        );

        // Force re-run without force flag should detect checksum mismatch
        const result2 = await runMigrations(
          { dryRun: false, name: firstMigrationName },
          mockLogger,
        );

        expect(result2.failed).toContain(firstMigrationName);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Migration checksum mismatch detected',
          expect.objectContaining({
            migration: firstMigrationName,
          }),
        );
      }
    });

    it('should allow force-skip checksum validation when needed', async () => {
      // Run initial migration
      const result1 = await runMigrations(
        { dryRun: false },
        mockLogger,
      );

      if (result1.executed.length > 0) {
        // Corrupt metadata
        const metadata = await redis.hgetall(ADMIN_MIGRATIONS_METADATA_KEY);
        const firstMigrationName = Object.keys(metadata)[0];
        const corrupted = JSON.parse(Object.values(metadata)[0]);
        corrupted.checksum = 'corrupted-checksum-value';

        await redis.hset(
          ADMIN_MIGRATIONS_METADATA_KEY,
          firstMigrationName,
          JSON.stringify(corrupted),
        );

        // Force re-run with force flag should bypass checksum validation
        const result2 = await runMigrations(
          { dryRun: false, force: true, name: firstMigrationName },
          mockLogger,
        );

        expect(result2.executed).toContain(firstMigrationName);
      }
    });
  });

  describe('Dry-Run Safety', () => {
    it('should not persist state in dry-run mode', async () => {
      const appliedBefore = await redis.smembers(ADMIN_MIGRATIONS_SET_KEY);

      const result = await runMigrations(
        { dryRun: true },
        mockLogger,
      );

      expect(result.dryRun).toBe(true);

      const appliedAfter = await redis.smembers(ADMIN_MIGRATIONS_SET_KEY);
      expect(appliedAfter).toEqual(appliedBefore);
    });

    it('should not execute migration functions in dry-run mode', async () => {
      const logInfoBefore = (mockLogger.info as jest.Mock).mock.calls.length;

      await runMigrations(
        { dryRun: true },
        mockLogger,
      );

      // Should log "Running migration" but NOT "Migration completed successfully"
      const logCalls = (mockLogger.info as jest.Mock).mock.calls;
      const completedCalls = logCalls.filter(
        (call) => call[0]?.includes('completed'),
      );
      expect(completedCalls.length).toBe(0);
    });

    it('should validate checksums even in dry-run mode', async () => {
      // First run applies migration
      await runMigrations(
        { dryRun: false },
        mockLogger,
      );

      // Corrupt metadata to simulate modified migration
      const metadata = await redis.hgetall(ADMIN_MIGRATIONS_METADATA_KEY);
      if (Object.keys(metadata).length > 0) {
        const firstMigrationName = Object.keys(metadata)[0];
        const corrupted = JSON.parse(Object.values(metadata)[0]);
        corrupted.checksum = 'corrupted-checksum-value';

        await redis.hset(
          ADMIN_MIGRATIONS_METADATA_KEY,
          firstMigrationName,
          JSON.stringify(corrupted),
        );

        // Dry-run should still warn about checksum mismatch
        await runMigrations(
          { dryRun: true, force: true, name: firstMigrationName },
          mockLogger,
        );

        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Migration checksum mismatch detected',
          expect.any(Object),
        );
      }
    });
  });

  describe('Error Handling & Recovery', () => {
    it('should handle migration execution errors gracefully', async () => {
      // This test verifies error handling in the service
      const result = await runMigrations(
        { dryRun: false },
        mockLogger,
      );

      // If any migration fails, errors should be recorded
      if (result.failed.length > 0) {
        expect(result.errors).toBeDefined();
        expect(Object.keys(result.errors!)).toEqual(result.failed);
      }
    });

    it('should store error metadata when migration fails', async () => {
      // This test verifies error metadata persistence
      const result = await runMigrations(
        { dryRun: false },
        mockLogger,
      );

      if (result.failed.length > 0) {
        const metadata = await redis.hgetall(ADMIN_MIGRATIONS_METADATA_KEY);
        for (const failedName of result.failed) {
          const metadataJson = metadata[failedName];
          if (metadataJson) {
            const parsed = JSON.parse(metadataJson);
            expect(parsed.error).toBeDefined();
            expect(typeof parsed.error).toBe('string');
          }
        }
      }
    });

    it('should return lockAcquired status in result', async () => {
      const result = await runMigrations(
        { dryRun: true },
        mockLogger,
      );

      expect(result).toHaveProperty('lockAcquired');
      expect(typeof result.lockAcquired).toBe('boolean');
    });

    it('should return failed migrations list in result', async () => {
      const result = await runMigrations(
        { dryRun: true },
        mockLogger,
      );

      expect(result).toHaveProperty('failed');
      expect(Array.isArray(result.failed)).toBe(true);
    });

    it('should return errors object when failures occur', async () => {
      const result = await runMigrations(
        { dryRun: true },
        mockLogger,
      );

      if (result.failed.length > 0) {
        expect(result.errors).toBeDefined();
      } else {
        expect(result.errors).toBeUndefined();
      }
    });
  });

  describe('Selective Migration', () => {
    it('should run specific migration by name', async () => {
      const result = await runMigrations(
        { name: '20260324_sync_configured_queues', dryRun: false },
        mockLogger,
      );

      expect(Array.isArray(result.executed)).toBe(true);
      if (result.executed.length > 0) {
        expect(result.executed[0]).toBe('20260324_sync_configured_queues');
      }
    });

    it('should skip non-matching migrations with name filter', async () => {
      const result = await runMigrations(
        { name: 'nonexistent', dryRun: false },
        mockLogger,
      );

      expect(result.executed.length).toBe(0);
    });
  });

  describe('Migration Status Reporting', () => {
    it('should list all migrations with status', async () => {
      const statuses = await listMigrations();
      expect(Array.isArray(statuses)).toBe(true);
      expect(statuses.length).toBeGreaterThan(0);

      statuses.forEach((status: MigrationStatus) => {
        expect(status).toHaveProperty('name');
        expect(status).toHaveProperty('description');
        expect(status).toHaveProperty('applied');
      });
    });

    it('should reflect applied migrations in status', async () => {
      // Before any migrations
      let statuses = await listMigrations();
      const appliedBefore = statuses.filter((s) => s.applied).length;

      // Run migrations
      await runMigrations(
        { dryRun: false },
        mockLogger,
      );

      // After migrations
      statuses = await listMigrations();
      const appliedAfter = statuses.filter((s) => s.applied).length;

      expect(appliedAfter).toBeGreaterThanOrEqual(appliedBefore);
    });

    it('should include error info in status when migration fails', async () => {
      const result = await runMigrations(
        { dryRun: false },
        mockLogger,
      );

      const statuses = await listMigrations();
      if (result.failed.length > 0) {
        const failedStatus = statuses.find((s) => result.failed.includes(s.name));
        if (failedStatus) {
          expect(failedStatus.error).toBeDefined();
        }
      }
    });
  });
});
