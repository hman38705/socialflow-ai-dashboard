/**
 * #1056 — dataPruningJob unit tests
 * Covers: pruning decision logic (enabled/disabled, delete vs archive) and
 * Prometheus metrics emission (filesPrunedTotal, filesArchivedTotal).
 */

// ── mock dataPruningService ───────────────────────────────────────────────────
const mockRunDataPruning = jest.fn();
jest.mock('../retention/dataPruningService', () => ({
  runDataPruning: mockRunDataPruning,
}));

// ── mock Prometheus counters ──────────────────────────────────────────────────
const mockFilesPrunedInc = jest.fn();
const mockFilesArchivedInc = jest.fn();
jest.mock('../lib/metrics', () => ({
  filesPrunedTotal: { inc: mockFilesPrunedInc },
  filesArchivedTotal: { inc: mockFilesArchivedInc },
}));

// ── mock OpenTelemetry ────────────────────────────────────────────────────────
const mockSpan = {
  setAttributes: jest.fn(),
  setStatus: jest.fn(),
  recordException: jest.fn(),
  end: jest.fn(),
};
jest.mock('@opentelemetry/api', () => ({
  trace: { getTracer: () => ({ startSpan: () => mockSpan }) },
  SpanStatusCode: { OK: 1, ERROR: 2 },
}));

// ── mock BullMQ ───────────────────────────────────────────────────────────────
let capturedProcessor: (() => Promise<any>) | null = null;
const mockQueue = { add: jest.fn(), close: jest.fn() };
const mockWorker = { on: jest.fn(), close: jest.fn() };

jest.mock('bullmq', () => ({
  Queue: jest.fn(() => mockQueue),
  Worker: jest.fn((_name: string, processor: () => Promise<any>) => {
    capturedProcessor = processor;
    return mockWorker;
  }),
}));

// ── mock runtime config ───────────────────────────────────────────────────────
const mockGetDataRetentionConfig = jest.fn();
jest.mock('../config/runtime', () => ({
  getRedisConnection: () => ({}),
  getDataRetentionConfig: mockGetDataRetentionConfig,
}));
jest.mock('../lib/logger', () => ({ createLogger: () => ({ info: jest.fn(), error: jest.fn() }) }));

import { startDataPruningJob } from '../jobs/dataPruningJob';

const baseConfig = {
  enabled: true,
  queueName: 'data-pruning',
  scheduleCron: '0 2 * * *',
  mode: 'delete' as const,
  dryRun: false,
  logsRetentionDays: 30,
  analyticsRetentionDays: 90,
  logsPaths: ['/logs'],
  analyticsPaths: ['/analytics'],
  archiveDirectory: '/archive',
  missingPathPolicy: 'warn' as const,
  missingPathAlertThreshold: 2,
};

