import fs from 'fs/promises';
import path from 'path';
import { DataRetentionConfig, getDataRetentionConfig } from '../config/runtime';
import { createLogger } from '../lib/logger';
import { AlertPayload, NotificationManager } from '../services/notificationProvider';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CategoryMetrics {
  scannedFiles: number;
  eligibleFiles: number;
  archivedFiles: number;
  deletedFiles: number;
  skippedFiles: number;
  missingPaths: string[];
  errors: Array<{ filePath: string; reason: string }>;
}

export interface DataPruningSummary {
  /** Aggregate totals across all categories */
  scannedFiles: number;
  eligibleFiles: number;
  archivedFiles: number;
  deletedFiles: number;
  skippedFiles: number;
  errors: Array<{ filePath: string; reason: string }>;
  /** Per-category breakdown */
  byCategory: Record<'logs' | 'analytics', CategoryMetrics>;
}

interface PruningTarget {
  category: 'logs' | 'analytics';
  basePath: string;
  retentionDays: number;
}

const logger = createLogger('data-pruning');

const toAbsolutePath = (value: string): string =>
  path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);

const exists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const getAllFiles = async (directoryPath: string): Promise<string[]> => {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);
      return entry.isDirectory() ? getAllFiles(entryPath) : [entryPath];
    }),
  );
  return nested.flat();
};

const ensureDirectory = async (directoryPath: string): Promise<void> => {
  await fs.mkdir(directoryPath, { recursive: true });
};

const archiveFile = async (
  sourceFilePath: string,
  destinationRoot: string,
  relativePath: string,
): Promise<void> => {
  const destinationPath = path.join(destinationRoot, relativePath);
  await ensureDirectory(path.dirname(destinationPath));
  await fs.rename(sourceFilePath, destinationPath);
};

const emptyMetrics = (): CategoryMetrics => ({
  scannedFiles: 0,
  eligibleFiles: 0,
  archivedFiles: 0,
  deletedFiles: 0,
  skippedFiles: 0,
  missingPaths: [],
  errors: [],
});

