# SocialFlow AI Dashboard — Backend

## Environment Variable Setup

All configuration is validated at startup via **Zod** in `src/config/config.ts`.  
If any required variable is missing or has the wrong type the process exits immediately with a clear error listing every failing field.

### Quick start

```bash
cp .env.example .env
# Fill in the required values (see table below), then:
npm run dev
```

### Required variables

| Variable             | Description                                                          |
| -------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string — `postgresql://USER:PASS@HOST:PORT/DB` |
| `JWT_SECRET`         | Secret used to sign access tokens (min 32 chars recommended)         |
| `JWT_REFRESH_SECRET` | Secret used to sign refresh tokens (min 32 chars recommended)        |
| `TWITTER_API_KEY`    | Twitter / X API key                                                  |
| `TWITTER_API_SECRET` | Twitter / X API secret                                               |

JWT secret rotation steps are documented in `backend/docs/jwt-secret-rotation.md`.

### Connection pool

Pool parameters are injected automatically into `DATABASE_URL` at startup based on `NODE_ENV`. Override with env vars if needed.

| `NODE_ENV`    | `connection_limit` | `pool_timeout` |
| ------------- | ------------------ | -------------- |
| `development` | 5                  | 10s            |
| `test`        | 2                  | 10s            |
| `production`  | 10                 | 20s            |

Override defaults:

```bash
DB_CONNECTION_LIMIT=20   # max open connections per Prisma process
DB_POOL_TIMEOUT=30       # seconds to wait for a free connection before erroring
```

**Sizing guidance:** `connection_limit` should be `(2 × CPU cores) + 1` per app instance, and must not exceed your Postgres `max_connections` divided by the number of running instances. For PgBouncer in transaction mode, keep it at `1`.

### Optional variables with defaults

| Variable                        | Default                             | Description                                                              |
| ------------------------------- | ----------------------------------- | ------------------------------------------------------------------------ |
| `NODE_ENV`                      | `development`                       | `development` \| `production` \| `test`                                  |
| `BACKEND_PORT`                  | `3001`                              | HTTP server port                                                         |
| `DB_CONNECTION_LIMIT`           | see pool table                      | Max open connections per Prisma process                                  |
| `DB_POOL_TIMEOUT`               | see pool table                      | Seconds to wait for a free connection                                    |
| `JWT_EXPIRES_IN`                | `15m`                               | Access token TTL                                                         |
| `JWT_REFRESH_EXPIRES_IN`        | `7d`                                | Refresh token TTL                                                        |
| `REDIS_HOST`                    | `127.0.0.1`                         | Redis host                                                               |
| `REDIS_PORT`                    | `6379`                              | Redis port                                                               |
| `REDIS_DB`                      | `0`                                 | Redis database index                                                     |
| `REDIS_PASSWORD`                | —                                   | Redis password (optional)                                                |
| `LOG_LEVEL`                     | `info`                              | `error` \| `warn` \| `info` \| `http` \| `verbose` \| `debug` \| `silly` |
| `OTEL_SERVICE_NAME`             | `socialflow-backend`                | OpenTelemetry service name                                               |
| `OTEL_EXPORTER`                 | `jaeger`                            | `jaeger` \| `honeycomb` \| `otlp`                                        |
| `JAEGER_ENDPOINT`               | `http://localhost:14268/api/traces` | Jaeger collector URL                                                     |
| `OTEL_EXPORTER_OTLP_ENDPOINT`   | `http://localhost:4318/v1/traces`   | OTLP endpoint                                                            |
| `OTEL_DEBUG`                    | `false`                             | Enable verbose OTel diagnostics                                          |
| `DATA_RETENTION_MODE`           | `archive`                           | `archive` \| `delete`                                                    |
| `DATA_PRUNING_CRON`             | `0 2 * * *`                         | Cron schedule for data pruning                                           |
| `DATA_RETENTION_LOG_DAYS`       | `30`                                | Log retention in days                                                    |
| `DATA_RETENTION_ANALYTICS_DAYS` | `90`                                | Analytics retention in days                                              |
| `DATA_RETENTION_MISSING_PATH_POLICY` | `warn`                         | What to do when a retention path is missing: `warn` \| `fail` \| `ignore` |
| `DATA_RETENTION_MISSING_PATH_ALERT_THRESHOLD` | `3`               | Fire an alert when missing-path count reaches this value in a single run |

