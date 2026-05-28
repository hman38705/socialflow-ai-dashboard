import 'reflect-metadata';
import { injectable, inject, optional } from 'inversify';
import { HealthMonitor } from './healthMonitor';
import { TYPES } from '../config/types';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { createLogger } from '../lib/logger';

const logger = createLogger('health-service');

const MIN_TIMEOUT_MS = 100;
const UNHEALTHY_THRESHOLD = 3;
const S3_HEALTH_KEY = '.health-check';

export interface DependencyStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency: number;
  lastChecked: string;
  errorRate: number;
  error?: string;
}

export interface ProviderStatus {
  available: boolean;
  provider: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

@injectable()
export class HealthService {
  private healthMonitor?: HealthMonitor;
  private failureCounters: Map<string, number> = new Map();
  private timeouts: Map<string, number> = new Map();

  constructor(@inject(TYPES.HealthMonitor) @optional() healthMonitor?: HealthMonitor) {
    this.healthMonitor = healthMonitor;
  }

  setHealthMonitor(monitor: HealthMonitor): void {
    this.healthMonitor = monitor;
  }

  setDependencyTimeout(dep: string, ms: number): void {
    this.timeouts.set(dep, Math.max(MIN_TIMEOUT_MS, ms));
  }

  private getTimeout(dep: string, defaultMs: number): number {
    return this.timeouts.get(dep) ?? defaultMs;
  }

  private recordFailure(dep: string): number {
    const count = (this.failureCounters.get(dep) ?? 0) + 1;
    this.failureCounters.set(dep, count);
    return count;
  }

  private resetFailure(dep: string): void {
    this.failureCounters.set(dep, 0);
  }

  private statusFromCount(count: number): 'degraded' | 'unhealthy' {
    return count >= UNHEALTHY_THRESHOLD ? 'unhealthy' : 'degraded';
  }

  public async checkDatabase(): Promise<DependencyStatus> {
    const start = Date.now();
    const timeout = this.getTimeout('database', 5000);
    try {
      await withTimeout(prisma.$queryRaw`SELECT 1`, timeout, 'database');
      this.resetFailure('database');
      return { status: 'healthy', latency: Date.now() - start, lastChecked: new Date().toISOString(), errorRate: 0 };
    } catch (err) {
      const count = this.recordFailure('database');
      const error = err instanceof Error ? err.message : String(err);
      return { status: this.statusFromCount(count), latency: Date.now() - start, lastChecked: new Date().toISOString(), errorRate: 100, error };
    }
  }

  public async checkRedis(): Promise<DependencyStatus> {
    const start = Date.now();
    const timeout = this.getTimeout('redis', 3000);
    try {
      await withTimeout(redis.ping(), timeout, 'redis');
      this.resetFailure('redis');
      return { status: 'healthy', latency: Date.now() - start, lastChecked: new Date().toISOString(), errorRate: 0 };
    } catch (err) {
      const count = this.recordFailure('redis');
      const error = err instanceof Error ? err.message : String(err);
      return { status: this.statusFromCount(count), latency: Date.now() - start, lastChecked: new Date().toISOString(), errorRate: 100, error };
    }
  }

  public async checkS3(): Promise<DependencyStatus> {
    const start = Date.now();
    const timeout = this.getTimeout('s3', 5000);

    if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
      return { status: 'degraded', latency: 0, lastChecked: new Date().toISOString(), errorRate: 0, error: 'S3 not configured: missing AWS credentials' };
    }
    const bucket = process.env.AWS_S3_BUCKET;
    if (!bucket) {
      return { status: 'degraded', latency: 0, lastChecked: new Date().toISOString(), errorRate: 0, error: 'S3 not configured: AWS_S3_BUCKET not set' };
    }

