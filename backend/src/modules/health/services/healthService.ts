import 'reflect-metadata';
import { injectable, inject, optional } from 'inversify';
import { HealthMonitor } from './healthMonitor';
import { TYPES } from '../config/inversify.config';
import { redis } from '../../../lib/redis';

@injectable()
class HealthService {
  private healthMonitor?: HealthMonitor;
  private failureCounters: Map<string, number> = new Map();

  constructor(@inject(TYPES.HealthMonitor) @optional() healthMonitor?: HealthMonitor) {
    this.healthMonitor = healthMonitor;
  }

  setHealthMonitor(monitor: HealthMonitor): void {
    this.healthMonitor = monitor;
  }

  private async simulateCheck(
    serviceName: string,
    baseLatency: number,
  ): Promise<{ status: string; latency: number; lastChecked: string; errorRate: number }> {
    const latency = baseLatency + Math.floor(Math.random() * 20);
    await new Promise((resolve) => setTimeout(resolve, latency));

    const isUnhealthy = serviceName === 'twitter' && Math.random() < 0.2;
    const errorRate = isUnhealthy ? Math.random() * 30 : Math.random() * 2;

    if (isUnhealthy) {
      const counter = (this.failureCounters.get(serviceName) || 0) + 1;
      this.failureCounters.set(serviceName, counter);
    } else {
      this.failureCounters.set(serviceName, 0);
    }

    return {
      status: isUnhealthy ? 'unhealthy' : 'healthy',
      latency,
      errorRate,
      lastChecked: new Date().toISOString(),
    };
  }

  public async checkDatabase() {
    return this.simulateCheck('database', 10);
  }

  public async checkRedis() {
    const start = Date.now();
    try {
      await redis.ping();
      this.failureCounters.set('redis', 0);
      return {
        status: 'healthy',
        latency: Date.now() - start,
        errorRate: 0,
        lastChecked: new Date().toISOString(),
      };
    } catch (err) {
      const count = (this.failureCounters.get('redis') || 0) + 1;
      this.failureCounters.set('redis', count);
      return {
        status: 'unhealthy',
        latency: Date.now() - start,
        errorRate: 100,
        lastChecked: new Date().toISOString(),
      };
    }
  }

  public async checkS3() {
    return this.simulateCheck('s3', 15);
  }

  public async checkTwitterAPI() {
    return this.simulateCheck('twitter', 50);
  }

  public async getSystemStatus() {
    const [database, redis, s3, twitter] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkS3(),
      this.checkTwitterAPI(),
    ]);

    const dependencies = { database, redis, s3, twitter };

    const isUnhealthy = Object.values(dependencies).some((dep) => dep.status !== 'healthy');
    const overallStatus = isUnhealthy ? 'unhealthy' : 'healthy';

    if (this.healthMonitor) {
      await Promise.all(
        Object.entries(dependencies).map(([service, metric]) =>
          this.healthMonitor!.recordMetric({
            service,
            status: metric.status as 'healthy' | 'unhealthy',
            latency: metric.latency,
            errorRate: metric.errorRate,
            consecutiveFailures: this.failureCounters.get(service) || 0,
            lastChecked: metric.lastChecked,
          }),
        ),
      );
    }

    return {
      dependencies,
      overallStatus,
    };
  }
}

export { HealthService };
