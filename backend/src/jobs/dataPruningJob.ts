import { Queue, Worker } from 'bullmq';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import { getDataRetentionConfig, getRedisConnection } from '../config/runtime';
import { createLogger } from '../lib/logger';
import { filesPrunedTotal, filesArchivedTotal, dataPruningErrorsTotal } from '../lib/metrics';
import { runDataPruning } from '../retention/dataPruningService';

const logger = createLogger('data-pruning-job');
const tracer = trace.getTracer('socialflow-jobs');

const DATA_PRUNING_JOB_NAME = 'data-pruning-execution';
const DATA_PRUNING_REPEAT_JOB_ID = 'data-pruning-repeat-scheduler';

let queue: Queue | null = null;
let worker: Worker | null = null;

export const startDataPruningJob = async (): Promise<void> => {
  const config = getDataRetentionConfig();

  if (!config.enabled) {
    logger.info('Data pruning scheduler is disabled by configuration');
    return;
  }

  if (!queue) {
    queue = new Queue(config.queueName, { connection: getRedisConnection() });
  }

  if (!worker) {
    worker = new Worker(
      config.queueName,
      async () => {
        const span = tracer.startSpan('data-pruning.run');
        try {
          const summary = await runDataPruning();
          filesPrunedTotal.inc(summary.deletedFiles);
          filesArchivedTotal.inc(summary.archivedFiles);
          span.setAttributes({
            'pruning.deleted_files': summary.deletedFiles,
            'pruning.archived_files': summary.archivedFiles,
            'pruning.scanned_files': summary.scannedFiles,
            'pruning.error_count': summary.errors.length,
          });
          span.setStatus({ code: SpanStatusCode.OK });
          return summary;
        } catch (err) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
          span.recordException(err as Error);
          throw err;
        } finally {
          span.end();
        }
      },
      {
        connection: getRedisConnection(),
      },
    );

    worker.on('completed', (job) => {
      logger.info('Data pruning job completed', {
        jobId: job.id,
      });
    });

    worker.on('failed', (job, error) => {
      dataPruningErrorsTotal.inc();
      logger.error('Data pruning job failed', {
        jobId: job?.id,
        error: error.message,
      });
    });
  }

  await queue.add(
    DATA_PRUNING_JOB_NAME,
    {},
    {
      repeat: {
        pattern: config.scheduleCron,
      },
      jobId: DATA_PRUNING_REPEAT_JOB_ID,
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  );

  logger.info('Data pruning scheduler started', {
    queueName: config.queueName,
    scheduleCron: config.scheduleCron,
    mode: config.mode,
  });
};

export const stopDataPruningJob = async (): Promise<void> => {
  if (worker) {
    await worker.close();
    worker = null;
  }

  if (queue) {
    await queue.close();
    queue = null;
  }

  logger.info('Data pruning scheduler stopped');
};
