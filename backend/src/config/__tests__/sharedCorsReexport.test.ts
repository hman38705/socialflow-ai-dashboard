import * as canonical from '../cors';
import * as shared from '../../shared';
import * as sharedCors from '../../shared/config/cors';

describe('shared CORS re-export', () => {
  it('shared barrel exposes the canonical corsOptions (reference-equal)', () => {
    expect(shared.corsOptions).toBe(canonical.corsOptions);
  });

  it('shared/config/cors re-exports the canonical config', () => {
    expect(sharedCors.corsOptions).toBe(canonical.corsOptions);
    expect(sharedCors.allowedOrigins).toBe(canonical.allowedOrigins);
  });
});
