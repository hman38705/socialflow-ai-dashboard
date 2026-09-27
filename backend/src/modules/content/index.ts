/**
 * Content module.
 *
 * Scope: content-domain services — video handling (`VideoService`), subtitle/
 * text translation (`TranslationService`), and text-to-speech synthesis
 * (`TTSService`). This module owns the content pipeline used by the API layer.
 *
 * Migration status: work-in-progress migration target. This module is the
 * intended home for content-domain logic, but the legacy flat implementation
 * under `backend/src/{routes,controllers,services}` is still the live/mounted
 * implementation for the corresponding endpoints. Treat the legacy tree as
 * authoritative until the routes/controllers are moved here and mounted.
 *
 * Legacy equivalent: `backend/src/routes`, `backend/src/controllers`, and
 * `backend/src/services` (content-related files).
 */
export { VideoService } from './services/VideoService';
export { TranslationService } from './services/TranslationService';
export { TTSService } from './services/TTSService';
