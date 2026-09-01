# Documentation Index

Operational and architectural documentation for **SocialFlow AI Dashboard**.

> Keep `docs/**` under the markdown link-check in CI — see `scripts/check-doc-links.mjs`. When you add
> a page, link it here.

## Architecture / decisions

- [FE-ADR-0001 — Frontend state management: Context + hooks over a state library](adr/0001-frontend-state-management.md)
- [Frontend source guide (`src/`)](../src/README.md) — folder layout, "never hand-edit `src/api`", provider nesting, token usage, test-utils.

## Frontend

- [Accessibility audit & token contrast](accessibility.md) (FE-122)
- [Performance budget](performance-budget.md) (FE-123)
- [Analytics data sources](analytics-data-sources.md)

## Operations

- [Worker queue & job status reference](worker-queue-status.md)

## Fixes

- [backend `fixes/`](fixes/) — root-caused issue write-ups (env-example completeness, privilege-escalation, CORS/node-env, …)
