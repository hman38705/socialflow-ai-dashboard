// @jest-environment node

// Stub out browser-only APIs before importing the module
const mockIndexedDB = {
  open: jest.fn(),
};
Object.defineProperty(global, 'indexedDB', { value: mockIndexedDB, writable: true });

import {
  IPFSClient,
  DEFAULT_GATEWAYS,
  MB,
  sleep,
  retryWithBackoff,
  timeoutSignal,
} from '../IPFSClient';

describe('IPFSClient', () => {
  describe('constructor / fromEnv', () => {
    it('creates instance with default (web3) provider when no env is set', () => {
      const client = new IPFSClient();
      expect(client.config.provider).toBeDefined();
      expect(client.config.gatewayUrls).toEqual(DEFAULT_GATEWAYS);
    });

    it('accepts explicit config overrides', () => {
      const client = new IPFSClient({ provider: 'pinata', apiKey: 'pk', secret: 'sk' });
      expect(client.config.provider).toBe('pinata');
      expect(client.config.apiKey).toBe('pk');
      expect(client.config.secret).toBe('sk');
    });
  });

  describe('getProviderInfo', () => {
    it('returns web3.storage upload URL for web3 provider', () => {
      const client = new IPFSClient({ provider: 'web3', apiKey: 'token' });
      const info = client.getProviderInfo();
      expect(info.uploadUrl).toContain('web3.storage');
      expect(info.authHeader).toContain('token');
    });

    it('returns pinata upload URL for pinata provider', () => {
      const client = new IPFSClient({ provider: 'pinata', apiKey: 'pk' });
      const info = client.getProviderInfo();
      expect(info.uploadUrl).toContain('pinata');
    });
  });

  describe('getFileUrl', () => {
    it('prepends the first gateway URL to cid', () => {
      const client = new IPFSClient({ gatewayUrls: ['https://gw.example.com/ipfs/'] });
      expect(client.getFileUrl('Qmtest')).toBe('https://gw.example.com/ipfs/Qmtest');
    });

    it('falls back to DEFAULT_GATEWAYS[0] when gatewayUrls is empty', () => {
      const client = new IPFSClient({ gatewayUrls: [] });
      expect(client.getFileUrl('Qmtest')).toBe(DEFAULT_GATEWAYS[0] + 'Qmtest');
    });
  });

  describe('MB constant', () => {
    it('equals 1048576', () => {
      expect(MB).toBe(1048576);
    });
  });

  describe('sleep', () => {
    it('resolves after given ms', async () => {
      jest.useFakeTimers();
      const promise = sleep(100);
      jest.advanceTimersByTime(100);
      await expect(promise).resolves.toBeUndefined();
      jest.useRealTimers();
    });
  });

  describe('retryWithBackoff', () => {
    it('returns value on first success', async () => {
      const fn = jest.fn().mockResolvedValue('ok');
      jest.useFakeTimers();
      const p = retryWithBackoff(fn, 3, 0);
      jest.runAllTimers();
      await expect(p).resolves.toBe('ok');
      jest.useRealTimers();
    });

    it('retries on failure and resolves on eventual success', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('recovered');
      jest.useFakeTimers();
      const p = retryWithBackoff(fn, 3, 0);
      jest.runAllTimers();
      await expect(p).resolves.toBe('recovered');
      jest.useRealTimers();
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws last error after all attempts fail', async () => {
      const err = new Error('always fails');
      const fn = jest.fn().mockRejectedValue(err);
      jest.useFakeTimers();
      const p = retryWithBackoff(fn, 2, 0);
      jest.runAllTimers();
      await expect(p).rejects.toThrow('always fails');
      jest.useRealTimers();
    });
  });

  describe('timeoutSignal', () => {
    it('returns a signal and a clear function', () => {
      jest.useFakeTimers();
      const { signal, clear } = timeoutSignal(5000);
      expect(signal).toBeDefined();
      expect(typeof clear).toBe('function');
      clear();
      jest.useRealTimers();
    });

    it('signal is aborted after timeout', () => {
      jest.useFakeTimers();
      const { signal } = timeoutSignal(100);
      expect(signal.aborted).toBe(false);
      jest.advanceTimersByTime(101);
      expect(signal.aborted).toBe(true);
      jest.useRealTimers();
    });
  });
});
