const mockUpdate = jest.fn().mockResolvedValue({});

jest.mock('../lib/prisma', () => ({
  prisma: { webhookDelivery: { update: (...args: unknown[]) => mockUpdate(...args) } },
}));

jest.mock('../lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { attemptDelivery } from '../modules/webhook/services/WebhookDispatcher';

describe('module-tree WebhookDispatcher SSRF guard', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchSpy = jest.spyOn(global, 'fetch' as never).mockResolvedValue({} as never);
  });

  afterEach(() => fetchSpy.mockRestore());

  it.each(['http://169.254.169.254/latest/meta-data', 'http://127.0.0.1/hook', 'https://10.0.0.5/hook'])(
    'blocks %s without making a network call',
    async (url) => {
      await attemptDelivery('d1', url, 'secret', '{}', 1);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
      );
    },
  );
});
