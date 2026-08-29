import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, LayoutGrid, Search, Webhook } from 'lucide-react';
import { SearchService } from '../../api/services/SearchService';
import { useComposer } from '../../contexts/ComposerContext';

// === Constants

const RECENT_KEY = 'sf.cmdk.recent';
const RECENT_MAX = 5;
const SEARCH_DEBOUNCE_MS = 250;

// === Types

interface Command {
  id: string;
  label: string;
  section: 'Navigation' | 'Actions' | 'Search';
  Icon: typeof Search;
  run: () => void;
}

// === Helpers

function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecent(id: string): void {
  try {
    const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

interface SearchHit {
  id?: string;
  title?: string;
}

// === Component

export const CommandPalette: React.FC = () => {
  const navigate = useNavigate();
  const { openComposer } = useComposer();

  const [open, setOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [active, setActive] = useState<number>(0);

  // Only `.cancel()` is used; the generated `CancelablePromise<T>` is invariant in `T`,
  // so this narrower shape avoids fighting the type system for a single method.
  const inFlight = useRef<{ cancel: () => void } | null>(null);
  const reqSeq = useRef<number>(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = 'cmdk-listbox';

  // Global shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (isTextEntry(e.target)) return;
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults([]);
    setActive(0);
    inFlight.current?.cancel();
    inFlight.current = null;
  }, []);

  // Debounced, cancelable search.
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    inFlight.current?.cancel();
    inFlight.current = null;

    const q = query.trim();
    if (!open || q.length === 0) {
      setResults([]);
      return;
    }

    debounceTimer.current = setTimeout(() => {
      const seq = ++reqSeq.current;
      const promise = SearchService.getSearch({ q });
      inFlight.current = promise;
      (promise as Promise<{ results?: SearchHit[] }>)
        .then((payload) => {
          // A newer request has started - drop this (stale) response.
          if (seq !== reqSeq.current) return;
          setResults(Array.isArray(payload?.results) ? payload.results : []);
          setActive(0);
        })
        .catch(() => {
          /* cancelled or failed - leave the previous results in place */
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const staticCommands: Command[] = useMemo(
    () => [
      {
        id: 'nav:analytics',
        label: 'Go to Analytics',
        section: 'Navigation',
        Icon: LayoutGrid,
        run: () => navigate('/analytics'),
      },
      {
        id: 'nav:scheduler',
        label: 'Go to Scheduler',
        section: 'Navigation',
        Icon: LayoutGrid,
        run: () => navigate('/scheduler'),
      },
      {
        id: 'nav:predictor',
        label: 'Go to Predictor',
        section: 'Navigation',
        Icon: LayoutGrid,
        run: () => navigate('/predictor'),
      },
      {
        id: 'nav:settings',
        label: 'Go to Settings',
        section: 'Navigation',
        Icon: LayoutGrid,
        run: () => navigate('/settings'),
      },
      {
        id: 'action:new-post',
        label: 'New post',
        section: 'Actions',
        Icon: FileText,
        run: () => openComposer(),
      },
      {
        id: 'action:new-webhook',
        label: 'New webhook',
        section: 'Actions',
        Icon: Webhook,
        run: () => navigate('/settings/webhooks'),
      },
    ],
    [navigate, openComposer],
  );

  const q = query.trim().toLowerCase();
  const filteredStatic = q
    ? staticCommands.filter((c) => c.label.toLowerCase().includes(q))
    : staticCommands;

  const searchCommands: Command[] = results.map((hit, i) => ({
    id: `search:${hit.id ?? i}`,
    label: hit.title ?? 'Untitled',
    section: 'Search',
    Icon: Search,
    run: () => navigate(`/search?q=${encodeURIComponent(query)}`),
  }));

  const commands = [...filteredStatic, ...searchCommands];

  const runAt = (index: number) => {
    const cmd = commands[index];
    if (!cmd) return;
    if (cmd.section !== 'Search') pushRecent(cmd.id);
    cmd.run();
    close();
  };

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (commands.length ? (i + 1) % commands.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (commands.length ? (i - 1 + commands.length) % commands.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(active);
    }
  };

  if (!open) return null;

  let renderedSection = '';

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-24">
      <div className="fixed inset-0 bg-black/60" aria-hidden="true" onClick={close} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-dark-border bg-dark-elev shadow-elev-3"
      >
        <div className="flex items-center gap-2 border-b border-dark-border px-4 py-3">
          <Search className="h-4 w-4 text-gray-subtext" aria-hidden="true" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={commands[active] ? `cmdk-opt-${active}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-sm text-white/90 outline-none placeholder:text-gray-subtext"
          />
          <kbd className="rounded bg-white/10 px-1.5 text-[10px] font-semibold text-gray-subtext">
            Esc
          </kbd>
        </div>

        <ul id={listId} role="listbox" className="max-h-80 overflow-y-auto p-1">
          {commands.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-gray-subtext">No matches</li>
          )}
          {commands.map((cmd, i) => {
            const header = cmd.section !== renderedSection ? cmd.section : null;
            renderedSection = cmd.section;
            const { Icon } = cmd;
            return (
              <React.Fragment key={cmd.id}>
                {header && (
                  <li
                    aria-hidden="true"
                    className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-gray-subtext"
                  >
                    {header}
                  </li>
                )}
                <li
                  id={`cmdk-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => runAt(i)}
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                    i === active ? 'bg-primary-blue/15 text-primary-blue' : 'text-white/90'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {cmd.label}
                </li>
              </React.Fragment>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default CommandPalette;
