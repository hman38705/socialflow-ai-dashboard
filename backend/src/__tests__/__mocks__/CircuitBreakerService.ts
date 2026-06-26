export const circuitBreakerService = {
  execute: async <T>(
    _name: string,
    fn: () => Promise<T> | T,
    fallback?: () => Promise<T> | T,
  ): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (fallback) return await fallback();
      return Promise.reject(error);
    }
  },
  getStats: (): Record<string, unknown> => ({}),
};
