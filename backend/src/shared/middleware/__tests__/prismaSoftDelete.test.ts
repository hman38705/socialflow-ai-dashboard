import { createLogger } from '../../../lib/logger';
import { prismaSoftDelete } from '../prismaSoftDelete';

jest.mock('../../../lib/logger', () => ({
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  })),
}));

describe('prismaSoftDelete search-index cleanup logging', () => {
  const loggerError = jest.fn();
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    jest.clearAllMocks();
    (createLogger as jest.Mock).mockReturnValue({
      error: loggerError,
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    });
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('logs via the structured logger (not console) when Meilisearch removal rejects', async () => {
    const removeFromSearchIndex = jest.fn().mockRejectedValue(new Error('meili down'));

    await prismaSoftDelete({
      model: 'Post',
      ids: ['post-1'],
      removeFromSearchIndex,
    });

    expect(removeFromSearchIndex).toHaveBeenCalledWith(['post-1']);
    expect(loggerError).toHaveBeenCalledWith(
      'Failed to remove post(s) from search index',
      expect.objectContaining({ error: expect.any(Error) }),
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
