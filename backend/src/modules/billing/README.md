# Billing Module

## Scope

The `billing` module owns everything related to monetization for the platform:
subscriptions, plans, invoices, payment methods, and the webhook handling that
keeps local billing state in sync with the payment provider.

## Migration status

This module is a **work-in-progress migration target**. It is being built out as
the eventual home for all billing logic, but it is **not yet the live/mounted
implementation**. The currently authoritative, mounted implementation still
lives in the legacy flat tree:

- `backend/src/routes/` — billing route definitions
- `backend/src/controllers/` — billing request handlers
- `backend/src/services/` — billing business logic and provider integration

Until the migration is complete, treat the legacy flat files as the source of
truth for runtime behavior. Anything under `backend/src/modules/billing/` should
be considered in-progress and may be a stub.

## Public API surface

`index.ts` is the module entry point and re-exports the module's public surface
(router, service, and types). Consumers should import from the module root
rather than reaching into individual files.

## Migration plan

1. Port billing logic from `backend/src/services/` into this module, one concern
   at a time (plans, subscriptions, invoices, webhooks).
2. Move route definitions from `backend/src/routes/` into the module's router.
3. Move request handling from `backend/src/controllers/` into the module.
4. Once parity is reached and verified, mount this module's router and remove
   the corresponding legacy flat files.

## Contributing

When adding billing behavior, prefer extending this module. If you must change
the legacy flat implementation, note the change here so the two trees do not
drift further apart.