### Social / third-party integrations (all optional)

| Variable                                      | Description                             |
| --------------------------------------------- | --------------------------------------- |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`     | Facebook Graph API credentials          |
| `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` | Google OAuth credentials for YouTube    |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`  | TikTok API credentials                  |
| `DEEPL_API_KEY`                               | DeepL translation API key               |
| `GOOGLE_TRANSLATE_API_KEY`                    | Google Translate API key                |
| `ELEVENLABS_API_KEY`                          | ElevenLabs TTS API key                  |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe billing credentials              |
| `SLACK_WEBHOOK_URL`                           | Slack webhook for health alerts         |
| `ELASTICSEARCH_URL`                           | Elasticsearch endpoint for log shipping |

### Validation error example

Starting the server with a missing `JWT_SECRET` produces:

```
Environment validation failed:
  • JWT_SECRET: Invalid input: expected string, received undefined
```

## Distributed Tracing (OpenTelemetry)

Tracing is initialised in `src/tracing.ts` (frontend/shared) and `backend/src/tracing.ts` (backend server). Both files **must be imported before any other module** so auto-instrumentation patches are applied at load time.

### Exporters

Select the exporter with `OTEL_EXPORTER`:

| Value              | Destination                                         | Required extra vars                      |
| ------------------ | --------------------------------------------------- | ---------------------------------------- |
| `jaeger` (default) | Jaeger HTTP collector                               | `JAEGER_ENDPOINT`                        |
| `honeycomb`        | Honeycomb OTLP endpoint                             | `HONEYCOMB_API_KEY`, `HONEYCOMB_DATASET` |
| `otlp`             | Any OTLP/HTTP backend (Grafana Tempo, Lightstep, …) | `OTEL_EXPORTER_OTLP_ENDPOINT`            |

### Span processor

The backend selects the processor based on `OTEL_DEBUG`:

| `OTEL_DEBUG`      | Processor             | Behaviour                                                                                           |
| ----------------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| `false` (default) | `BatchSpanProcessor`  | Buffers spans; exports every 5 s or when the queue (512) is full. Low overhead — use in production. |
| `true`            | `SimpleSpanProcessor` | Exports each span synchronously as it ends. High overhead — use only for local debugging.           |

The frontend/shared `src/tracing.ts` always uses `BatchSpanProcessor`.

### Debug flag

```bash
OTEL_DEBUG=true   # enables DiagConsoleLogger at DEBUG level + SimpleSpanProcessor (backend)
```

With `OTEL_DEBUG=true` every span export attempt, SDK lifecycle event, and internal OTel error is printed to stdout. Disable in production — it is verbose and adds per-span I/O latency.

### Recommended production defaults

```bash
OTEL_EXPORTER=otlp                              # or honeycomb
OTEL_EXPORTER_OTLP_ENDPOINT=http://<collector>:4318/v1/traces
OTEL_SERVICE_NAME=socialflow-backend
OTEL_DEBUG=false
NODE_ENV=production
```

### Shutdown lifecycle

On `SIGTERM` or `SIGINT` the server runs a **graceful shutdown sequence** (30 s hard timeout):

1. HTTP server stops accepting new connections.
2. BullMQ workers, webhook workers, scheduled jobs, and the queue manager are closed.
3. Prisma disconnects from the database.
4. The OTel SDK calls `sdk.shutdown()`, which flushes all buffered spans to the exporter before the process exits.

If `sdk.shutdown()` is skipped (e.g. `process.exit()` called directly) any spans still in the `BatchSpanProcessor` queue are lost. Always let the signal handlers complete.

The backend's `SIGTERM` handler in `tracing.ts` is intentionally separate from the main shutdown sequence so the OTel flush happens even if the application-level shutdown throws.

### Troubleshooting missing traces

