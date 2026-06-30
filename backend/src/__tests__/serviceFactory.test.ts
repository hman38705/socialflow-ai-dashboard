import { jest } from '@jest/globals';

describe('serviceFactory', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('resolves DI services through the container when loaded', () => {
    const registry = new Map<string, object>();
    const getMock = jest.fn().mockImplementation((key: string) => {
      if (!registry.has(key)) {
        registry.set(key, { key });
      }
      return registry.get(key)!;
    });

    const TYPES = {
      HealthService: 'HealthService',
      HealthMonitor: 'HealthMonitor',
      NotificationManager: 'NotificationManager',
      AlertConfigService: 'AlertConfigService',
    };

    jest.mock('../config/inversify.config', () => ({
      container: { get: getMock },
      TYPES,
    }));

    jest.isolateModules(() => {
      const serviceFactory = require('../services/serviceFactory');

      expect(getMock).toHaveBeenCalledWith(TYPES.HealthService);
      expect(getMock).toHaveBeenCalledWith(TYPES.AlertConfigService);
      expect(getMock).toHaveBeenCalledTimes(2);

      expect(serviceFactory.getHealthService()).toBe(registry.get(TYPES.HealthService));
      expect(serviceFactory.getHealthMonitor()).toBe(registry.get(TYPES.HealthMonitor));
      expect(serviceFactory.getNotificationManager()).toBe(registry.get(TYPES.NotificationManager));
      expect(serviceFactory.getAlertConfigService()).toBe(registry.get(TYPES.AlertConfigService));

      expect(serviceFactory.healthService).toBe(registry.get(TYPES.HealthService));
      expect(serviceFactory.alertConfigService).toBe(registry.get(TYPES.AlertConfigService));
    });
  });

  it('returns the same singleton instance for repeated getHealthService calls', () => {
    const registry = new Map<string, object>();
    const getMock = jest.fn().mockImplementation((key: string) => {
      if (!registry.has(key)) {
        registry.set(key, { key });
      }
      return registry.get(key)!;
    });

    const TYPES = {
      HealthService: 'HealthService',
      HealthMonitor: 'HealthMonitor',
      NotificationManager: 'NotificationManager',
      AlertConfigService: 'AlertConfigService',
    };

    jest.mock('../config/inversify.config', () => ({
      container: { get: getMock },
      TYPES,
    }));

    jest.isolateModules(() => {
      const serviceFactory = require('../services/serviceFactory');

      expect(serviceFactory.getHealthService()).toBe(serviceFactory.healthService);
      expect(serviceFactory.getHealthService()).toBe(serviceFactory.healthService);
      expect(serviceFactory.getAlertConfigService()).toBe(serviceFactory.alertConfigService);
      expect(serviceFactory.getAlertConfigService()).toBe(serviceFactory.alertConfigService);
    });
  });
});
