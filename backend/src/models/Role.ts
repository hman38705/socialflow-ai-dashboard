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

// In-memory user→role assignments (replace with DB in production)
const userRoles = new Map<string, RoleName>();

export const RoleStore = {
  assign: (userId: string, role: RoleName): void => {
    userRoles.set(userId, role);
  },

  getRole: (userId: string): Role | undefined => {
    const name = userRoles.get(userId);
    return name ? ROLES[name] : undefined;
  },

  getRoleName: (userId: string): RoleName | undefined => userRoles.get(userId),

  hasPermission: (userId: string, permission: Permission): boolean => {
    const role = RoleStore.getRole(userId);
    return role?.permissions.includes(permission) ?? false;
  },

  listAll: (): Array<{ userId: string; role: RoleName }> =>
    [...userRoles.entries()].map(([userId, role]) => ({ userId, role })),
};