- **No spans in Jaeger / collector** — confirm the collector is reachable: `curl -v $JAEGER_ENDPOINT`. Check for `ECONNREFUSED` in logs.
- **Spans appear after a delay** — expected with `BatchSpanProcessor` (up to 5 s). Set `OTEL_DEBUG=true` temporarily to see spans immediately.
- **`HONEYCOMB_API_KEY is not set` warning** — set the key or switch `OTEL_EXPORTER` to `jaeger`/`otlp`.
- **Spans missing on crash / `kill -9`** — `SIGKILL` bypasses signal handlers; buffered spans are dropped. Use `SIGTERM` for container stops (`terminationGracePeriodSeconds` in Kubernetes).
- **Auto-instrumentation not capturing a library** — ensure `import './tracing'` is the very first line of the entry point, before any other imports.
- **`OTEL_DEBUG=true` but no output** — the logger is set on the global `diag` singleton; verify no other module calls `diag.setLogger` after tracing initialises.

---

## Database Backup Runbook

The backup script is at `scripts/db-backup.ts`. It dumps the database with `pg_dump`, uploads the file to S3, then prunes objects older than 30 days.

### Prerequisites

**Tooling** — `pg_dump` must be on `PATH` and match the server's major Postgres version:

```bash
pg_dump --version   # e.g. pg_dump (PostgreSQL) 16.x
```

**Environment variables:**

| Variable           | Required | Default     | Description                       |
| ------------------ | -------- | ----------- | --------------------------------- |
| `DATABASE_URL`     | yes      | —           | PostgreSQL connection string      |
| `S3_BACKUP_BUCKET` | yes      | —           | S3 bucket name for backup storage |
| `AWS_REGION`       | no       | `us-east-1` | AWS region of the bucket          |

