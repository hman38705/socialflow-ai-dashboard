import express from 'express';
import request from 'supertest';

jest.mock('../../../models/Role', () => {
  const actual = jest.requireActual('../../../models/Role');
  return {
    ...actual,
    RoleStore: {
      assign: jest.fn(),
      getRole: jest.fn(),
      getRoleName: jest.fn(),
      hasPermission: jest.fn(),
      listAll: jest.fn(),
    },
  };
});

jest.mock('../../../middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: req.header('x-test-user') || 'caller' };
    next();
  },
}));

import { RoleStore } from '../../../models/Role';
import rolesRouter from '../routes.roles';

const mockedRoleStore = RoleStore as jest.Mocked<typeof RoleStore>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/roles', rolesRouter);
  return app;
}

describe('organization routes.roles', () => {
  let app: express.Express;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
  });

  describe('permission checks', () => {
    it('allows an admin caller to assign a role', async () => {
      mockedRoleStore.hasPermission.mockResolvedValue(true);
      mockedRoleStore.assign.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/roles/assign')
        .set('x-test-user', 'admin-user')
        .send({ userId: 'target-user', role: 'editor' });

      expect(res.status).toBeLessThan(400);
      expect(mockedRoleStore.hasPermission).toHaveBeenCalledWith('admin-user', 'roles:manage');
      expect(mockedRoleStore.assign).toHaveBeenCalledWith('target-user', 'editor');
    });

    it('denies a non-admin caller without roles:manage', async () => {
      mockedRoleStore.hasPermission.mockResolvedValue(false);

      const res = await request(app)
        .post('/roles/assign')
        .set('x-test-user', 'viewer-user')
        .send({ userId: 'target-user', role: 'editor' });

      expect(res.status).toBe(403);
      expect(mockedRoleStore.assign).not.toHaveBeenCalled();
    });
  });

  describe('privilege escalation guards', () => {
    it('rejects a self-role-escalation attempt', async () => {
      mockedRoleStore.hasPermission.mockResolvedValue(true);

      const res = await request(app)
        .post('/roles/assign')
        .set('x-test-user', 'editor-user')
        .send({ userId: 'editor-user', role: 'admin' });

      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(mockedRoleStore.assign).not.toHaveBeenCalled();
    });

    it('rejects removing the last owner', async () => {
      mockedRoleStore.hasPermission.mockResolvedValue(true);
      mockedRoleStore.listAll.mockResolvedValue([{ userId: 'owner-user', role: 'admin' }]);

      const res = await request(app)
        .delete('/roles/owner-user')
        .set('x-test-user', 'admin-user');

      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });
});
