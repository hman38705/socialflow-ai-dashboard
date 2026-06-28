/**
 * #1120 — cohortJob/CohortService must skip malformed member records instead
 * of aborting the whole batch.
 */
const mockQueryRaw = jest.fn();

jest.mock('../../lib/prisma', () => ({
  prisma: { $queryRaw: (...args: unknown[]) => mockQueryRaw(...args) },
}));

const warn = jest.fn();
jest.mock('../../lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn, error: jest.fn() }),
}));

import { CohortService } from '../CohortService';

function row(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    email: 'user1@example.com',
    role: 'member',
    joined_at: new Date('2020-01-01'),
    post_count: 5n,
    org_count: 1n,
    days_since_joined: 100,
    days_since_last_post: 5,
    ...overrides,
  };
}

describe('CohortService — malformed record isolation', () => {
  let service: CohortService;

  beforeEach(() => {
    service = new CohortService();
    mockQueryRaw.mockReset();
    warn.mockReset();
  });

  it('skips a malformed record and still segments the healthy ones', async () => {
    mockQueryRaw.mockResolvedValue([
      row({ user_id: 'healthy-1', days_since_joined: 100, post_count: 0n }),
      // Malformed: days_since_joined is not a finite number (e.g. left null by a migration)
      row({ user_id: 'broken-1', days_since_joined: Number.NaN }),
      row({ user_id: 'healthy-2', days_since_joined: 200, post_count: 50n }),
    ]);

    const result = await service.computeCohorts('org-1');

    const allUserIds = result.segments.flatMap((s) => s.userIds);
    expect(allUserIds).toContain('healthy-1');
    expect(allUserIds).toContain('healthy-2');
    expect(allUserIds).not.toContain('broken-1');
  });

  it('logs a warning for each skipped record', async () => {
    mockQueryRaw.mockResolvedValue([
      row({ user_id: 'broken-1', days_since_joined: Number.NaN }),
      row({ user_id: 'healthy-1' }),
    ]);

    await service.computeCohorts('org-1');

    expect(warn).toHaveBeenCalledWith(
      'Skipping malformed cohort record',
      expect.objectContaining({ userId: 'broken-1' }),
    );
  });

  it('does not throw or abort the batch when every record is malformed', async () => {
    mockQueryRaw.mockResolvedValue([
      row({ user_id: 'broken-1', days_since_joined: Number.NaN }),
      row({ user_id: 'broken-2', days_since_joined: Number.NaN }),
    ]);

    const result = await service.computeCohorts('org-1');

    expect(result.segments.flatMap((s) => s.userIds)).toHaveLength(0);
  });
});
