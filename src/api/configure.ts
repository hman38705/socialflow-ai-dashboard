/**
 * Call this once at app startup to configure the API client.
 *
 * Example:
 *   configureApi({
 *     baseUrl: import.meta.env.VITE_API_URL,
 *     getToken: () => localStorage.getItem('accessToken') ?? undefined,
 *   });
 *
 * FE-047: when `enableRefreshInterceptor` is true (default) the global
 * `fetch` is wrapped so that 401 responses trigger a single-flight token
 * refresh and then replay the original request once. A second 401 forces
 * logout and redirects to /login.
 */
import { OpenAPI } from './core/OpenAPI';
import { withRefreshInterceptor, scheduleProactiveRefresh, getAccessToken } from '../auth/refresh';

export function configureApi(options: {
  baseUrl?: string;
  getToken?: () => string | undefined;
  /**
   * Install the 401-refresh interceptor on globalThis.fetch.
   * Pass `false` only in tests that want raw fetch behaviour.
   * Defaults to `true`.
   */
  enableRefreshInterceptor?: boolean;
}) {
  if (options.baseUrl) {
    OpenAPI.BASE = options.baseUrl;
  }
  if (options.getToken) {
    OpenAPI.TOKEN = async () => options.getToken?.() ?? '';
  }

  // Wire the refresh interceptor unless explicitly disabled.
  if (options.enableRefreshInterceptor !== false) {
    // Avoid double-wrapping if configureApi is called more than once.
    if (!(globalThis.fetch as unknown as { __refreshWrapped?: boolean }).__refreshWrapped) {
      const originalFetch = globalThis.fetch.bind(globalThis);
      const wrapped = withRefreshInterceptor(originalFetch) as typeof globalThis.fetch & {
        __refreshWrapped: boolean;
      };
      wrapped.__refreshWrapped = true;
      globalThis.fetch = wrapped;
    }

    // Schedule a proactive refresh if a token already exists in storage.
    const token = getAccessToken();
    if (token) {
      scheduleProactiveRefresh();
    }
  }
}
