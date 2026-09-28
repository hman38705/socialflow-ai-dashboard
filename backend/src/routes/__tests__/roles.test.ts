import express from 'express';
import request from 'supertest';

const auditMock = jest.fn((_req: any, _res: any, next: any) => next());

jest.mock('../../middleware/audit', () => ({
  audit: (...args: any[]) => auditMock(...args),
}));

const rolesMock = {
  ADMIN: 'ADMIN',
  USER: 'USER',
};

const permissionsMock = {
  MANAGE_ROLES: 'MANAGE_ROLES',
};

const roleStoreMock = {
  assignRole: jest.fn(),
};

const userStoreMock = {
  findById: jest.fn(),
};

jest.mock('../../config/roles', () => ({
  ROLES: rolesMock,
  PERMISSIONS: permissionsMock,
  RoleStore: roleStoreMock,
  UserStore: userStoreMock,
}));

import rolesRouter from '../roles';

function buildApp(user?: any) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = user;
    next();
  });
  app.use('/roles', rolesRouter);
  return app;
}

describe('routes/roles', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('assigns a role when the caller has permission', async () => {
    userStoreMock.findById.mockResolvedValue({ id: 'user-1' });
    roleStoreMock.assignRole.mockResolvedValue({ id: 'user-1', role: 'ADMIN' });

    const app = buildApp({ id: 'admin-1', permissions: ['MANAGE_ROLES'] });
    const res = await request(app)
      .post('/roles/assign')
      .send({ userId: 'user-1', role: 'ADMIN' });

    expect(res.status).toBeLessThan(400);
    expect(roleStoreMock.assignRole).toHaveBeenCalledWith('user-1', 'ADMIN');
  });

  it('rejects the request when the caller lacks permission', async () => {
    const app = buildApp({ id: 'user-2', permissions: [] });
    const res = await request(app)
      .post('/roles/assign')
      .send({ userId: 'user-1', role: 'ADMIN' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(roleStoreMock.assignRole).not.toHaveBeenCalled();
  });

  it('records an audit entry on a successful role change', async () => {
    userStoreMock.findById.mockResolvedValue({ id: 'user-1' });
    roleStoreMock.assignRole.mockResolvedValue({ id: 'user-1', role: 'ADMIN' });

    const app = buildApp({ id: 'admin-1', permissions: ['MANAGE_ROLES'] });
    await request(app)
      .post('/roles/assign')
      .send({ userId: 'user-1', role: 'ADMIN' });

    expect(auditMock).toHaveBeenCalled();
  });
});
