import { MeiliSearch } from 'meilisearch';
import { config } from '../config/config';

let _client: MeiliSearch | null = null;

export function getMeiliClient(): MeiliSearch {
  if (!_client) {
    if (config.MEILISEARCH_HOST === 'http://localhost:7700' && config.NODE_ENV !== 'development') {
      console.warn(
        '[MeiliSearch] WARNING: MEILISEARCH_HOST is configured to localhost in a non-development environment. ' +
        'Search will fail in Kubernetes pods. Set MEILISEARCH_HOST to the actual MeiliSearch service endpoint.'
      );
    }
    _client = new MeiliSearch({
      host: config.MEILISEARCH_HOST,
      apiKey: config.MEILISEARCH_ADMIN_KEY,
    });
  }
  return _client;
}
