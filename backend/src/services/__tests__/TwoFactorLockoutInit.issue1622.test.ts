const mockSetLockoutStore = jest.fn();

jest.mock('../../lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));
jest.mock('../../../../src/services/twoFactorService', () => ({
  twoFactorService: { setLockoutStore: (...args: unknown[]) => mockSetLockoutStore(...args) },
}));
jest.mock('../TwoFactorLockoutService', () => ({
  redisTwoFactorLockoutStore: { __redis: true },
}));

import { initialize2FaLockoutStore } from '../TwoFactorLockoutInit';
import { redisTwoFactorLockoutStore } from '../TwoFactorLockoutService';

describe('initialize2FaLockoutStore', () => {
  beforeEach(() => mockSetLockoutStore.mockReset());

  it('wires the Redis-backed lockout store', () => {
    initialize2FaLockoutStore();
    expect(mockSetLockoutStore).toHaveBeenCalledTimes(1);
    expect(mockSetLockoutStore.mock.calls[0][0]).toBe(redisTwoFactorLockoutStore);
  });

  it('rethrows when the store cannot be set', () => {
    mockSetLockoutStore.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(() => initialize2FaLockoutStore()).toThrow('boom');
  });
});
