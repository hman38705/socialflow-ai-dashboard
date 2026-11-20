export const ADMIN_MIGRATIONS_SET_KEY = 'socialflow:admin:migrations:applied';
export const KNOWN_QUEUES_SET_KEY = 'socialflow:admin:known-queues';

// Migration lock and metadata constants
export const ADMIN_MIGRATIONS_LOCK_KEY = 'socialflow:admin:migrations:lock';
export const ADMIN_MIGRATIONS_METADATA_KEY = 'socialflow:admin:migrations:metadata';
export const MIGRATION_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const MIGRATION_LOCK_RETRY_INTERVAL_MS = 100;
export const MIGRATION_LOCK_MAX_RETRIES = 300; // 30 seconds total with 100ms intervals

// Bounds for admin numeric query/body parameters (limit, batchSize)
export const ADMIN_NUMERIC_MIN = 1;
export const ADMIN_NUMERIC_MAX = 1000;
