// Thin re-export of the canonical CORS config so `shared` can never diverge
// from backend/src/config/cors.ts (see #1319 / #1631).
export { corsOptions, allowedOrigins } from '../../config/cors';
