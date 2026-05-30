import { Request, Response, NextFunction } from 'express';

const passThrough = (_req: Request, _res: Response, next: NextFunction) => next();

export const authLimiter = passThrough;
export const aiLimiter = passThrough;
export const generalLimiter = passThrough;
export const initRateLimiters = async (): Promise<void> => {};
export const resetLimiters = (): void => {};
