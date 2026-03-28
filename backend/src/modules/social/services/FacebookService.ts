/**
 * @deprecated This file is deprecated and will be removed in a future version.
 * 
 * The canonical implementation has been consolidated to:
 * backend/src/services/FacebookService.ts
 * 
 * This wrapper re-exports from the canonical location for backward compatibility.
 * Please update your imports to use the canonical location directly:
 * 
 * Before:
 *   import { facebookService } from '../services/FacebookService';
 * 
 * After:
 *   import { facebookService } from '../../services/FacebookService';
 * 
 * Migration deadline: 2026-06-30
 */

// Re-export everything from the canonical implementation
export {
  FacebookPage,
  FacebookPagePost,
  FacebookTokens,
  FacebookPostRequest,
  FacebookComment,
  facebookService,
} from '../../../services/FacebookService';
