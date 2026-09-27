# Webhook Module

## Scope

This module owns the inbound and outbound webhook surface for the backend:

- **Inbound webhooks** — receiving and verifying callbacks from third-party providers (e.g. payment, social, and content providers) and dispatching them to the appropriate handlers.
- **Outbound webhooks** — registering subscriber endpoints and delivering signed event payloads to them.
- **Webhook services** — the domain logic backing the above, under `services/`.
- **Routes** — the HTTP surface for webhook registration, delivery status, and provider callbacks, exported from `routes.ts`.

## Migration status

**Work-in-progress migration target — not yet the live implementation.**

The live request path is still served by the legacy flat layout. `src/app.ts` mounts `src/routes/v1/index.ts` for both `/api/v1` and the legacy `/api` prefix, and `registerModules()` from `src/modules/index.ts` is not yet wired into the app. This module exists in parallel as the target architecture and will become authoritative once the webhook routes are migrated and verified.

Until then, treat this module as the canonical home for **new** webhook code, but be aware that the mounted behavior still comes from the legacy tree.

## Legacy equivalent

The flat implementation this module is migrating from lives in:

| Concern | Legacy path | Canonical (this module) |
|---|---|---|
| Routes | `src/routes/` (webhook routes) | `src/modules/webhook/routes.ts` |
| Controllers | `src/controllers/` | `src/modules/webhook/` (controllers, if present) |
| Services | `src/services/` | `src/modules/webhook/services/` |
| Schemas | `src/schemas/webhooks.ts` | `src/shared/schemas/webhooks.ts` |

Note: `src/schemas/webhooks.ts` and `src/shared/schemas/webhooks.ts` are **known diverged** — the flat copy has additional event types. Reconcile both copies when migrating rather than overwriting.

## Related documentation

See [`backend/docs/module-architecture.md`](../../../docs/module-architecture.md) for the full migration plan, the list of deprecated directories, and contribution guidelines.
