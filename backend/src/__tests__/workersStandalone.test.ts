/**
 * Tests for the standalone worker entrypoint (workers/standalone.ts).
 *
 * Verifies that tracing is loaded before the workers start, that startWorkers
 * is called exactly once, and that SIGTERM/SIGINT trigger a graceful shutdown.
 */

const callOrder: string[] = [];
const mockAiClose = jest.fn().mockResolvedValue(undefined);
const mockSocialClose = jest.fn().mockResolvedValue(undefined);
const mockStartWorkers = jest.fn();
const mockCloseRedisClient = jest.fn();

jest.mock('../tracing', () => {
  callOrder.push('tracing');
  return {};
});

jest.mock('../workers/index', () => ({
  startWorkers: (...args: unknown[]) => mockStartWorkers(...args),
}));

jest.mock('../queues/queueManager', () => ({
  closeRedisClient: (...args: unknown[]) => mockCloseRedisClient(...args),
}));

jest.mock('../lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }),
}));

describe('workers/standalone', () => {
  let handlers: Record<string, () => void>;
  let onSpy: jest.SpyInstance;
  let exitSpy: jest.SpyInstance;

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  const loadModule = () => {
    jest.isolateModules(() => {
      require('../workers/standalone');
    });
  };

  beforeEach(() => {
    callOrder.length = 0;
    handlers = {};
    mockAiClose.mockReset().mockResolvedValue(undefined);
    mockSocialClose.mockReset().mockResolvedValue(undefined);
    mockCloseRedisClient.mockReset().mockResolvedValue(undefined);
    mockStartWorkers.mockReset().mockImplementation(() => {
      callOrder.push('startWorkers');
      return { ai: { close: mockAiClose }, social: { close: mockSocialClose } };
    });
    onSpy = jest.spyOn(process, 'on').mockImplementation(((event: string, handler: () => void) => {
      handlers[event] = handler;
      return process;
    }) as never);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    onSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('loads tracing before calling startWorkers', () => {
    loadModule();
    expect(callOrder).toEqual(['tracing', 'startWorkers']);
  });

  it('calls startWorkers exactly once', () => {
    loadModule();
    expect(mockStartWorkers).toHaveBeenCalledTimes(1);
  });

  it('registers SIGTERM and SIGINT handlers', () => {
    loadModule();
    expect(typeof handlers.SIGTERM).toBe('function');
    expect(typeof handlers.SIGINT).toBe('function');
  });

  it.each(['SIGTERM', 'SIGINT'])(
    'closes workers and redis, then exits 0 on %s',
    async (signal) => {
      loadModule();
      handlers[signal]();
      await flush();

      expect(mockAiClose).toHaveBeenCalledTimes(1);
      expect(mockSocialClose).toHaveBeenCalledTimes(1);
      expect(mockCloseRedisClient).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
    },
  );

  it('exits 1 and skips closing redis when a worker fails to close', async () => {
    mockAiClose.mockRejectedValue(new Error('close failed'));
    loadModule();
    handlers.SIGTERM();
    await flush();

    expect(mockCloseRedisClient).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits 1 when closing the redis client fails', async () => {
    mockCloseRedisClient.mockRejectedValue(new Error('redis down'));
    loadModule();
    handlers.SIGINT();
    await flush();

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
