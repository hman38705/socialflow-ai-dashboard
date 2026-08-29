import { SearchService } from '../api/services/SearchService';

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

export function search(q: string, limit?: number): Promise<SearchResponse> {
  return SearchService.getSearch({ q, limit }) as Promise<SearchResponse>;
}
