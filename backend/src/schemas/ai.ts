import { z } from 'zod';

/**
 * Zod schema for POST /ai/analyze-image.
 *
 * Security constraints:
 *  - mimeType is allow-listed to prevent arbitrary content-type injection.
 *  - imageData base64 is capped to control token cost and payload size.
 *  - context is capped at 500 chars to limit prompt-injection surface.
 */
export const analyzeImageSchema = z.object({
  imageData: z
    .string()
    .min(1, 'imageData is required')
    .max(26_700_000, 'imageData exceeds the maximum allowed size (20 MB)'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']).default('image/jpeg'),
  context: z.string().max(500, 'context must be 500 characters or fewer').optional(),
});

export type AnalyzeImageInput = z.infer<typeof analyzeImageSchema>;
