import React, { useEffect, useMemo, useRef, useState } from 'react';

// === Types

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: string;
  /** Render the cell with `font-mono` for tabular figure alignment. */
  numeric?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  caption?: string;

  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;

  loading?: boolean;
  loadingRows?: number;

  /** Controlled sort. When omitted, the table sorts nothing itself and just cycles
   *  `aria-sort`, leaving ordering to the caller via `onSortChange`. */
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;

  /** Shown when `rows` is empty and not loading (typically an `<EmptyState />`). */
  emptyState?: React.ReactNode;
}

// === Helpers

function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}

function ariaSort(sort: SortState | null, key: string): React.AriaAttributes['aria-sort'] {
  if (!sort || sort.key !== key) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

const alignClass = { left: 'text-left', center: 'text-center', right: 'text-right' } as const;

// === Component

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  caption,
  selectable = false,
  selectedIds,
  onSelectionChange,
  loading = false,
  loadingRows = 5,
  sort,
  onSortChange,
  emptyState,
}: DataTableProps<T>) {
  const [internalSort, setInternalSort] = useState<SortState | null>(null);
  const activeSort = sort !== undefined ? sort : internalSort;

  const handleSort = (key: string) => {
    const updated = nextSort(activeSort ?? null, key);
    if (sort === undefined) setInternalSort(updated);
    onSortChange?.(updated);
  };

  const selected = useMemo(() => new Set(selectedIds ?? []), [selectedIds]);
  const allIds = useMemo(() => rows.map(getRowId), [rows, getRowId]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const someSelected = allIds.some((id) => selected.has(id)) && !allSelected;

  const headerCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleAll = () => {
    onSelectionChange?.(allSelected ? [] : allIds);
  };
  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange?.([...next]);
  };

  const colCount = columns.length + (selectable ? 1 : 0);
  const showEmpty = !loading && rows.length === 0;

  return (
    <div className="overflow-x-auto rounded-2xl border border-dark-border">
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="sticky top-0 z-10 bg-dark-elev">
          <tr>
            {selectable && (
              <th scope="col" className="w-10 px-3 py-2">
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={allSelected}
                  onChange={toggleAll}
                />
              </th>
            )}
            {columns.map((col) => {
              const sortState = ariaSort(activeSort ?? null, col.key);
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={col.sortable ? sortState : undefined}
                  style={col.width ? { width: col.width } : undefined}
                  className={`px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-subtext ${
                    alignClass[col.align ?? 'left']
                  }`}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => handleSort(col.key)}
                      className="inline-flex items-center gap-1 hover:text-white/90"
                    >
                      {col.header}
                      <span aria-hidden="true">
                        {sortState === 'ascending' ? '↑' : sortState === 'descending' ? '↓' : '↕'}
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: loadingRows }, (_, r) => (
              <tr key={`skeleton-${r}`} data-testid="skeleton-row">
                {Array.from({ length: colCount }, (_, c) => (
                  <td key={c} className="px-3 py-3">
                    <div className="h-4 w-full animate-pulse rounded bg-dark-border" />
                  </td>
                ))}
              </tr>
            ))}

          {!loading &&
            rows.map((row) => {
              const id = getRowId(row);
              return (
                <tr key={id} className="border-t border-dark-border hover:bg-white/[0.02]">
                  {selectable && (
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select row ${id}`}
                        checked={selected.has(id)}
                        onChange={() => toggleRow(id)}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2 text-white/90 ${alignClass[col.align ?? 'left']} ${
                        col.numeric ? 'font-mono tabular-nums' : ''
                      }`}
                    >
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>

      {showEmpty && <div className="p-6">{emptyState}</div>}
    </div>
  );
}

export default DataTable;
