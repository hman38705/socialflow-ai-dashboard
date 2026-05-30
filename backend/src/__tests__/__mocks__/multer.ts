import { Request, Response, NextFunction } from 'express';

type MulterHandler = (req: Request, res: Response, next: NextFunction) => void;

function multer() {
  const handler = (_req: Request, _res: Response, next: NextFunction) => next();
  const single = () => handler;
  const array = () => handler;
  const fields = () => handler;
  return { single, array, fields };
}

multer.memoryStorage = () => ({});
export default multer;
