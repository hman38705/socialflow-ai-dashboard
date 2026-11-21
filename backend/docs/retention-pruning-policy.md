# Data Retention and Pruning Policy

This document is the source of truth for retention behavior in the backend.

## Scope and ownership

- Runtime config source: `backend/src/config/config.ts`
- Retention config assembly: `backend/src/config/runtime.ts`
- Pruning engine: `backend/src/retention/dataPruningService.ts`
- Scheduler job: `backend/src/jobs/dataPruningJob.ts`
- Manual runner entrypoint: `backend/src/scripts/data-pruning.ts`

## Retention targets and default windows

The pruning engine handles two categories.

| Category        | Default path targets | Default retention window | Config keys                                                       |
| --------------- | -------------------- | ------------------------ | ----------------------------------------------------------------- |
| Logs            | `logs`               | `30` days                | `DATA_RETENTION_LOG_DAYS`, `DATA_RETENTION_LOG_PATHS`             |
| Analytics files | `data/analytics`     | `90` days                | `DATA_RETENTION_ANALYTICS_DAYS`, `DATA_RETENTION_ANALYTICS_PATHS` |

Notes:

- Paths are comma-separated lists; each path is resolved relative to backend process `cwd` when not absolute.
- Eligibility is based on file `mtime` (last modified time), not filename date or creation time.
- Missing target paths are handled according to `DATA_RETENTION_MISSING_PATH_POLICY` (see [Missing path policy](#missing-path-policy) below).

## Missing path policy

When a configured retention path does not exist, the pruning run consults `DATA_RETENTION_MISSING_PATH_POLICY`. The variable names and defaults below match the optional-variables table in the repository `README.md`; keep the two in sync when changing either.

| Variable                                      | Default | Allowed values          |
| --------------------------------------------- | ------- | ----------------------- |
| `DATA_RETENTION_MISSING_PATH_POLICY`          | `warn`  | `warn`, `fail`, `ignore` |
| `DATA_RETENTION_MISSING_PATH_ALERT_THRESHOLD` | `3`     | positive integer        |

The modes documented here (`warn`, `fail`, `ignore`) are the source of truth for runtime behavior. The Kubernetes CronJob manifest at [`k8s/base/data-pruning-cronjob.yaml`](../../k8s/base/data-pruning-cronjob.yaml) is the deployment reference for the scheduled job; note that it currently lists `skip`/`prune` values that differ from the documented modes. Treat this document and the `README.md` defaults as authoritative, and do not infer behavior from the manifest's values.

### Mode semantics

`DATA_RETENTION_MISSING_PATH_POLICY` supports `warn`, `fail`, and `ignore`.

#### `warn` mode (default)

- Each missing path is logged as a warning and counted toward the run's missing-path total.
- Pruning continues for all remaining paths.
- If the missing-path count reaches `DATA_RETENTION_MISSING_PATH_ALERT_THRESHOLD`, an alert is emitted for the run.
- When to use: the recommended default for most deployments. It keeps pruning running while surfacing missing paths so operators can investigate before data loss is masked.

#### `fail` mode

- The first missing path aborts the pruning run with an error.
- No further paths are processed after the failure.
- When to use: environments where a missing path indicates a serious misconfiguration (for example, an unmounted volume) and pruning must not proceed silently. Use with care in production: a path that is temporarily absent will stop pruning entirely.

#### `ignore` mode

- Missing paths are silently skipped; no warning is logged and they are not counted toward the alert threshold.
- Pruning continues for all remaining paths.
- When to use: only when missing paths are expected and benign (for example, optional category directories that are intentionally absent). Avoid in production, as it can mask data loss.

### Alert threshold

`DATA_RETENTION_MISSING_PATH_ALERT_THRESHOLD` (default `3`) controls when a `warn`-mode run raises an alert.

- Counting is per run: the missing-path total is reset at the start of each pruning run and is not carried across runs.
- The alert fires when the number of missing paths encountered during the run is greater than or equal to the threshold (default: 3 or more missing paths in a single run).
- The threshold has no effect in `fail` mode (the run aborts on the first missing path) or `ignore` mode (missing paths are not counted).
=======

## Operational behavior

- Scheduler start: automatic when backend boots (`startDataPruningJob()` in server bootstrap).
- Scheduler gating: if `DATA_PRUNING_ENABLED=false`, scheduler is not started.
- Default cron: `DATA_PRUNING_CRON=0 2 * * *` (daily at 02:00 in server local timezone).
- Queue: BullMQ queue name defaults to `data-pruning` (`DATA_PRUNING_QUEUE`).

## Mode semantics

`DATA_RETENTION_MODE` supports `archive` and `delete`.

### `archive` mode (default)

- Eligible files are moved (`fs.rename`) from target paths to `DATA_RETENTION_ARCHIVE_DIR`.
- Category subfolders are added under archive root:
  - `<archive-dir>/logs/...`
  - `<archive-dir>/analytics/...`
- Relative path from the original target root is preserved.

Example:

- Source: `logs/api/2026-01-01.log`
- Archive root: `cold-storage`
- Archived location: `cold-storage/logs/api/2026-01-01.log`

### `delete` mode

- Eligible files are permanently removed (`fs.unlink`).
- No in-app recovery path exists after successful deletion.

## Safe dry-run workflow

There is currently no built-in `--dry-run` flag. Use the following safe simulation sequence.

### 1) Disable scheduler for testing window

Set:

```bash
DATA_PRUNING_ENABLED=false
```

This prevents automatic cron execution while you validate settings.

### 2) Test with `archive` mode and isolated paths

Use a non-production sandbox copy of your data and a temporary archive directory:

```bash
DATA_RETENTION_MODE=archive
DATA_RETENTION_ARCHIVE_DIR=tmp/pruning-dryrun-archive
DATA_RETENTION_LOG_PATHS=tmp/pruning-dryrun/logs
DATA_RETENTION_ANALYTICS_PATHS=tmp/pruning-dryrun/analytics
```

### 3) Run pruning manually

From repo root:

```bash
npm run data-pruning
```

Or from `backend/` directly:

```bash
npm run build
npm run data-pruning:run
```

### 4) Validate result summary and moved files

Expect logs containing summary fields:

- `scannedFiles`
- `eligibleFiles`
- `archivedFiles`
- `deletedFiles`
- `skippedFiles`
- `errors`

Confirm moved files are only under your temporary archive root before enabling scheduled pruning.

## Rollback and recovery guidance

### If mode is `archive`

Rollback is file restore from archive location back to source root.

Recommended steps:

1. Keep scheduler disabled (`DATA_PRUNING_ENABLED=false`).
2. Restore archived files from `<archive-dir>/logs` and `<archive-dir>/analytics` to their original target roots.
3. Spot-check restored paths and counts.
4. Re-enable scheduler after verification.

### If mode is `delete`

Recovery depends on external backups only.

Recommended steps:

1. Immediately disable scheduler (`DATA_PRUNING_ENABLED=false`).
2. Restore deleted files from snapshots/backups.
3. Switch to `archive` mode for subsequent validation runs.
4. Re-enable schedule only after restore validation is complete.

## Production rollout checklist

1. Verify explicit path lists (`DATA_RETENTION_LOG_PATHS`, `DATA_RETENTION_ANALYTICS_PATHS`).
2. Verify windows (`DATA_RETENTION_LOG_DAYS`, `DATA_RETENTION_ANALYTICS_DAYS`).
3. Start in `archive` mode.
4. Run one manual pruning cycle and inspect summary.
5. Confirm archive storage capacity and lifecycle policy.
6. Enable scheduler and monitor first scheduled execution logs.
