/**
 * Call this once at app startup to configure the API client.
 *
 * Example:
 *   configureApi({
 *     baseUrl: import.meta.env.VITE_API_URL,
 *   });
 *
 * FE-046: OpenAPI.TOKEN is wired to the in-memory tokenStore so the access
 * token is never read from localStorage/sessionStorage by the API layer.
 *
 * FE-047: when `enableRefreshInterceptor` is true (default) the global
 * `fetch` is wrapped so that 401 responses trigger a single-flight token
 * refresh and then replay the original request once. A second 401 forces
 * logout and redirects to /login.
 */
import { OpenAPI } from './core/OpenAPI';
import { withRefreshInterceptor, scheduleProactiveRefresh } from '../auth/refresh';
import { getToken } from '../auth/tokenStore';

export function configureApi(options: {
  baseUrl?: string;
  /**
   * @deprecated Pass a custom getToken via tokenStore instead.
   * Kept for backwards-compatibility; takes precedence over the tokenStore
   * only when explicitly provided.
   */
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
    // Legacy/test path: caller supplies their own getter.
    OpenAPI.TOKEN = async () => options.getToken?.() ?? '';
  } else {
    // FE-046: default path — resolve the token from the in-memory store.
    OpenAPI.TOKEN = async () => getToken()?.token ?? '';
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

    // Schedule a proactive refresh if a token already exists in the store.
    const entry = getToken();
    if (entry) {
      scheduleProactiveRefresh();
    }
  }
}