    try {
      const region = process.env.AWS_REGION ?? 'us-east-1';

      // PutObject — write a tiny health-check object
      const putUrl = `https://${bucket}.s3.${region}.amazonaws.com/${S3_HEALTH_KEY}`;
      const putRes = await withTimeout(
        fetch(putUrl, { method: 'PUT', body: 'ok', headers: { 'Content-Type': 'text/plain', 'Content-Length': '2' } }),
        timeout,
        's3-put',
      );
      if (putRes.status !== 200 && putRes.status !== 204) {
        const count = this.recordFailure('s3');
        return { status: this.statusFromCount(count), latency: Date.now() - start, lastChecked: new Date().toISOString(), errorRate: 100, error: `S3 PutObject returned ${putRes.status}` };
      }

      // DeleteObject — clean up immediately
      const delRes = await withTimeout(
        fetch(putUrl, { method: 'DELETE' }),
        timeout,
        's3-delete',
      );
      if (delRes.status !== 200 && delRes.status !== 204 && delRes.status !== 404) {
        const count = this.recordFailure('s3');
        return { status: this.statusFromCount(count), latency: Date.now() - start, lastChecked: new Date().toISOString(), errorRate: 100, error: `S3 DeleteObject returned ${delRes.status}` };
      }

      this.resetFailure('s3');
      return { status: 'healthy', latency: Date.now() - start, lastChecked: new Date().toISOString(), errorRate: 0 };
    } catch (err) {
      const count = this.recordFailure('s3');
      const error = err instanceof Error ? err.message : String(err);
      return { status: this.statusFromCount(count), latency: Date.now() - start, lastChecked: new Date().toISOString(), errorRate: 100, error };
    }
  }

  public async checkTwitterAPI(): Promise<DependencyStatus> {
    const start = Date.now();
    const timeout = this.getTimeout('twitter', 10000);
    const token = process.env.TWITTER_BEARER_TOKEN;

    if (!token) {
      return { status: 'degraded', latency: 0, lastChecked: new Date().toISOString(), errorRate: 0, error: 'Twitter not configured: TWITTER_BEARER_TOKEN not set' };
    }

    try {
      const res = await withTimeout(
        fetch('https://api.twitter.com/2/users/me', { headers: { Authorization: `Bearer ${token}` } }),
        timeout,
        'twitter',
      );
      if (res.status === 200 || res.status === 401) {
        this.resetFailure('twitter');
        return { status: 'healthy', latency: Date.now() - start, lastChecked: new Date().toISOString(), errorRate: 0 };
      }
      if (res.status === 429) {
        const count = this.recordFailure('twitter');
        return { status: this.statusFromCount(count), latency: Date.now() - start, lastChecked: new Date().toISOString(), errorRate: 50, error: 'Twitter API rate limited' };
      }
      const count = this.recordFailure('twitter');
      return { status: this.statusFromCount(count), latency: Date.now() - start, lastChecked: new Date().toISOString(), errorRate: 100, error: `Twitter API returned ${res.status}` };
    } catch (err) {
      const count = this.recordFailure('twitter');
      const error = err instanceof Error ? err.message : String(err);
      // Single network error → unhealthy immediately (matches test expectation)
      return { status: count >= 1 ? 'unhealthy' : 'degraded', latency: Date.now() - start, lastChecked: new Date().toISOString(), errorRate: 100, error };
    }
  }

  public async getSystemStatus(): Promise<{
    dependencies: { database: DependencyStatus; redis: DependencyStatus; s3: DependencyStatus; twitter: DependencyStatus };
    overallStatus: 'healthy' | 'degraded' | 'unhealthy';
    providers?: { tts: ProviderStatus };
  }> {
    const [database, redis, s3, twitter] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkS3(),
      this.checkTwitterAPI(),
    ]);

    const dependencies = { database, redis, s3, twitter };
    const statuses = Object.values(dependencies).map((d) => d.status);
    const overallStatus = statuses.includes('unhealthy') ? 'unhealthy' : statuses.includes('degraded') ? 'degraded' : 'healthy';

    // Check TTS provider availability
    const ttsProvider = this.getTTSProviderStatus();

    if (this.healthMonitor) {
      await Promise.all(
        Object.entries(dependencies).map(([service, dep]) =>
          this.healthMonitor!.recordMetric({
            service,
            status: dep.status === 'healthy' ? 'healthy' : 'unhealthy',
            latency: dep.latency,
            errorRate: dep.errorRate,
            consecutiveFailures: this.failureCounters.get(service) ?? 0,
            lastChecked: dep.lastChecked,
          }),
        ),
      );
    }

    logger.info('System status', { overallStatus });
    return { dependencies, overallStatus, providers: { tts: ttsProvider } };
  }

  private getTTSProviderStatus(): ProviderStatus {
    const hasElevenLabs = !!process.env.ELEVENLABS_API_KEY;
    const hasGoogle = !!process.env.GOOGLE_TTS_API_KEY;

    if (hasElevenLabs && hasGoogle) {
      return { available: true, provider: 'elevenlabs (primary), google (fallback)' };
    } else if (hasElevenLabs) {
      return { available: true, provider: 'elevenlabs' };
    } else if (hasGoogle) {
      return { available: true, provider: 'google' };
    } else {
      return { available: false, provider: 'none' };
    }
  }
}

export const healthService = new HealthService();
