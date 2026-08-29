/** @type {import('jest').Config} */
// Frontend tests moved to Vitest (FE-005); the Jest "frontend" project that
// used to point at src/**/*.test.ts was removed here as part of FE-124 so no
// CI step or local `npm run test:*` silently no-ops against a deleted
// config. Run `npm run test:run` (Vitest) for frontend, and this file for
// backend only.
module.exports = {
  projects: ['<rootDir>/backend'],
};
