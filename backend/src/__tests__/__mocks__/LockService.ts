export const LockService = {
  withLock: async <T>(_key: string, fn: () => Promise<T> | T): Promise<T> => fn(),
};
