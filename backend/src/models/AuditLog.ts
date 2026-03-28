/**
 * AuditLog model — in-memory store (swap for DB in production).
 *
 * Every entry captures: who did it, what they did, when, and optional metadata.
 */

export type AuditAction =
  // Auth
  | 'auth:register'
  | 'auth:login'
  | 'auth:logout'
  // Posts
  | 'post:create'
  | 'post:update'
  | 'post:delete'
  | 'post:publish'
  // Organization / settings
  | 'org:settings:update'
  | 'org:member:invite'
  | 'org:member:remove'
  // Roles
  | 'role:assign'
  | 'role:revoke'
  // Billing
  | 'billing:provision'
  | 'billing:upgrade'
  | 'billing:cancel'
  // AI
  | 'ai:generate'
  | 'ai:analyze'
  // Health
  | 'health:config:update';

export interface AuditLog {
  id: string;
  actorId: string; // userId who performed the action
  action: AuditAction;
  resourceType?: string; // e.g. "post", "user", "organization"
  resourceId?: string; // ID of the affected resource
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

// ── In-memory store ───────────────────────────────────────────────────────────

const logs: AuditLog[] = [];
let counter = 0;

export const AuditLogStore = {
  append: (entry: Omit<AuditLog, 'id' | 'createdAt'>): AuditLog => {
    const log: AuditLog = { ...entry, id: String(++counter), createdAt: new Date() };
    logs.push(log);
    return log;
  },

  forActor: (actorId: string, limit = 100): AuditLog[] =>
    logs
      .filter((l) => l.actorId === actorId)
      .slice(-limit)
      .reverse(),

  forResource: (resourceType: string, resourceId: string): AuditLog[] =>
    logs.filter((l) => l.resourceType === resourceType && l.resourceId === resourceId).reverse(),

  recent: (limit = 200): AuditLog[] => logs.slice(-limit).reverse(),
};
