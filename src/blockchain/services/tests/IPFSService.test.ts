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
    openDb: jest.fn().mockResolvedValue({}),
    timeoutSignal: jest.fn().mockReturnValue({ signal: { aborted: false }, clear: jest.fn() }),
    retryWithBackoff: jest.fn().mockImplementation((fn: () => Promise<any>) => fn()),
  };
});

import { IPFSService } from '../IPFSService';

function jsonReply(body: object, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    blob: () => Promise.resolve(new Blob([JSON.stringify(body)])),
  } as any);
}

afterEach(() => jest.clearAllMocks());

describe('IPFSService', () => {
  describe('constructor', () => {
    it('creates an instance', () => {
      const svc = new IPFSService({ provider: 'web3', apiKey: 'tok', gatewayUrls: ['https://ipfs.io/ipfs/'] });
      expect(svc).toBeInstanceOf(IPFSService);
    });

    it('exposes config from underlying client', () => {
      const svc = new IPFSService({ provider: 'pinata', apiKey: 'pk', gatewayUrls: [] });
      expect(svc.config.provider).toBe('pinata');
    });
  });

  describe('fromEnv', () => {
    it('returns an IPFSConfig object', () => {
      const config = IPFSService.fromEnv();
      expect(config).toHaveProperty('provider');
      expect(config).toHaveProperty('gatewayUrls');
    });
  });

  describe('getFileUrl', () => {
    it('builds url from gateway and cid', () => {
      const svc = new IPFSService({ provider: 'web3', apiKey: 'tok', gatewayUrls: ['https://gw.test/ipfs/'] });
      expect(svc.getFileUrl('QmXYZ')).toBe('https://gw.test/ipfs/QmXYZ');
    });
  });

  describe('uploadJSON', () => {
    it('returns cid and uri on success', async () => {
      mockFetch.mockReturnValueOnce(jsonReply({ cid: 'QmSvc' }));
      const svc = new IPFSService({ provider: 'web3', apiKey: 'tok', gatewayUrls: ['https://ipfs.io/ipfs/'] });
      const result = await svc.uploadJSON({ name: 'nft' });
      expect(result.cid).toBe('QmSvc');
      expect(result.uri).toBe('ipfs://QmSvc');
    });
  });

  describe('pinFile / getPinnedFiles', () => {
    it('pinFile returns true for web3', async () => {
      const svc = new IPFSService({ provider: 'web3', apiKey: 'tok', gatewayUrls: [] });
      expect(await svc.pinFile('QmPin')).toBe(true);
    });

    it('getPinnedFiles returns local and remote entries', async () => {
      mockFetch.mockReturnValueOnce(jsonReply([]));
      const svc = new IPFSService({ provider: 'web3', apiKey: 'tok', gatewayUrls: ['https://ipfs.io/ipfs/'] });
      const { local, remote } = await svc.getPinnedFiles();
      expect(Array.isArray(local)).toBe(true);
      expect(Array.isArray(remote)).toBe(true);
    });
  });

  describe('getCacheSize / clearCache', () => {
    it('getCacheSize returns 0 when empty', async () => {
      const svc = new IPFSService({ provider: 'web3', apiKey: 'tok', gatewayUrls: [] });
      expect(await svc.getCacheSize()).toBe(0);
    });
  });
});
