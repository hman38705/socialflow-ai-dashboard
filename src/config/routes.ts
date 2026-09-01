// === Route metadata registry
//
// The single source of truth for per-route titles and breadcrumbs. `App.tsx`, `Sidebar`,
// and `Topbar` read titles from here instead of hard-coding strings.

export interface RouteMeta {
  /** Page title (drives `document.title` and the Topbar heading). */
  title: string;
  /** Label shown for this segment in a breadcrumb trail. */
  breadcrumb: string;
  /** Icon name for nav surfaces (mapped to a component by the consumer). */
  icon?: string;
  requiresAuth: boolean;
}

export const routeMeta: Record<string, RouteMeta> = {
  '/': { title: 'Dashboard', breadcrumb: 'Dashboard', icon: 'home', requiresAuth: true },
  '/analytics': {
    title: 'Analytics',
    breadcrumb: 'Analytics',
    icon: 'bar-chart',
    requiresAuth: true,
  },
  '/scheduler': {
    title: 'Scheduler',
    breadcrumb: 'Scheduler',
    icon: 'calendar',
    requiresAuth: true,
  },
  '/predictor': {
    title: 'Predictor',
    breadcrumb: 'Predictor',
    icon: 'sparkles',
    requiresAuth: true,
  },
  '/search': { title: 'Search', breadcrumb: 'Search', icon: 'search', requiresAuth: true },
  '/settings': { title: 'Settings', breadcrumb: 'Settings', icon: 'settings', requiresAuth: true },
  '/settings/profile': { title: 'Profile', breadcrumb: 'Profile', requiresAuth: true },
  '/settings/security': { title: 'Security', breadcrumb: 'Security', requiresAuth: true },
  '/settings/organization': {
    title: 'Organization',
    breadcrumb: 'Organization',
    requiresAuth: true,
  },
  '/settings/billing': { title: 'Billing', breadcrumb: 'Billing', requiresAuth: true },
  '/settings/webhooks': { title: 'Webhooks', breadcrumb: 'Webhooks', requiresAuth: true },
  '/settings/schedule': { title: 'Schedule', breadcrumb: 'Schedule', requiresAuth: true },
  '/settings/notifications': {
    title: 'Notifications',
    breadcrumb: 'Notifications',
    requiresAuth: true,
  },
};

// === Lookups

/** Exact match, then the longest registered prefix of `pathname`. */
export function metaForPath(pathname: string): RouteMeta | undefined {
  if (routeMeta[pathname]) return routeMeta[pathname];
  const prefixes = Object.keys(routeMeta)
    .filter((p) => p !== '/' && pathname.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length);
  return prefixes[0] ? routeMeta[prefixes[0]] : undefined;
}

/** Title for `pathname`, falling back to "Dashboard" for unregistered routes. */
export function titleForPath(pathname: string): string {
  return metaForPath(pathname)?.title ?? 'Dashboard';
}

export interface Crumb {
  path: string;
  meta: RouteMeta;
}

/**
 * The breadcrumb chain for `pathname`: every registered ancestor path (built up segment by
 * segment) in order, ending with the current route. Unregistered intermediate segments are
 * skipped rather than shown without a label.
 */
export function crumbChain(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  const chain: Crumb[] = [];
  let acc = '';
  for (const segment of segments) {
    acc += `/${segment}`;
    const meta = routeMeta[acc];
    if (meta) chain.push({ path: acc, meta });
  }
  return chain;
}
