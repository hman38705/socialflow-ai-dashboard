import React, { useEffect, useMemo, useState } from 'react';
import { search } from '../services/searchClient';
import type { SearchEntityType, SearchResultItem } from '../services/searchClient';

const RECENT_SEARCHES_KEY = 'socialflow.recentSearches';
const MAX_RECENT_SEARCHES = 8;
const DEBOUNCE_MS = 300;

const ENTITY_LABELS: Record<SearchEntityType, string> = {
  post: 'Posts',
  media: 'Media',
  webhook: 'Webhooks',
};

function getQueryFromLocation(): string {
  return new URLSearchParams(window.location.search).get('q') ?? '';
}

function readRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(query: string) {
  if (!query.trim()) return;
  try {
    const existing = readRecentSearches().filter(q => q !== query);
    const next = [query, ...existing].slice(0, MAX_RECENT_SEARCHES);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — recent searches just won't persist.
  }
}

// Renders `text` with every case-insensitive occurrence of `query` wrapped in
// <mark>. Built entirely from React text nodes — never dangerouslySetInnerHTML
// — so there is no HTML-injection surface from either the query or the text.
function highlightMatches(text: string, query: string): React.ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerQuery, cursor);

  if (matchIndex === -1) return text;

  let key = 0;
  while (matchIndex !== -1) {
    if (matchIndex > cursor) parts.push(text.slice(cursor, matchIndex));
    parts.push(
      <mark key={key++} className="bg-yellow-200 rounded-sm">
        {text.slice(matchIndex, matchIndex + trimmed.length)}
      </mark>
    );
    cursor = matchIndex + trimmed.length;
    matchIndex = lowerText.indexOf(lowerQuery, cursor);
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

const SearchPage: React.FC = () => {
  const [inputValue, setInputValue] = useState(() => getQueryFromLocation());
  const [committedQuery, setCommittedQuery] = useState(() => getQueryFromLocation());
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => readRecentSearches());

  // Debounce keystrokes into a committed query.
  useEffect(() => {
    const handle = setTimeout(() => setCommittedQuery(inputValue), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [inputValue]);

  // Sync the committed query to the URL so it's shareable and restorable.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const current = params.get('q') ?? '';
    if (current === committedQuery) return;

    if (committedQuery) {
      params.set('q', committedQuery);
    } else {
      params.delete('q');
    }
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
    window.history.pushState({ q: committedQuery }, '', nextUrl);
  }, [committedQuery]);

  // Restore the query on browser back/forward navigation.
  useEffect(() => {
    const onPopState = () => {
      const q = getQueryFromLocation();
      setInputValue(q);
      setCommittedQuery(q);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Run the search whenever the committed query changes.
  useEffect(() => {
    if (!committedQuery.trim()) {
      setResults([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    search(committedQuery)
      .then(response => {
        if (cancelled) return;
        setResults(response?.results ?? []);
        saveRecentSearch(committedQuery);
        setRecentSearches(readRecentSearches());
      })
      .catch(() => {
        if (!cancelled) setError('Search failed. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [committedQuery]);

  const grouped = useMemo(() => {
    const groups: Record<SearchEntityType, SearchResultItem[]> = { post: [], media: [], webhook: [] };
    for (const item of results) {
      groups[item.type]?.push(item);
    }
    return groups;
  }, [results]);

  const hasQuery = committedQuery.trim().length > 0;
  const hasResults = results.length > 0;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold mb-3">Search</h1>
        <input
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          placeholder="Search posts, media, webhooks…"
          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
      </div>

      {!hasQuery && (
        <div>
          <h2 className="text-sm font-semibold text-gray-600 mb-2">Recent searches</h2>
          {recentSearches.length === 0 ? (
            <p className="text-sm text-gray-500">No recent searches yet.</p>
          ) : (
            <ul className="space-y-1">
              {recentSearches.map(q => (
                <li key={q}>
                  <button
                    onClick={() => setInputValue(q)}
                    className="text-sm text-blue-600 hover:underline"
                  >
                    {q}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {hasQuery && loading && <p className="text-sm text-gray-500">Searching…</p>}
      {hasQuery && error && <p className="text-sm text-red-600">{error}</p>}

      {hasQuery && !loading && !error && !hasResults && (
        <div className="text-center py-10 border border-dashed border-gray-300 rounded-md">
          <p className="text-gray-700 font-medium">No results for “{committedQuery}”.</p>
          <p className="text-sm text-gray-500 mt-1">
            Try a different term, or check the spelling of what you searched for.
          </p>
        </div>
      )}

      {hasQuery && !loading && !error && hasResults && (
        <div className="space-y-6">
          {(Object.keys(ENTITY_LABELS) as SearchEntityType[]).map(type => {
            const items = grouped[type];
            if (items.length === 0) return null;
            return (
              <div key={type}>
                <h2 className="text-sm font-semibold text-gray-600 mb-2">
                  {ENTITY_LABELS[type]} ({items.length})
                </h2>
                <ul className="space-y-2">
                  {items.map(item => (
                    <li key={item.id} className="p-3 border border-gray-200 rounded-md">
                      <p className="font-medium">{highlightMatches(item.title, committedQuery)}</p>
                      {item.snippet && (
                        <p className="text-sm text-gray-600 mt-1">
                          {highlightMatches(item.snippet, committedQuery)}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SearchPage;
