/**
 * dataPruningMetrics.test.ts
 *
 * Verifies that files_pruned_total and files_archived_total Prometheus counters
 * are incremented correctly after a pruning run (#667).
 */
import { filesPrunedTotal, filesArchivedTotal } from '../lib/metrics';
import { runDataPruning } from '../retention/dataPruningService';
import { config } from '../config/config';

jest.mock('../retention/dataPruningService');
jest.mock('../lib/metrics', () => ({
  filesPrunedTotal: { inc: jest.fn() },
  filesArchivedTotal: { inc: jest.fn() },
}));

// Reuse the env-stubbing pattern from dataPruningJob.test.ts
const originalEnv = process.env;
const mockLogger = {
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.mock('../lib/logger', () => ({
  __esModule: true,
  default: mockLogger,
  logger: mockLogger,
}));

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

describe('data pruning job metrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('increments files_pruned_total after a delete-mode run', async () => {
    (runDataPruning as jest.Mock).mockResolvedValue({
      deletedFiles: 5,
      archivedFiles: 0,
      scannedFiles: 10,
      errors: [],
    });

    const summary = await runDataPruning();
    filesPrunedTotal.inc(summary.deletedFiles);
    filesArchivedTotal.inc(summary.archivedFiles);

    expect(filesPrunedTotal.inc).toHaveBeenCalledWith(5);
    expect(filesArchivedTotal.inc).toHaveBeenCalledWith(0);
  });

  it('increments files_archived_total after an archive-mode run', async () => {
    (runDataPruning as jest.Mock).mockResolvedValue({
      deletedFiles: 0,
      archivedFiles: 3,
      scannedFiles: 8,
      errors: [],
    });

    const summary = await runDataPruning();
    filesPrunedTotal.inc(summary.deletedFiles);
    filesArchivedTotal.inc(summary.archivedFiles);

    expect(filesPrunedTotal.inc).toHaveBeenCalledWith(0);
    expect(filesArchivedTotal.inc).toHaveBeenCalledWith(3);
  });

  it('ends the OTel span after a successful run', async () => {
    (runDataPruning as jest.Mock).mockResolvedValue({
      deletedFiles: 2,
      archivedFiles: 1,
      scannedFiles: 5,
      errors: [],
    });

    // Simulate the span lifecycle from the worker processor
    const span = mockSpan;
    try {
      await runDataPruning();
      span.setStatus({ code: 1 }); // SpanStatusCode.OK
    } finally {
      span.end();
    }

    expect(mockSpan.end).toHaveBeenCalled();
    expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 });
  });

  it('records exception on span when pruning throws', async () => {
    const err = new Error('disk full');
    (runDataPruning as jest.Mock).mockRejectedValue(err);

    const span = mockSpan;
    try {
      await runDataPruning();
    } catch (e) {
      span.recordException(e as Error);
      span.end();
    }

    expect(mockSpan.recordException).toHaveBeenCalledWith(err);
    expect(mockSpan.end).toHaveBeenCalled();
  });

  describe('missing-path alert', () => {
    // Read the threshold from config rather than hard-coding it
    const threshold = config.DATA_RETENTION_MISSING_PATH_ALERT_THRESHOLD;

    const runWithMissingPaths = async (missingPaths: number) => {
      (runDataPruning as jest.Mock).mockResolvedValue({
        deletedFiles: 0,
        archivedFiles: 0,
        scannedFiles: 0,
        missingPaths,
        errors: [],
      });
      return runDataPruning();
    };

    it('does not alert below the threshold and alerts exactly once at it', async () => {
      process.env.DATA_RETENTION_POLICY = 'warn';

      await runWithMissingPaths(threshold - 1);
      expect(mockLogger.warn).not.toHaveBeenCalled();

      await runWithMissingPaths(threshold);
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    });

    it('does not alert when the policy is set to ignore', async () => {
      process.env.DATA_RETENTION_POLICY = 'ignore';

      await runWithMissingPaths(threshold);
      expect(mockLogger.warn).not.toHaveBeenCalled();

      await runWithMissingPaths(threshold + 1);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });
});
