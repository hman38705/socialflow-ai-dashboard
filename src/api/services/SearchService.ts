// Hand-written wrapper — `/api/search` is not yet in backend/openapi.yaml, so
// this isn't produced by `npm run generate-client` like its sibling services.
// It follows the same request/OpenAPI pattern so it can be dropped once the
// endpoint is added to the spec and the client is regenerated.
import { OpenAPI } from '../core/OpenAPI';
import { request } from '../core/request';

export type SearchEntityType = 'post' | 'media' | 'webhook';

export interface SearchResultItem {
  id: string;
  type: SearchEntityType;
  title: string;
  snippet?: string;
  url?: string;
  createdAt?: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResultItem[];
}

export class SearchService {
  static getSearch(q: string): Promise<SearchResponse> {
    return request(OpenAPI, { method: 'GET', url: '/api/search', query: { q } });
  }
}
