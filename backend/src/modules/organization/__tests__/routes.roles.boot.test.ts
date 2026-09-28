import request from 'supertest';

// Boot test for issue #1563: ensures the app (and therefore the organization
// roles router) loads without throwing a `Cannot find module` error from
// broken relative imports in modules/organization/routes.roles.ts.
describe('organization roles module boot', () => {
  it('loads ../app without throwing for the organization roles module', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../../app');
    }).not.toThrow();
  });

  it('resolves the organization roles router module', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../routes.roles');
    }).not.toThrow();
  });

  it('exposes an express app that responds to requests', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const app = require('../../app').default || require('../../app');
    const res = await request(app).get('/health');
    expect(res.status).toBeLessThan(500);
  });
});
