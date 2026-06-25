import { getMeiliClient } from '../../lib/meilisearch';
import { deletePost, indexPost, initSearchIndex, searchPosts } from '../SearchService';

jest.mock('../../lib/meilisearch', () => ({
  getMeiliClient: jest.fn(),
}));

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
  }),
}));

describe('SearchService', () => {
  const mockedGetMeiliClient = getMeiliClient as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes the posts index and settings on first use', async () => {
    const updateSettings = jest.fn().mockResolvedValue(undefined);
    const index = jest.fn().mockReturnValue({ updateSettings });
    const createIndex = jest.fn().mockRejectedValue({ code: 'index_already_exists' });
    mockedGetMeiliClient.mockReturnValue({ createIndex, index });

    await initSearchIndex();

    expect(createIndex).toHaveBeenCalledWith('posts', { primaryKey: 'id' });
    expect(index).toHaveBeenCalledWith('posts');
    expect(updateSettings).toHaveBeenCalledWith({
      searchableAttributes: ['content', 'platform'],
      filterableAttributes: ['organizationId', 'platform', 'scheduledAt'],
      sortableAttributes: ['createdAt', 'scheduledAt'],
    });
  });

  it('indexes a single post document through the posts index', async () => {
    const addDocuments = jest.fn().mockResolvedValue(undefined);
    const index = jest.fn().mockReturnValue({ addDocuments });
    mockedGetMeiliClient.mockReturnValue({ index } as any);

    await indexPost({
      id: 'post-1',
      organizationId: 'org-1',
      content: 'hello world',
      platform: 'instagram',
      scheduledAt: null,
      createdAt: '2024-01-01T00:00:00.000Z',
    });

    expect(index).toHaveBeenCalledWith('posts');
    expect(addDocuments).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'post-1' }),
    ]);
  });

  it('deletes a document from the posts index', async () => {
    const deleteDocument = jest.fn().mockResolvedValue(undefined);
    const index = jest.fn().mockReturnValue({ deleteDocument });
    mockedGetMeiliClient.mockReturnValue({ index } as any);

    await deletePost('post-1');

    expect(index).toHaveBeenCalledWith('posts');
    expect(deleteDocument).toHaveBeenCalledWith('post-1');
  });

  it('validates organization scoping and forwards the search parameters', async () => {
    const search = jest.fn().mockResolvedValue({ hits: [] });
    const index = jest.fn().mockReturnValue({ search });
    mockedGetMeiliClient.mockReturnValue({ index } as any);

    await expect(
      searchPosts('summer', {
        organizationId: 'not-a-uuid',
        platform: 'instagram',
      }),
    ).rejects.toThrow('Invalid organizationId');

    await searchPosts('summer', {
      organizationId: '123e4567-e89b-12d3-a456-426614174000',
      platform: 'instagram',
      limit: 7,
      offset: 3,
    });

    expect(search).toHaveBeenCalledWith('summer', {
      filter: ['organizationId = "123e4567-e89b-12d3-a456-426614174000"', 'platform = "instagram"'],
      limit: 7,
      offset: 3,
    });
  });
});
