import { z } from 'zod';
import { ADMIN_NUMERIC_MAX, ADMIN_NUMERIC_MIN } from './constants';

/** Shared schema for admin numeric query/body parameters (e.g. limit, batchSize). */
export const adminNumericSchema = z.coerce
  .number()
  .int()
  .min(ADMIN_NUMERIC_MIN)
  .max(ADMIN_NUMERIC_MAX);
