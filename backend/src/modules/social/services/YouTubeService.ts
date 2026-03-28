/**
 * @deprecated This file is deprecated and will be removed in a future version.
 * 
 * The canonical implementation has been consolidated to:
 * backend/src/services/YouTubeService.ts
 * 
 * This wrapper re-exports from the canonical location for backward compatibility.
 * Please update your imports to use the canonical location directly:
 * 
 * Before:
 *   import { youTubeService } from '../services/YouTubeService';
 * 
 * After:
 *   import { youTubeService } from '../../services/YouTubeService';
 * 
 * Migration deadline: 2026-06-30
 */

// Re-export everything from the canonical implementation
export {
  YouTubeVideoStats,
  YouTubeChannel,
  YouTubeTokens,
  youTubeService,
} from '../../../services/YouTubeService';
