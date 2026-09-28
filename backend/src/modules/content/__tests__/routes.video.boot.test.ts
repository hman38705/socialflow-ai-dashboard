/**
 * Boot test for the content video routes module.
 *
 * Regression guard for issue #1564: `backend/src/modules/content/routes.video.ts`
 * previously contained broken relative imports (`'../queues/VideoQueue'` and
 * `'../services/VideoHealthService'`) that resolved to non-existent files and
 * caused a hard `Cannot find module` error at `require()`-time, crashing the
 * app on boot via `registerModules(app)`.
 *
 * This test imports `../app` and asserts it loads without throwing, and that
 * the video routes module itself can be required directly.
 */

describe('content video routes boot', () => {
  it('loads ../app without throwing', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../../../app');
    }).not.toThrow();
  });

  it('requires the content video routes module without throwing', () => {
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../routes.video');
    }).not.toThrow();
  });
});