// Start the job once to capture the processor; all processor-level tests share it.
beforeAll(async () => {
  mockGetDataRetentionConfig.mockReturnValue(baseConfig);
  await startDataPruningJob();
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ── pruning decision logic ────────────────────────────────────────────────────
describe('dataPruningJob — pruning decision logic', () => {
  it('does not call queue.add when config.enabled is false', async () => {
    mockGetDataRetentionConfig.mockReturnValue({ ...baseConfig, enabled: false });
    mockQueue.add.mockClear();

    await startDataPruningJob();

    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('schedules the job with the configured cron pattern', () => {
    // Verified against the single queue.add call made in beforeAll
    expect(mockQueue.add).toHaveBeenCalledWith(
      'data-pruning-execution',
      {},
      expect.objectContaining({
        repeat: expect.objectContaining({ pattern: baseConfig.scheduleCron }),
        removeOnComplete: 50,
        removeOnFail: 100,
      }),
    );
  });

  it('calls runDataPruning inside the worker processor', async () => {
    mockRunDataPruning.mockResolvedValue({
      deletedFiles: 3,
      archivedFiles: 0,
      scannedFiles: 10,
      errors: [],
    });

    await capturedProcessor!();

    expect(mockRunDataPruning).toHaveBeenCalledTimes(1);
  });

  it('registers completed and failed event listeners on the worker', () => {
    expect(mockWorker.on).toHaveBeenCalledWith('completed', expect.any(Function));
    expect(mockWorker.on).toHaveBeenCalledWith('failed', expect.any(Function));
  });
});

// ── Prometheus metrics emission ───────────────────────────────────────────────
describe('dataPruningJob — Prometheus metrics emission', () => {
  it('increments filesPrunedTotal by the number of deleted files', async () => {
    mockRunDataPruning.mockResolvedValue({
      deletedFiles: 7,
      archivedFiles: 0,
      scannedFiles: 20,
      errors: [],
    });

    await capturedProcessor!();

    expect(mockFilesPrunedInc).toHaveBeenCalledWith(7);
  });

  it('increments filesArchivedTotal by the number of archived files', async () => {
    mockRunDataPruning.mockResolvedValue({
      deletedFiles: 0,
      archivedFiles: 4,
      scannedFiles: 15,
      errors: [],
    });

    await capturedProcessor!();

    expect(mockFilesArchivedInc).toHaveBeenCalledWith(4);
  });

  it('increments both counters independently when both actions occur', async () => {
    mockRunDataPruning.mockResolvedValue({
      deletedFiles: 2,
      archivedFiles: 5,
      scannedFiles: 10,
      errors: [],
    });

    await capturedProcessor!();

    expect(mockFilesPrunedInc).toHaveBeenCalledWith(2);
    expect(mockFilesArchivedInc).toHaveBeenCalledWith(5);
  });

  it('increments counters with zero when no files were processed', async () => {
    mockRunDataPruning.mockResolvedValue({
      deletedFiles: 0,
      archivedFiles: 0,
      scannedFiles: 5,
      errors: [],
    });

    await capturedProcessor!();

    expect(mockFilesPrunedInc).toHaveBeenCalledWith(0);
    expect(mockFilesArchivedInc).toHaveBeenCalledWith(0);
  });
});

// ── OpenTelemetry span lifecycle ──────────────────────────────────────────────
describe('dataPruningJob — OpenTelemetry span lifecycle', () => {
  it('sets span status to OK after a successful pruning run', async () => {
    mockRunDataPruning.mockResolvedValue({
      deletedFiles: 1,
      archivedFiles: 0,
      scannedFiles: 3,
      errors: [],
    });

    await capturedProcessor!();

    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // SpanStatusCode.OK
  });

  it('sets span attributes with file counts and error count', async () => {
    mockRunDataPruning.mockResolvedValue({
      deletedFiles: 3,
      archivedFiles: 2,
      scannedFiles: 8,
      errors: [{ filePath: '/logs/old.log', reason: 'permission denied' }],
    });

    await capturedProcessor!();

    expect(mockSpan.setAttributes).toHaveBeenCalledWith({
      'pruning.deleted_files': 3,
      'pruning.archived_files': 2,
      'pruning.scanned_files': 8,
      'pruning.error_count': 1,
    });
  });

  it('always ends the span after a successful run (finally block)', async () => {
    mockRunDataPruning.mockResolvedValue({
      deletedFiles: 0,
      archivedFiles: 0,
      scannedFiles: 0,
      errors: [],
    });

    await capturedProcessor!();

    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });

  it('records exception on span and re-throws when runDataPruning throws', async () => {
    const boom = new Error('disk full');
    mockRunDataPruning.mockRejectedValue(boom);

    await expect(capturedProcessor!()).rejects.toThrow('disk full');

    expect(mockSpan.recordException).toHaveBeenCalledWith(boom);
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 2, message: 'disk full' }); // ERROR
  });

  it('always ends the span even when runDataPruning throws (finally block)', async () => {
    mockRunDataPruning.mockRejectedValue(new Error('io error'));

    await expect(capturedProcessor!()).rejects.toThrow();

    expect(mockSpan.end).toHaveBeenCalledTimes(1);
  });
});
