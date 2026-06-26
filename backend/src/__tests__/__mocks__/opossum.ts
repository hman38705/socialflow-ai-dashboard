export default class CircuitBreaker<T extends (...args: unknown[]) => unknown> {
  private _fn: T;
  private _fallback?: (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> | ReturnType<T>;

  constructor(fn: T, _opts?: unknown) {
    this._fn = fn;
  }

  async fire(...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> {
    return this._fn(...args);
  }

  fallback(fn: (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> | ReturnType<T>) {
    this._fallback = fn;
    return this;
  }

  on() {
    return this;
  }
}
