// @jest-environment node

const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock IndexedDB helpers used internally
jest.mock('../IPFSClient', () => {
  const actual = jest.requireActual('../IPFSClient');
  return {
    ...actual,
    idbPut: jest.fn().mockResolvedValue(undefined),
    idbAll: jest.fn().mockResolvedValue([]),
    retryWithBackoff: jest.fn().mockImplementation((fn: () => Promise<any>) => fn()),
  };
});

import { IPFSUploader } from '../IPFSUploader';
import { IPFSClient } from '../IPFSClient';

function makeClient(provider: 'web3' | 'pinata' = 'web3', apiKey = 'token', secret?: string) {
  return new IPFSClient({ provider, apiKey, secret, gatewayUrls: ['https://ipfs.io/ipfs/'] });
}

function jsonReply(body: object, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as any);
}

function makeFile(name = 'test.txt', content = 'data', type = 'text/plain') {
  return new File([content], name, { type });
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('IPFSUploader', () => {
  describe('uploadFile (web3)', () => {
    it('returns cid and gatewayUrl on success', async () => {
      mockFetch.mockReturnValue(jsonReply({ cid: 'QmTest123' }));
      const client = makeClient('web3');
      const uploader = new IPFSUploader(client);
      const result = await uploader.uploadFile(makeFile());
      expect(result.cid).toBe('QmTest123');
      expect(result.gatewayUrl).toContain('QmTest123');
    });

    it('throws AppError when response is not ok', async () => {
      mockFetch.mockReturnValue(jsonReply({}, false));
      const client = makeClient('web3');
      const uploader = new IPFSUploader(client);
      await expect(uploader.uploadFile(makeFile())).rejects.toThrow();
    });
  });

  describe('uploadFile (pinata)', () => {
    it('returns cid from IpfsHash on success', async () => {
      mockFetch.mockReturnValue(jsonReply({ IpfsHash: 'QmPinata' }));
      const client = makeClient('pinata', 'pk', 'sk');
      const uploader = new IPFSUploader(client);
      const result = await uploader.uploadFile(makeFile());
      expect(result.cid).toBe('QmPinata');
    });
  });

  describe('uploadJSON', () => {
    it('rejects non-object metadata', async () => {
      const uploader = new IPFSUploader(makeClient());
      await expect(uploader.uploadJSON(null)).rejects.toThrow();
    });

    it('returns cid and uri for valid metadata (web3)', async () => {
      mockFetch.mockReturnValue(jsonReply({ cid: 'QmJSON' }));
      const uploader = new IPFSUploader(makeClient('web3', 'tok'));
      const result = await uploader.uploadJSON({ name: 'test' });
      expect(result.cid).toBe('QmJSON');
      expect(result.uri).toBe('ipfs://QmJSON');
    });

    it('throws when response not ok (JSON upload)', async () => {
      mockFetch.mockReturnValue(Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as any));
      const uploader = new IPFSUploader(makeClient('web3', 'tok'));
      await expect(uploader.uploadJSON({ name: 'test' })).rejects.toThrow();
    });
  });

  describe('uploadBatch', () => {
    it('returns results array of same length as input', async () => {
      mockFetch.mockReturnValue(jsonReply({ cid: 'QmBatch' }));
      const uploader = new IPFSUploader(makeClient());
      const files = [makeFile('a.txt'), makeFile('b.txt'), makeFile('c.txt')];
      const results = await uploader.uploadBatch(files);
      expect(results).toHaveLength(3);
    });

    it('sets empty cid for failed individual uploads', async () => {
      mockFetch.mockReturnValue(Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) } as any));
      const uploader = new IPFSUploader(makeClient());
      const results = await uploader.uploadBatch([makeFile()]);
      expect(results[0].cid).toBe('');
    });

    it('calls onProgress for each completed file', async () => {
      mockFetch.mockReturnValue(jsonReply({ cid: 'QmProg' }));
      const uploader = new IPFSUploader(makeClient());
      const onProgress = jest.fn();
      await uploader.uploadBatch([makeFile(), makeFile()], onProgress);
      expect(onProgress).toHaveBeenCalledTimes(2);
    });
  });

  describe('pinFile', () => {
    it('returns true for web3 provider (no network call)', async () => {
      const uploader = new IPFSUploader(makeClient('web3'));
      const result = await uploader.pinFile('QmSomeCid');
      expect(result).toBe(true);
    });

    it('returns true for pinata on successful pin', async () => {
      mockFetch.mockReturnValue(jsonReply({ ok: true }));
      const uploader = new IPFSUploader(makeClient('pinata', 'pk', 'sk'));
      const result = await uploader.pinFile('QmPinataCid');
      expect(result).toBe(true);
    });

    it('throws AppError when pinata pin request fails', async () => {
      mockFetch.mockReturnValue(Promise.resolve({ ok: false, status: 500 } as any));
      const uploader = new IPFSUploader(makeClient('pinata', 'pk', 'sk'));
      await expect(uploader.pinFile('QmBad')).rejects.toThrow();
    });
  });
});