const pruneTarget = async (
  target: PruningTarget,
  config: DataRetentionConfig,
  metrics: CategoryMetrics,
  dryRun: boolean = false,
): Promise<void> => {
  const absoluteBasePath = toAbsolutePath(target.basePath);

  if (!(await exists(absoluteBasePath))) {
    metrics.missingPaths.push(absoluteBasePath);

    if (config.missingPathPolicy === 'ignore') return;

    const logMeta = { category: target.category, path: absoluteBasePath };

    if (config.missingPathPolicy === 'fail') {
      const err = new Error(`Retention path does not exist: ${absoluteBasePath}`);
      logger.error(err.message, logMeta);
      throw err;
    }

    // 'warn' (default)
    logger.warn('Retention path does not exist, skipping target', logMeta);
    return;
  }

  const files = await getAllFiles(absoluteBasePath);
  const threshold = Date.now() - target.retentionDays * DAY_MS;

  for (const filePath of files) {
    metrics.scannedFiles += 1;

    try {
      const stats = await fs.stat(filePath);

      if (stats.mtimeMs > threshold) {
        metrics.skippedFiles += 1;
        continue;
      }

      metrics.eligibleFiles += 1;

      if (dryRun) {
        logger.info(`[DRY-RUN] Would ${config.mode === 'archive' ? 'archive' : 'delete'}: ${filePath}`);
        if (config.mode === 'archive') {
          metrics.archivedFiles += 1;
        } else {
          metrics.deletedFiles += 1;
        }
      } else if (config.mode === 'archive') {
        const archiveRoot = path.join(toAbsolutePath(config.archiveDirectory), target.category);
        await archiveFile(filePath, archiveRoot, path.relative(absoluteBasePath, filePath));
        metrics.archivedFiles += 1;
      } else if (config.dryRun) {
        // Dry-run mode: log what would be deleted without actually deleting
        logger.info(`[DRY-RUN] Would delete file`, { filePath, category: target.category });
        metrics.deletedFiles += 1;
      } else {
        await fs.unlink(filePath);
        metrics.deletedFiles += 1;
      }
    } catch (error) {
      metrics.errors.push({
        filePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
};

const buildSummary = (byCategory: Record<'logs' | 'analytics', CategoryMetrics>): DataPruningSummary => {
  const categories = Object.values(byCategory);
  return {
    scannedFiles: categories.reduce((s, c) => s + c.scannedFiles, 0),
    eligibleFiles: categories.reduce((s, c) => s + c.eligibleFiles, 0),
    archivedFiles: categories.reduce((s, c) => s + c.archivedFiles, 0),
    deletedFiles: categories.reduce((s, c) => s + c.deletedFiles, 0),
    skippedFiles: categories.reduce((s, c) => s + c.skippedFiles, 0),
    errors: categories.flatMap((c) => c.errors),
    byCategory,
  };
};

const maybeSendMissingPathAlert = async (
  summary: DataPruningSummary,
  config: DataRetentionConfig,
  notificationManager?: NotificationManager,
): Promise<void> => {
  if (!notificationManager) return;

  const allMissing = [
    ...summary.byCategory.logs.missingPaths,
    ...summary.byCategory.analytics.missingPaths,
  ];

  if (allMissing.length < config.missingPathAlertThreshold) return;

  const alert: AlertPayload = {
    severity: 'warning',
    service: 'data-pruning',
    message: `${allMissing.length} retention path(s) were missing during pruning run`,
    details: {
      missingPaths: allMissing.join(', '),
      policy: config.missingPathPolicy,
      threshold: config.missingPathAlertThreshold,
    },
    timestamp: new Date().toISOString(),
  };

  await notificationManager.sendAlert(alert);
};

export const runDataPruning = async (
  overrideConfig?: Partial<DataRetentionConfig>,
  notificationManager?: NotificationManager,
  dryRun: boolean = false,
): Promise<DataPruningSummary> => {
  const config: DataRetentionConfig = {
    ...getDataRetentionConfig(),
    ...overrideConfig,
  };

  // Safeguard: require explicit opt-in for delete mode
  if (config.mode === 'delete' && !config.enabled) {
    logger.warn('Data pruning is disabled (DATA_PRUNING_ENABLED=false). Skipping pruning run.');
    return {
      scannedFiles: 0,
      eligibleFiles: 0,
      archivedFiles: 0,
      deletedFiles: 0,
      skippedFiles: 0,
      errors: [],
      byCategory: {
        logs: emptyMetrics(),
        analytics: emptyMetrics(),
      },
    };
  }

  const byCategory: Record<'logs' | 'analytics', CategoryMetrics> = {
    logs: emptyMetrics(),
    analytics: emptyMetrics(),
  };

  const mode = dryRun ? 'DRY-RUN' : 'LIVE';
  logger.info(`Starting data retention pruning run [${mode}]`, {
    mode: config.mode,
    dryRun: config.dryRun,
    enabled: config.enabled,
    missingPathPolicy: config.missingPathPolicy,
    logsRetentionDays: config.logsRetentionDays,
    analyticsRetentionDays: config.analyticsRetentionDays,
    logsPaths: config.logsPaths,
    analyticsPaths: config.analyticsPaths,
  });

  const targets: PruningTarget[] = [
    ...config.logsPaths.map((basePath) => ({
      category: 'logs' as const,
      basePath,
      retentionDays: config.logsRetentionDays,
    })),
    ...config.analyticsPaths.map((basePath) => ({
      category: 'analytics' as const,
      basePath,
      retentionDays: config.analyticsRetentionDays,
    })),
  ];

  for (const target of targets) {
    await pruneTarget(target, config, byCategory[target.category], dryRun);
  }

  const summary = buildSummary(byCategory);

  logger.info(`Data retention pruning completed [${mode}]`, {
    scannedFiles: summary.scannedFiles,
    eligibleFiles: summary.eligibleFiles,
    archivedFiles: summary.archivedFiles,
    deletedFiles: summary.deletedFiles,
    skippedFiles: summary.skippedFiles,
    errorCount: summary.errors.length,
    dryRun: config.dryRun,
    byCategory: {
      logs: {
        ...summary.byCategory.logs,
        missingPathCount: summary.byCategory.logs.missingPaths.length,
        errorCount: summary.byCategory.logs.errors.length,
      },
      analytics: {
        ...summary.byCategory.analytics,
        missingPathCount: summary.byCategory.analytics.missingPaths.length,
        errorCount: summary.byCategory.analytics.errors.length,
      },
    },
  });

  await maybeSendMissingPathAlert(summary, config, notificationManager);

  return summary;
};
