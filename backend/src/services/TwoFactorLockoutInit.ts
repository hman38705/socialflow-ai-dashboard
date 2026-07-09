/**
 * 2FA Lockout Store initialization (#610)
 * Initializes the twoFactorService to use Redis-backed lockout store
 * This ensures lockout state persists across server restarts
 */

import { redisTwoFactorLockoutStore, TwoFactorLockoutStore } from './TwoFactorLockoutService';
import { createLogger } from '../lib/logger';

const logger = createLogger('2fa-init');

// Loaded via require (not a static import) so the backend's TS program — which
// lacks DOM lib types — doesn't type-check this browser-facing frontend module.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { twoFactorService } = require('../../../src/services/twoFactorService') as {
  twoFactorService: { setLockoutStore(store: TwoFactorLockoutStore): void };
};

/**
 * Initialize 2FA lockout with Redis store
 * Call this during server startup to ensure persistent lockout state
 */
export const initialize2FaLockoutStore = (): void => {
  try {
    twoFactorService.setLockoutStore(redisTwoFactorLockoutStore);
    logger.info('Initialized 2FA lockout store with Redis backend');
  } catch (error) {
    logger.error('Failed to initialize 2FA lockout store', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