AWS credentials are resolved by the SDK in the standard order: env vars (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`), `~/.aws/credentials`, or an attached IAM role (recommended in production).

**IAM permissions** — the identity running the script needs:

```json
{
  "Effect": "Allow",
  "Action": ["s3:PutObject", "s3:ListBucket", "s3:DeleteObject"],
  "Resource": ["arn:aws:s3:::YOUR_BUCKET", "arn:aws:s3:::YOUR_BUCKET/backups/*"]
}
```

### Running a backup

```bash
DATABASE_URL="postgresql://user:pass@host:5432/db" \
S3_BACKUP_BUCKET="my-backups" \
npx ts-node scripts/db-backup.ts
```

Expected output:

```
Starting database backup...
Uploading to S3...
Backup uploaded: s3://my-backups/backups/db-backup-2026-03-28.sql
Backup complete
```

### Validation and integrity check

After the script exits, confirm the object exists and is non-zero:

```bash
aws s3 ls s3://$S3_BACKUP_BUCKET/backups/ --human-readable | sort | tail -5
```

Verify the dump is a valid PostgreSQL archive:

```bash
aws s3 cp s3://$S3_BACKUP_BUCKET/backups/db-backup-$(date +%F).sql /tmp/verify.sql
head -3 /tmp/verify.sql   # first line should start with "--"
pg_restore --list /tmp/verify.sql > /dev/null && echo "OK"
```

### Restore simulation procedure

Run this against a throwaway database — never against production:

```bash
# 1. Download the target backup
aws s3 cp s3://$S3_BACKUP_BUCKET/backups/db-backup-<DATE>.sql /tmp/restore.sql

# 2. Create an isolated restore target
createdb restore_test

# 3. Restore
psql restore_test < /tmp/restore.sql

# 4. Spot-check row counts against production
psql restore_test -c "\dt"
psql restore_test -c "SELECT COUNT(*) FROM users;"

# 5. Drop the test database when done
dropdb restore_test
```

A successful restore with matching row counts confirms the backup is usable.

---

## Analytics Integration Status

Current platform-by-capability implementation status for analytics integrations is tracked in:

- `backend/docs/analytics-integration-status.md`

**All logic for data retention is located in `backend/src/services/DataRetentionService.ts`.**

---

## Security

Please report any security vulnerabilities by following our [Security Policy](./SECURITY.md).

Use that matrix as the source of truth for whether each platform capability is **implemented**, **partial**, or **planned**, including owner paths and roadmap links.

---

## Data Retention and Pruning Policy

Retention is enforced by the backend data pruning service and scheduler.

- **Targets:** log files and analytics files.
- **Default windows:** logs = `30` days, analytics = `90` days.
- **Default paths:** `logs` and `data/analytics` (override via `DATA_RETENTION_LOG_PATHS`, `DATA_RETENTION_ANALYTICS_PATHS`).
- **Modes:**
  - `archive` (default): moves eligible files into `DATA_RETENTION_ARCHIVE_DIR` under category folders.
  - `delete`: permanently removes eligible files.

Safe validation should start with `DATA_RETENTION_MODE=archive` and `DATA_PRUNING_ENABLED=false`, then run a manual pruning cycle against sandbox path targets before enabling schedule-based runs.

Full end-to-end runbook (targets, defaults, operational expectations, dry-run workflow, rollback/recovery):

- `backend/docs/retention-pruning-policy.md`

---

## Running tests

```bash
# All tests
npm test

# Config service only (with coverage)
npx jest --testPathPatterns="config/__tests__/config.test.ts" --coverage --collectCoverageFrom="src/config/config.ts"
```

The config service maintains **100% statement, branch, function, and line coverage**.

---

## Optional dependency matrix

All packages listed below are installed in `node_modules`. Whether a feature is **active** at runtime depends entirely on the corresponding environment variable(s) being set. Missing variables cause the feature to be silently skipped or to throw on first use — not at startup — so the process will boot in a degraded state without any warning unless you verify explicitly (see [Startup verification](#startup-verification) below).

### Redis

Redis is used by four independent subsystems. Each connects via `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` / `REDIS_DB`.

| Subsystem | Degraded behaviour when Redis is unreachable | Production required? |
|-----------|----------------------------------------------|----------------------|
| BullMQ job queues (`bullmq`, `@socket.io/redis-adapter`) | Background jobs (video transcoding, data pruning, social sync) do not run. Queue admin endpoints return errors. | **Yes** |
| Distributed rate limiting (`rate-limit-redis`) | Falls back to in-process memory store. Limits are not shared across instances — effective rate limit multiplies by replica count. | **Yes** (multi-instance) |
| JWT blacklist / token revocation (`AuthBlacklistService`) | Revoked tokens remain valid until they expire naturally. Logout does not invalidate tokens server-side. | **Yes** |
| Response cache (`cache.ts`) | Cache misses on every request; upstream services hit on every call. | Recommended |

### Elasticsearch

| Package | Env var | Degraded behaviour | Production required? |
|---------|---------|-------------------|----------------------|
| `winston-elasticsearch` | `ELASTICSEARCH_URL` | Log transport is not registered. Logs go to console (and file in production) only — no Kibana/ECS indexing. | Recommended for observability |

Optional auth: set `ELASTICSEARCH_USERNAME` + `ELASTICSEARCH_PASSWORD`. TLS verification is on by default; set `ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED=false` only for self-signed certs in non-production environments.

### MeiliSearch

| Package | Env vars | Degraded behaviour | Production required? |
|---------|---------|-------------------|----------------------|
| `meilisearch` | `MEILISEARCH_HOST` (default `http://localhost:7700`), `MEILISEARCH_ADMIN_KEY`, `MEILISEARCH_SEARCH_KEY` | `SearchService` initialises but every search call fails at runtime with a connection error. Full-text search across posts is unavailable. | **Yes** (if search is used) |

### Stripe

| Package | Env vars | Degraded behaviour | Production required? |
|---------|---------|-------------------|----------------------|
| `stripe` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | `BillingService` throws `STRIPE_SECRET_KEY is not set` on first billing call. Webhook signature verification throws on receipt of any Stripe event. All `/billing` routes are broken. | **Yes** (if billing is enabled) |

### Translation

Both providers are optional. If neither key is set, `TranslationService` throws `No translation provider available` on every translation request.

| Provider | Env var | Notes |
|----------|---------|-------|
| DeepL | `DEEPL_API_KEY` | Preferred provider when set |
| Google Translate | `GOOGLE_TRANSLATE_API_KEY` | Fallback when DeepL key is absent |

### Text-to-speech (TTS)

Both providers are optional. If neither key is set, `TTSService` throws `No TTS provider configured` on every TTS request.

| Provider | Env var | Notes |
|----------|---------|-------|
| ElevenLabs | `ELEVENLABS_API_KEY` | Preferred provider when set |
| Google TTS | `GOOGLE_TTS_API_KEY` | Fallback when ElevenLabs key is absent |

### FFmpeg (video processing)

| Binary | Used by | Degraded behaviour | Production required? |
|--------|---------|-------------------|----------------------|
| `ffmpeg` (system binary, wrapped by `fluent-ffmpeg`) | `VideoService`, `AudioMerger` | Video transcoding jobs fail at the FFmpeg spawn step. Upload endpoints still accept files but processing never completes. | **Yes** (if video features are used) |

`ffmpeg` must be on `PATH`. The Node package `fluent-ffmpeg` is a wrapper only — it does not bundle the binary.

### Image optimisation

| Package | Used by | Degraded behaviour | Production required? |
|---------|---------|-------------------|----------------------|
| `sharp` | `ImageOptimizationService` | Image resize/compress calls throw at runtime. Uploaded images are stored unoptimised. | Recommended |

`sharp` ships prebuilt native binaries. If the binary for the current platform is missing (e.g. after a cross-platform `npm ci`), the module load itself will throw. Rebuild with `npm rebuild sharp`.

### Slack health alerts

| Package | Env var | Degraded behaviour | Production required? |
|---------|---------|-------------------|----------------------|
| Slack webhook (HTTP, no extra package) | `SLACK_WEBHOOK_URL` | Slack provider is not registered in the notification manager. Health alerts are not sent to Slack. Other alert channels (if configured) are unaffected. | Recommended for on-call |

---

### Startup verification

Run these after deploying to confirm each optional subsystem is active:

```bash
# Redis — expect PONG
redis-cli -h $REDIS_HOST -p $REDIS_PORT ping

# Elasticsearch — expect HTTP 200 with cluster info
curl -s "$ELASTICSEARCH_URL" | grep cluster_name

# MeiliSearch — expect {"status":"available",...}
curl -s "$MEILISEARCH_HOST/health"

# FFmpeg — expect version string
ffmpeg -version | head -1

# Stripe — expect the key prefix (never log the full key)
echo $STRIPE_SECRET_KEY | cut -c1-7   # should print "sk_live" or "sk_test"

# Translation providers
echo "DeepL:  ${DEEPL_API_KEY:+set}${DEEPL_API_KEY:-NOT SET}"
echo "Google: ${GOOGLE_TRANSLATE_API_KEY:+set}${GOOGLE_TRANSLATE_API_KEY:-NOT SET}"

# TTS providers
echo "ElevenLabs:  ${ELEVENLABS_API_KEY:+set}${ELEVENLABS_API_KEY:-NOT SET}"
echo "Google TTS:  ${GOOGLE_TTS_API_KEY:+set}${GOOGLE_TTS_API_KEY:-NOT SET}"
```

The `/health` endpoint also reports Redis and queue connectivity — check it after startup:

```bash
curl -s http://localhost:$BACKEND_PORT/health | jq .
```

---

## Rate-limit validation runbook

The script `backend/scripts/test-rate-limit.sh` exercises all three rate limiters and exits non-zero on any failure. Run it against a live server — it does not start one.

### Limiter reference

| Limiter | Applied to | Window | Limit | Store (prod) |
|---------|-----------|--------|-------|--------------|
| `authLimiter` | `POST /api/auth/login` (and all `/api/auth/*`) | 15 min | 10 req | Redis |
| `aiLimiter` | `/api/ai/*`, `/api/tts/*`, `/api/translation/*` | 1 min | 30 req | Redis |
| `generalLimiter` | All other `/api/v1/*` routes | 1 min | 100 req | Redis |

In `development` and `test` the store falls back to in-process memory (Redis is not required). In `production` the Redis store is loaded automatically — limits are shared across all instances.

### Response shape on 429

Every limiter returns the same JSON body:

```json
{
  "success": false,
  "code": "RATE_LIMIT_EXCEEDED",
  "message": "Too many requests. Please slow down and try again later.",
  "retryAfter": 60,
  "timestamp": "2026-03-28T12:00:00.000Z"
}
```

Response headers (RFC 6585 `standardHeaders: true`, legacy headers disabled):

| Header | Meaning |
|--------|---------|
| `RateLimit-Limit` | Configured max for this window |
| `RateLimit-Remaining` | Requests left in the current window |
| `RateLimit-Reset` | Unix timestamp when the window resets |
| `Retry-After` | Seconds until the client may retry (present on 429 only) |

### Auth vs pre-auth limiter behaviour

The `authLimiter` is mounted **before** the authentication middleware on `/api/auth/*`. This means:

- Requests are counted regardless of whether credentials are valid.
- A 429 is returned before any credential check occurs — the response body will be the rate-limit JSON, not an auth error.
- The window is intentionally long (15 min) to slow credential-stuffing attacks.

The `aiLimiter` is also mounted before auth on `/api/ai/*`, `/api/tts/*`, and `/api/translation/*`. Unauthenticated requests normally receive `401`, but once the limit is exhausted they receive `429` instead. The script relies on this: it sends requests without a token and expects `401` for the first 30, then `429` on the 31st.

### Running locally

```bash
# Start the server in a separate terminal
cd backend && npm run dev

# Run the script (defaults to http://localhost:3001)
bash backend/scripts/test-rate-limit.sh

# Or against a custom URL
bash backend/scripts/test-rate-limit.sh http://localhost:4000
```

Expected output:

```
=== Rate Limit Tests against http://localhost:3001 ===

── Auth limiter (POST /api/auth/login, limit=10) ──
  ✓ 11th request returns 429 (got 429)

── AI limiter (POST /api/ai/analyze-image, limit=30) ──
  ✓ 31st request returns 429 (got 429)

── General limiter (GET /api/health, limit=100) ──
  ✓ 101st request returns 429 (got 429)

=== Results: 3 passed, 0 failed ===
```

The script exits `0` on full pass, `1` if any check fails.

### Running in CI

The script requires a running server and `curl`. A minimal GitHub Actions job:

```yaml
- name: Start server
  working-directory: backend
  run: npm run dev &
  env:
    DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
    JWT_SECRET: ${{ secrets.JWT_SECRET }}
    JWT_REFRESH_SECRET: ${{ secrets.JWT_REFRESH_SECRET }}
    TWITTER_API_KEY: placeholder
    TWITTER_API_SECRET: placeholder
    NODE_ENV: test

- name: Wait for server
  run: npx wait-on http://localhost:3001/health --timeout 30000

- name: Rate-limit smoke test
  run: bash backend/scripts/test-rate-limit.sh
```

Key points for CI:

- `NODE_ENV=test` keeps the store in-memory — no Redis needed.
- Each limiter window resets between CI runs because the in-memory store is process-scoped. If you run the script twice in the same process lifetime without restarting, the counters carry over and the second run will hit 429 immediately on the auth and AI checks. Restart the server between runs or add a sleep longer than the window (15 min for auth, 1 min for AI/general).
- The script is sequential (`curl` calls are not parallelised), so it is safe to run alongside other tests without cross-contamination.

### Troubleshooting

**All checks fail with `000`** — `curl` could not reach the server. Confirm the server is up:

```bash
curl -v http://localhost:3001/health
```

**Auth check fails — got `401` instead of `429`** — the in-memory counter was reset (server restarted between runs). Re-run without restarting the server.

**AI check fails — got `401` on the 31st request** — the AI limiter window (1 min) may have rolled over mid-loop. The 31 requests must complete within 60 seconds. On slow CI runners, add a warm-up check or reduce the window in the test environment.

**General check fails in production** — the Redis store is shared across instances. If multiple replicas are running, the 100-request budget is consumed across all of them. Run the script against a single isolated instance or a staging environment with one replica.

**429 body is not JSON** — a reverse proxy (nginx, ALB) may be intercepting and returning its own 429 before the request reaches the app. Check proxy rate-limit configuration.

## Handsoff notes

<!-- handsoff-issue-1620 -->
- #1620: [Bug] backend/src/scripts/data-pruning.ts CLI entrypoint has zero test coverage
