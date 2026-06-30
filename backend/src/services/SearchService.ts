import { getMeiliClient } from '../lib/meilisearch';
import { createLogger } from '../lib/logger';

const logger = createLogger('search-service');

export const POSTS_INDEX = 'posts';

export interface PostDocument {
  id: string;
  organizationId: string;
  content: string;
  platform: string;
  scheduledAt: string | null;
  createdAt: string;
}

/** Ensure the posts index exists with the correct settings. Call once at startup. */
export async function initSearchIndex(): Promise<void> {
  const client = getMeiliClient();
  try {
    await client.createIndex(POSTS_INDEX, { primaryKey: 'id' });
  } catch (err) {
    // Index may already exist; continue to apply settings
    if ((err as any).code !== 'index_already_exists') {
      throw err;
    }
  }
  
  const index = client.index(POSTS_INDEX);
  await index.updateSettings({
    searchableAttributes: ['content', 'platform'],
    filterableAttributes: ['organizationId', 'platform', 'scheduledAt'],
    sortableAttributes: ['createdAt', 'scheduledAt'],
  });
  logger.info('Meilisearch index initialised', { index: POSTS_INDEX });
}

/** Index (upsert) a single post document. */
export async function indexPost(doc: PostDocument): Promise<void> {
  try {
    await getMeiliClient().index(POSTS_INDEX).addDocuments([doc]);
  } catch (err) {
    logger.error('Failed to index post', { id: doc.id, error: (err as Error).message });
  }
}

/** Remove a post from the search index. */
export async function deletePost(postId: string): Promise<void> {
  try {
    await getMeiliClient().index(POSTS_INDEX).deleteDocument(postId);
  } catch (err) {
    logger.error('Failed to delete post from index', { id: postId, error: (err as Error).message });
  }
}

/** Escape a value for use inside a Meilisearch double-quoted filter string. */
function escapeMeiliFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Full-text search across posts. organizationId is required to scope results to one org. */
export async function searchPosts(
  query: string,
  opts: {
    organizationId: string;
    platform?: string;
    limit?: number;
    offset?: number;
  },
) {
  const VALID_PLATFORMS = new Set(['twitter', 'instagram', 'facebook', 'linkedin', 'tiktok', 'youtube']);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!UUID_RE.test(opts.organizationId)) {
    throw new Error('Invalid organizationId');
  }
  if (opts.platform && !VALID_PLATFORMS.has(opts.platform)) {
    throw new Error('Invalid platform value');
  }

  const filter: string[] = [`organizationId = "${escapeMeiliFilterValue(opts.organizationId)}"`];
  if (opts.platform) filter.push(`platform = "${escapeMeiliFilterValue(opts.platform)}"`);

  return getMeiliClient()
    .index(POSTS_INDEX)
    .search(query, {
      filter,
      limit: opts.limit ?? 20,
      offset: opts.offset ?? 0,
    });
}
