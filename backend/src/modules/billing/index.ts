/**
 * Billing module.
 *
 * Scope: subscription plans, invoices, and payment-method handling for the
 * platform's billing domain.
 *
 * Migration status: work-in-progress migration target. This module is the
 * intended home for the billing domain as the codebase moves away from the
 * legacy flat tree, but it is not yet the live/mounted implementation — the
 * currently mounted billing routes/controllers/services still live under the
 * legacy flat tree at `backend/src/routes`, `backend/src/controllers`, and
 * `backend/src/services`. Treat the legacy implementation as authoritative
 * until this module is wired up and mounted.
 *
 * Public API surface: re-exports the module's services (currently
 * `BillingService`). Consumers should import from this module entry point
 * rather than reaching into `./services/*` directly.
 */
export { BillingService } from './services/BillingService';
