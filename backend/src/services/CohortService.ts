import { sqltag, empty } from '@prisma/client/runtime/library';
import { createLogger } from '../lib/logger';
import { prisma } from '../lib/prisma';
const logger = createLogger('cohort-service');

export type CohortLabel =
  | 'Frequent Posters'
  | 'Occasional Posters'
  | 'Lurkers'
  | 'New Users'
  | 'Power Users'
  | 'At-Risk Users'
  | 'Churned Users';

export interface UserActivityStats {
  userId: string;
  email: string;
  role: string;
  joinedAt: Date;
  postCount: number;
  orgCount: number;
  daysSinceJoined: number;
  daysSinceLastPost: number | null;
}

export interface CohortSegment {
  cohort: CohortLabel;
  userIds: string[];
  count: number;
  computedAt: Date;
}

export interface CohortResult {
  organizationId?: string;
  segments: CohortSegment[];
  totalUsers: number;
  computedAt: Date;
}

export interface UserCohort {
  userId: string;
  cohort: CohortLabel;
  stats: UserActivityStats;
  computedAt: Date;
}

// Simple in-memory cache with TTL
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export class CohortService {
  private cache = new Map<string, CacheEntry<CohortResult>>();

  /**
   * Compute cohorts for all users, optionally scoped to an organization.
   * Uses raw SQL aggregation for performance.
   */
  async computeCohorts(organizationId?: string): Promise<CohortResult> {
    const cacheKey = organizationId ?? '__global__';
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.info('Returning cached cohort result', { cacheKey });
      return cached.value;
    }

    logger.info('Computing cohorts', { organizationId });

    const stats = await this.fetchActivityStats(organizationId);
    const segments = this.segmentUsers(stats);

    const result: CohortResult = {
      organizationId,
      segments,
      totalUsers: stats.length,
      computedAt: new Date(),
    };

    this.cache.set(cacheKey, {
      value: result,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    logger.info('Cohort computation complete', {
      totalUsers: stats.length,
      segments: segments.length,
    });

    return result;
  }

  /**
   * Get the cohort for a single user.
   */
  async getUserCohort(userId: string): Promise<UserCohort> {
    const stats = await this.fetchActivityStats(undefined, userId);
    if (!stats.length) throw new Error(`User not found: ${userId}`);

    const cohort = this.classifyUser(stats[0]);
    return { userId, cohort, stats: stats[0], computedAt: new Date() };
  }

  /**
   * Invalidate cached results (call after batch job completes).
   */
  invalidateCache(organizationId?: string): void {
    const key = organizationId ?? '__global__';
    this.cache.delete(key);
    logger.info('Cache invalidated', { key });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Raw SQL aggregation: joins User → OrganizationMember → Post to get
   * per-user activity counts and recency in a single query.
   *
   * SQL-INJECTION AUDIT (issue #922): All user-supplied values (organizationId,
   * userId) are passed as sqltag template parameters, never via string
   * interpolation. Prisma's sqltag sends them as prepared-statement bind
   * variables, so they cannot alter query structure.
   *
   * REVIEW CHECKLIST for any future edits to this method:
   *   - Never use `${value}` inside a plain template literal passed to $queryRaw.
   *   - Always use sqltag`…${value}…` so Prisma parameterises the value.
   *   - Conditional clauses must use sqltag`` fragments or `empty`, not string
   *     concatenation.
   */
  // sql-review: raw query — all dynamic values are sqltag-parameterised
  private async fetchActivityStats(
    organizationId?: string,
    userId?: string,
  ): Promise<UserActivityStats[]> {
    type RawRow = {
      user_id: string;
      email: string;
      role: string;
      joined_at: Date;
      post_count: bigint;
      org_count: bigint;
      days_since_joined: number;
      days_since_last_post: number | null;
    };

    const rows = (await prisma.$queryRaw(sqltag`
      SELECT
        u.id                                                        AS user_id,
        u.email,
        u.role,
        u."createdAt"                                               AS joined_at,
        COUNT(DISTINCT p.id)                                        AS post_count,
        COUNT(DISTINCT om.organization_id)                          AS org_count,
        EXTRACT(EPOCH FROM (NOW() - u."createdAt")) / 86400         AS days_since_joined,
        EXTRACT(EPOCH FROM (NOW() - MAX(p."createdAt"))) / 86400    AS days_since_last_post
      FROM "User" u
      LEFT JOIN "OrganizationMember" om ON om."userId" = u.id
        ${organizationId ? sqltag`AND om.organization_id = ${organizationId}` : empty}
      LEFT JOIN "Post" p ON p."organizationId" = om."organizationId"
      WHERE u."deletedAt" IS NULL
        ${userId ? sqltag`AND u.id = ${userId}` : empty}
      GROUP BY u.id, u.email, u.role, u."createdAt"
    `)) as RawRow[];

    return rows.map((r: RawRow) => ({
      userId: r.user_id,
      email: r.email,
      role: r.role,
      joinedAt: r.joined_at,
      postCount: Number(r.post_count),
      orgCount: Number(r.org_count),
      daysSinceJoined: Math.floor(r.days_since_joined),
      daysSinceLastPost: r.days_since_last_post != null ? Math.floor(r.days_since_last_post) : null,
    }));
  }

  /**
   * Classify a single user into a cohort label based on activity thresholds.
   *
   * Thresholds (tunable):
   *   New Users        – joined within last 7 days
   *   Power Users      – 30+ posts AND active within 7 days
   *   Frequent Posters – 10+ posts AND active within 14 days
   *   Occasional Posters – 1–9 posts AND active within 30 days
   *   At-Risk Users    – had posts but inactive 30–90 days
   *   Churned Users    – had posts but inactive 90+ days
   *   Lurkers          – 0 posts
   */
  private classifyUser(s: UserActivityStats): CohortLabel {
    if (s.daysSinceJoined <= 7) return 'New Users';
    if (s.postCount === 0) return 'Lurkers';

    const lastPost = s.daysSinceLastPost ?? Infinity;

    if (s.postCount >= 30 && lastPost <= 7) return 'Power Users';
    if (s.postCount >= 10 && lastPost <= 14) return 'Frequent Posters';
    if (s.postCount >= 1 && lastPost <= 30) return 'Occasional Posters';
    if (lastPost > 90) return 'Churned Users';
    return 'At-Risk Users';
  }

  private segmentUsers(stats: UserActivityStats[]): CohortSegment[] {
    const groups = new Map<CohortLabel, string[]>();

    for (const s of stats) {
      const label = this.classifyUser(s);
      const existing = groups.get(label) ?? [];
      existing.push(s.userId);
      groups.set(label, existing);
    }

    const now = new Date();
    return Array.from(groups.entries()).map(([cohort, userIds]) => ({
      cohort,
      userIds,
      count: userIds.length,
      computedAt: now,
    }));
  }
}

export const cohortService = new CohortService();
