import { Request, Response, NextFunction } from 'express';
import { httpRequestDuration, errorRequestDuration, sliBreachTotal, SLI_BUDGETS, resolveCategory } from '../lib/metrics';
import { createLogger } from '../lib/logger';

const logger = createLogger('sli');

export function sliMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  let headersSentAt: number | undefined;

  const originalWriteHead = res.writeHead.bind(res);
  // @ts-expect-error — overloaded signatures; we forward all args unchanged
  res.writeHead = (...args) => {
    headersSentAt ??= Date.now();
    return originalWriteHead(...args);
  };

  res.on('finish', () => {
    const durationMs = (headersSentAt ?? Date.now()) - start;
    const path = req.route?.path ?? req.path;
    const category = resolveCategory(req.originalUrl);
    const labels = {
      method: req.method,
      route: path,
      status_code: String(res.statusCode),
      category,
    };

    if (res.statusCode >= 500) {
      errorRequestDuration.observe(labels, durationMs);
      return;
    }

    httpRequestDuration.observe(labels, durationMs);

    const budget = SLI_BUDGETS[category];
    if (!budget) return;

    if (durationMs > budget.p99) {
      sliBreachTotal.inc({ category, percentile: 'p99' });
      logger.warn('SLI p99 breach', {
        category,
        durationMs,
        budget: budget.p99,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
      });
    } else if (durationMs > budget.p95) {
      sliBreachTotal.inc({ category, percentile: 'p95' });
      logger.warn('SLI p95 breach', {
        category,
        durationMs,
        budget: budget.p95,
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
      });
    }
  });

  next();
}
