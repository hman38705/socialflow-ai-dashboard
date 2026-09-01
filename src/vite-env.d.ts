/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the backend API. Required — see src/config/env.ts. */
  readonly VITE_API_URL: string;
  /** WebSocket URL for real-time updates. Required — see src/config/env.ts. */
  readonly VITE_WS_URL: string;
  /** Sentry DSN for error tracking. Optional — unset disables Sentry. */
  readonly VITE_SENTRY_DSN?: string;
  /** Stripe publishable key. Optional — unset disables billing UI. */
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
  /** Enables the AI Predictor feature (FE-098). Defaults to disabled. */
  readonly VITE_FEATURE_PREDICTIVE?: string;
  readonly VITE_STRIPE_PRICE_STARTER?: string;
  readonly VITE_STRIPE_PRICE_PRO?: string;
  readonly VITE_STRIPE_PRICE_ENTERPRISE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
