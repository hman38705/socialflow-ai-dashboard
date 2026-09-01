import React from 'react';

// === Types

interface PaginationProps {
  page: number;
  /** The server contract calls this `limit`; the prop name matches the design spec. */
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

type PageToken = number | 'ellipsis';

// === Helpers

/**
 * Page list with at most one leading and one trailing ellipsis: always show page 1 and
 * the last page, plus the current page and its immediate neighbours.
 */
export function pageTokens(current: number, pageCount: number): PageToken[] {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }
  const tokens: PageToken[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(pageCount - 1, current + 1);

  if (start > 2) tokens.push('ellipsis');
  for (let p = start; p <= end; p += 1) tokens.push(p);
  if (end < pageCount - 1) tokens.push('ellipsis');

  tokens.push(pageCount);
  return tokens;
}

// === Component

export const Pagination: React.FC<PaginationProps> = ({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
}) => {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;

  const go = (target: number) => onPageChange(Math.min(Math.max(1, target), pageCount));

  const stepClass =
    'rounded-lg px-2 py-1 text-sm text-gray-subtext hover:text-white disabled:opacity-30';

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4 text-sm">
      <div className="flex items-center gap-1">
        <button
          type="button"
          className={stepClass}
          onClick={() => go(1)}
          disabled={page <= 1}
          aria-label="First page"
        >
          «
        </button>
        <button
          type="button"
          className={stepClass}
          onClick={() => go(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          ‹
        </button>

        {pageTokens(page, pageCount).map((token, i) =>
          token === 'ellipsis' ? (
            <span key={`e-${i}`} className="px-2 text-gray-subtext" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={token}
              type="button"
              onClick={() => go(token)}
              aria-current={token === page ? 'page' : undefined}
              className={`min-w-[2rem] rounded-lg px-2 py-1 ${
                token === page
                  ? 'bg-primary-blue/20 text-primary-blue font-semibold'
                  : 'text-gray-subtext hover:text-white'
              }`}
            >
              {token}
            </button>
          ),
        )}

        <button
          type="button"
          className={stepClass}
          onClick={() => go(page + 1)}
          disabled={page >= pageCount}
          aria-label="Next page"
        >
          ›
        </button>
        <button
          type="button"
          className={stepClass}
          onClick={() => go(pageCount)}
          disabled={page >= pageCount}
          aria-label="Last page"
        >
          »
        </button>
      </div>

      {onPageSizeChange && (
        <label className="flex items-center gap-2 text-gray-subtext">
          <span>Rows per page</span>
          <select
            value={pageSize}
            onChange={(e) => {
              onPageSizeChange(Number(e.target.value));
              onPageChange(1);
            }}
            className="rounded-lg border border-dark-border bg-dark-elev px-2 py-1 text-white/90"
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      )}
    </nav>
  );
};

export default Pagination;
