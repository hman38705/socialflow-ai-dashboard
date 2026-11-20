export const ADMIN_MIGRATIONS_SET_KEY = 'socialflow:admin:migrations:applied';
export const KNOWN_QUEUES_SET_KEY = 'socialflow:admin:known-queues';

// Migration lock and metadata constants
export const ADMIN_MIGRATIONS_LOCK_KEY = 'socialflow:admin:migrations:lock';
export const ADMIN_MIGRATIONS_METADATA_KEY = 'socialflow:admin:migrations:metadata';
export const MIGRATION_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const MIGRATION_LOCK_RETRY_INTERVAL_MS = 100;
export const MIGRATION_LOCK_MAX_RETRIES = 300; // 30 seconds total with 100ms intervals

// Default number of items an admin list/retry call processes when `limit` is omitted
export const ADMIN_DEFAULT_LIMIT = 100;
