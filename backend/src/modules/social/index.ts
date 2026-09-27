/**
 * Social module.
 *
 * Scope: social platform integrations (Twitter/X, YouTube, Facebook) exposed
 * as services that other modules can consume for publishing and fetching
 * social content.
 *
 * Migration status: work-in-progress migration target. This module is the
 * intended home for the social domain, but the live/mounted implementation
 * still lives in the legacy flat tree (`backend/src/routes`, `backend/src/controllers`,
 * `backend/src/services`). Until the legacy social routes/controllers/services
 * are ported here and wired up, treat the legacy flat implementation as
 * authoritative for runtime behavior.
 *
 * Public API surface: the platform service classes re-exported below
 * (`TwitterService`, `YouTubeService`, `FacebookService`).
 *
 * Stubs / migration plan: the services here are the migration target for the
 * legacy social services; any behavior not yet ported remains in the legacy
 * flat tree. New social work should land in this module and the legacy
 * equivalent should be removed once parity is reached.
 */
export { TwitterService } from './services/TwitterService';
export { YouTubeService } from './services/YouTubeService';
export { FacebookService } from './services/FacebookService';
