import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { crumbChain } from '../../config/routes';

// === Component

/**
 * Breadcrumb trail derived from the route metadata registry (`config/routes.ts`). The last
 * crumb is the current page and is not a link.
 */
export const Breadcrumbs: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { pathname } = useLocation();
  const chain = crumbChain(pathname);

  if (chain.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex items-center gap-1 text-xs text-gray-subtext">
        {chain.map((crumb, i) => {
          const isLast = i === chain.length - 1;
          return (
            <li key={crumb.path} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />}
              {isLast ? (
                <span aria-current="page" className="font-medium text-white/90">
                  {crumb.meta.breadcrumb}
                </span>
              ) : (
                <Link to={crumb.path} className="hover:text-white">
                  {crumb.meta.breadcrumb}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

export default Breadcrumbs;
