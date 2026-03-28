# Minimum Production Dependency Set

This document defines which optional components **must** be operational before a production deployment is considered healthy. Missing any of these will leave the system in a degraded state that is not acceptable for production traffic.

## Hard requirements (process exits if missing)

These are validated at startup via Zod in `src/config/config.ts`. The process will not start without them.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `JWT_SECRET` | Access token signing |
| `JWT_REFRESH_SECRET` | Refresh token signing |
| `TWITTER_API_KEY` / `TWITTER_API_SECRET` | Twitter integration |

## Required for production-grade operation

The following components are optional at the code level (the process boots without them) but **must** be present in production. Their absence is tracked by the `app_degraded_capabilities` Prometheus gauge and logged as warnings in the startup summary.

### Redis (all four subsystems)

| Env vars | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB` |
|---|---|
| Subsystems affected | BullMQ job queues, distributed rate limiting, JWT blacklist / token revocation, response cache |
| Degraded behaviour | Jobs don't run; rate limits are per-instance only; revoked tokens stay valid; cache always misses |

`rate-limit-redis` must also be resolvable at runtime (it is a peer-optional npm dep). The `rate-limit-redis` capability in the startup summary confirms this.

### Stripe (if billing is enabled)

| Env vars | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |
|---|---|
| Degraded behaviour | All `/billing` routes throw on first call; webhook signature verification fails |

### MeiliSearch (if full-text search is used)

| Env vars | `MEILISEARCH_HOST`, `MEILISEARCH_ADMIN_KEY`, `MEILISEARCH_SEARCH_KEY` |
|---|---|
| Degraded behaviour | Every search call fails with a connection error |

### FFmpeg (if video features are used)

| Binary | `ffmpeg` on `PATH` |
|---|---|
| Degraded behaviour | Video transcoding jobs fail at spawn; uploaded files are never processed |

## Recommended for observability

These are not strictly required but their absence reduces operational visibility.

| Component | Env var(s) | Without it |
|---|---|---|
| Elasticsearch log shipping | `ELASTICSEARCH_URL` | Logs go to console/file only; no Kibana indexing |
| Slack health alerts | `SLACK_WEBHOOK_URL` | On-call team receives no automated alerts |
| Image optimisation | _(sharp native binary)_ | Images stored unoptimised |

## Startup verification

At every startup `checkIntegrations()` emits a structured log line at `info` level:

```
Optional component startup summary  { enabled: [...], disabled: [...], degradedCount: N }
```

If any components are disabled a second `warn` line lists them explicitly.

The Prometheus gauge `app_degraded_capabilities{capability="<name>"}` is set to `1` for every degraded component and `0` for every healthy one. Alert on:

```promql
app_degraded_capabilities{capability=~"rate-limit-redis|stripe|meilisearch"} == 1
```

To enforce that specific integrations are present at startup, add them to `REQUIRE_INTEGRATIONS` (comma-separated). The process will exit with an error if any listed integration is disabled:

```bash
REQUIRE_INTEGRATIONS=stripe,rate-limit-redis
```
