import { prisma } from '../lib/prisma';

/**
 * All granular permissions in the system.
 * Format: resource:action
 */
export const PERMISSIONS = [
  'posts:create',
  'posts:read',
  'posts:update',
  'posts:delete',
  'analytics:view',
  'analytics:export',
  'users:read',
  'users:manage',
  'roles:manage',
  'settings:manage',
  'health:config:update',
  'migrations:force',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type RoleName = 'admin' | 'editor' | 'viewer';

export interface Role {
  name: RoleName;
  permissions: Permission[];
}

export const ROLES: Record<RoleName, Role> = {
  admin: {
    name: 'admin',
    permissions: [...PERMISSIONS],
  },
  editor: {
    name: 'editor',
    permissions: ['posts:create', 'posts:read', 'posts:update', 'analytics:view'],
  },
  viewer: {
    name: 'viewer',
    permissions: ['posts:read', 'analytics:view'],
  },
};

/**
 * User→role assignments, persisted in Postgres via the `RoleAssignment`
 * table. Durable across restarts and shared across all replicas — unlike a
 * process-local Map, every pod reads/writes the same row for a given user.
 */
export const RoleStore = {
  assign: async (userId: string, role: RoleName): Promise<void> => {
    await prisma.roleAssignment.upsert({
      where: { userId },
      create: { userId, role },
      update: { role },
    });
  },

  getRole: async (userId: string): Promise<Role | undefined> => {
    const name = await RoleStore.getRoleName(userId);
    return name ? ROLES[name] : undefined;
  },

  getRoleName: async (userId: string): Promise<RoleName | undefined> => {
    const assignment = await prisma.roleAssignment.findUnique({ where: { userId } });
    return (assignment?.role as RoleName | undefined) ?? undefined;
  },

  hasPermission: async (userId: string, permission: Permission): Promise<boolean> => {
    const role = await RoleStore.getRole(userId);
    return role?.permissions.includes(permission) ?? false;
  },

  listAll: async (): Promise<Array<{ userId: string; role: RoleName }>> => {
    const assignments: Array<{ userId: string; role: string }> = await prisma.roleAssignment.findMany();
    return assignments.map((a) => ({ userId: a.userId, role: a.role as RoleName }));
  },
};
