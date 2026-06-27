// @jest-environment node

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('../IPFSClient', () => {
  const actual = jest.requireActual('../IPFSClient');
  return {
    ...actual,
    idbGet: jest.fn().mockResolvedValue(null),
    idbPut: jest.fn().mockResolvedValue(undefined),
    idbAll: jest.fn().mockResolvedValue([]),
    idbDelete: jest.fn().mockResolvedValue(undefined),
    openDb: jest.fn().mockResolvedValue({
      transaction: jest.fn().mockReturnValue({
        objectStore: jest.fn().mockReturnValue({ clear: jest.fn() }),
        oncomplete: null,
        onerror: null,
      }),
    }),
    timeoutSignal: jest.fn().mockReturnValue({
      signal: { aborted: false },
      clear: jest.fn(),
    }),
  };
});

import { IPFSRetriever } from '../IPFSRetriever';
import { IPFSClient } from '../IPFSClient';
import { idbGet, idbPut, idbAll } from '../IPFSClient';

function makeClient() {
  return new IPFSClient({ provider: 'web3', apiKey: 'tok', gatewayUrls: ['https://ipfs.io/ipfs/'] });
}

function blobResponse(content = 'file-data', ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 404,
    blob: () => Promise.resolve(new Blob([content])),
    text: () => Promise.resolve(JSON.stringify({ key: 'value' })),
  } as any);
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('IPFSRetriever', () => {
  describe('getFile', () => {
    it('fetches from gateway and returns a Blob', async () => {
      (idbGet as jest.Mock).mockResolvedValueOnce(null);
      mockFetch.mockReturnValueOnce(blobResponse('hello'));
      const retriever = new IPFSRetriever(makeClient());
      const blob = await retriever.getFile('QmTest');
      expect(blob).toBeInstanceOf(Blob);
    });

    it('returns cached file when present in idb', async () => {
      (idbGet as jest.Mock).mockResolvedValueOnce({
        cid: 'QmCached',
        data: new Uint8Array([1, 2, 3]).buffer,
        lastAccess: Date.now(),
      });
      const retriever = new IPFSRetriever(makeClient());
      const blob = await retriever.getFile('QmCached');
      expect(blob).toBeInstanceOf(Blob);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when all gateways fail', async () => {
      (idbGet as jest.Mock).mockResolvedValueOnce(null);
      mockFetch.mockRejectedValue(new Error('network error'));
      const retriever = new IPFSRetriever(makeClient());
      await expect(retriever.getFile('QmBad')).rejects.toThrow();
    });
  });

  describe('getJSON', () => {
    it('parses and returns valid JSON from gateway', async () => {
      mockFetch.mockReturnValueOnce(Promise.resolve({
        ok: true,
        text: () => Promise.resolve('{"foo":"bar"}'),
      } as any));
      const retriever = new IPFSRetriever(makeClient());
      const result = await retriever.getJSON('QmJsonCid');
      expect(result).toEqual({ foo: 'bar' });
    });

    it('throws AppError for malformed JSON', async () => {
      mockFetch.mockReturnValueOnce(Promise.resolve({
        ok: true,
        text: () => Promise.resolve('not-json'),
      } as any));
      const retriever = new IPFSRetriever(makeClient());
      await expect(retriever.getJSON('QmBadJson')).rejects.toThrow();
    });
  });

  describe('getCacheSize', () => {
    it('sums size field from all idb entries', async () => {
      (idbAll as jest.Mock).mockResolvedValueOnce([{ cid: 'a', size: 500 }, { cid: 'b', size: 300 }]);
      const retriever = new IPFSRetriever(makeClient());
      expect(await retriever.getCacheSize()).toBe(800);
    });
  });

  describe('unpinFile', () => {
    it('returns true for web3 provider without network call', async () => {
      const retriever = new IPFSRetriever(makeClient());
      const result = await retriever.unpinFile('QmWeb3Cid');
      expect(result).toBe(true);
    });

    it('calls DELETE for pinata and returns true on success', async () => {
      mockFetch.mockReturnValueOnce(Promise.resolve({ ok: true } as any));
      const client = new IPFSClient({ provider: 'pinata', apiKey: 'pk', secret: 'sk', gatewayUrls: ['https://ipfs.io/ipfs/'] });
      const retriever = new IPFSRetriever(client);
      const result = await retriever.unpinFile('QmPinataCid');
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('QmPinataCid'), expect.objectContaining({ method: 'DELETE' }));
    });

    it('throws AppError when pinata unpin fails', async () => {
      mockFetch.mockReturnValueOnce(Promise.resolve({ ok: false, status: 500 } as any));
      const client = new IPFSClient({ provider: 'pinata', apiKey: 'pk', secret: 'sk', gatewayUrls: ['https://ipfs.io/ipfs/'] });
      const retriever = new IPFSRetriever(client);
      await expect(retriever.unpinFile('QmBad')).rejects.toThrow();
    });
  });
});
