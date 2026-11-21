# Backend Architecture

## Module Structure

All features live under `src/modules/<feature>/`. Each module is self-contained:

```
src/modules/<feature>/
├── index.ts          # re-exports the router
├── routes.ts         # Express Router (or routes.<sub>.ts for multi-router modules)
├── controller.ts     # request/response handling, no business logic
├── service.ts        # business logic
└── schema.ts         # Zod validation schemas for this module
```

Sub-directories (`services/`, `controllers/`) are acceptable when a module
grows large enough to warrant splitting files, but the flat layout above is
preferred for new modules.

### Existing modules

| Module         | Path                        | Notes                                      |
|----------------|-----------------------------|--------------------------------------------|
| auth           | `src/modules/auth/`         | controllers/ and middleware/ sub-dirs      |
| billing        | `src/modules/billing/`      | services/ sub-dir                          |
| content        | `src/modules/content/`      | routes.video / routes.tts / routes.translation |
| social         | `src/modules/social/`       | routes.youtube / routes.facebook; TikTok pending migration |
| analytics      | `src/modules/analytics/`    |                                            |
| health         | `src/modules/health/`       |                                            |
| organization   | `src/modules/organization/` |                                            |
| webhook        | `src/modules/webhook/`      |                                            |

### Route registration

`src/modules/index.ts` (`registerModules`) is the single place where module
routers are mounted onto the Express app. `src/routes/v1/index.ts` is the
**legacy** entry point and will be removed once all standalone route files are
migrated.

---

## Admin Audit Log

Admin mutations write structured audit entries. The field schema and the list
of covered admin actions are documented in
[module-architecture.md](./module-architecture.md#admin-audit-log-fields).

---

## Migration Plan

Standalone files in `src/routes/` must be migrated into modules
**one file at a time** to keep PRs reviewable. Suggested order (lowest risk
first):

| Priority | Route file              | Target module              | Notes                              |
|----------|-------------------------|----------------------------|------------------------------------|
| 1        | `routes/status.ts`      | `modules/health/`          | trivial, no service dependency     |
| 2        | `routes/config.ts`      | new `modules/config/`      |                                    |
| 3        | `routes/roles.ts`       | new `modules/roles/`       |                                    |
| 4        | `routes/audit.ts`       | new `modules/audit/`       |                                    |
| 5        | `routes/listings.ts`    | new `modules/listings/`    |                                    |
| 6        | `routes/realtime.ts`    | new `modules/realtime/`    | see [SSE ticket service](#sse-ticket-service) |
| 7        | `routes/images.ts`      | new `modules/media/`       | group with video                   |
| 8        | `routes/exports.ts`     | new `modules/exports/`     |                                    |
| 9        | `routes/jobs.ts`        | new `modules/jobs/`        |                                    |
| 10       | `routes/circuitBreaker.ts` | new `modules/circuitBreaker/` |                               |
| 11       | `routes/ai.ts`          | new `modules/ai/`          |                                    |
| 12       | `routes/tiktok.ts`      | `modules/social/`          | add routes.tiktok.ts               |
| 13       | `routes/predictive.ts`  | new `modules/predictive/`  | currently empty                    |

**Migration steps per route file:**

1. Create `src/modules/<feature>/routes.ts` (copy router, adjust imports).
2. Register the new router in `src/modules/index.ts` (`registerModules`).
3. Remove the import and `router.use(...)` line from `src/routes/v1/index.ts`.
4. Delete the old `src/routes/<file>.ts`.
5. Verify no other file imports from the deleted path.

Once all files are migrated, delete `src/routes/` and `src/routes/v1/index.ts`.

---

## Rules

- **No new files in `src/routes/`** — enforced by ESLint (see `eslint.config.js`).
- New features must start as a module under `src/modules/`.
- A module router is mounted exclusively in `registerModules`; never imported
  directly elsewhere.

---

## SSE Ticket Service

Server-Sent Events (SSE) connections are authenticated with short-lived,
single-use tickets rather than long-lived bearer tokens. The realtime route
(`routes/realtime.ts`, migrating to `modules/realtime/` — see the
[Migration Plan](#migration-plan)) issues and redeems these tickets.

### Lifecycle

```
client ──POST /realtime/ticket──▶ ticket service
                                   │ 1. generate 32 random bytes
                                   │ 2. hex-encode (64 chars)
                                   │ 3. store in Redis: ticket -> userId
                                   │    with a 30s TTL
                                   ▼
client ◀──ticket───────────────────┘

client ──GET /realtime/stream?ticket=…──▶ ticket service
                                          │ 4. atomic GETDEL on Redis
                                          │ 5. valid  -> open SSE stream
                                          │    missing -> 401
                                          ▼
```

### Issuance

- The ticket is 32 cryptographically random bytes, hex-encoded to a 64-character
  string.
- It is stored in Redis keyed by the ticket value, mapping to the authenticated
  user, with a **30 second TTL**.
- Tickets are never logged or echoed back outside the issuance response.

### Redemption

- Redemption uses an atomic `GETDEL`, so a ticket can be consumed exactly once
  even under concurrent requests.
- A missing or expired ticket yields `401`; the client must request a new one.
- Because state lives in Redis rather than process memory, a ticket issued by
  one replica can be redeemed by any other replica behind the load balancer.

### Bounds and sweeping

- The ticket map is capped in size; when the cap is reached, issuance is
  rejected rather than growing unbounded.
- Expired entries are removed by a periodic sweep that runs on the sweep
  interval, in addition to Redis TTL expiry.
- TTL and cap values are fixed here for reference only; see
  `backend/docs/performance-budget.md` for the current numbers and their
  rationale.
