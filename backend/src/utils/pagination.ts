import { Request } from 'express';
import { z } from 'zod';

// ── Schemas ───────────────────────────────────────────────────────────────────

export const pageLimitSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const cursorSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PageLimitParams {
  page: number;
  limit: number;
}

export interface CursorParams {
  cursor?: string;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PageMeta | CursorMeta;
}

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
  hasNext: boolean;
  hasPrev: boolean;
  links: {
    self: string;
    next: string | null;
    prev: string | null;
    first: string;
    last: string;
  };
}

export interface CursorMeta {
  limit: number;
  hasNext: boolean;
  nextCursor: string | null;
  links: {
    self: string;
    next: string | null;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse and validate page/limit query params from a request.
 * Falls back to defaults on invalid input.
 */
export function parsePageLimit(req: Request): PageLimitParams {
  const result = pageLimitSchema.safeParse(req.query);
  return result.success ? result.data : { page: 1, limit: 20 };
}

/**
 * Parse and validate cursor query params from a request.
 */
export function parseCursor(req: Request): CursorParams {
  const result = cursorSchema.safeParse(req.query);
  return result.success ? result.data : { limit: 20 };
}

/**
 * Build Prisma skip/take args from page/limit params.
 */
export function toSkipTake(params: PageLimitParams): { skip: number; take: number } {
  return {
    skip: (params.page - 1) * params.limit,
    take: params.limit,
  };
}

/**
 * Build Prisma cursor/take args from cursor params.
 * Fetches limit+1 to detect if there's a next page.
 */
export function toCursorArgs(params: CursorParams): {
  cursor?: { id: string };
  take: number;
  skip?: number;
} {
  return {
    ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    take: params.limit + 1, // fetch one extra to detect next page
  };
}

/**
 * Build the base URL for pagination links (path + non-pagination query params).
 */
function buildBaseUrl(req: Request): string {
  const { page: _p, limit: _l, cursor: _c, ...rest } = req.query as Record<string, string>;
  const base = req.baseUrl + req.path;
  const qs = new URLSearchParams(rest).toString();
  return qs ? `${base}?${qs}&` : `${base}?`;
}

/**
 * Build a paginated response with page/limit metadata and navigation links.
 */
export function buildPageResponse<T>(
  req: Request,
  data: T[],
  total: number,
  params: PageLimitParams,
): PaginatedResponse<T> {
  const pages = Math.ceil(total / params.limit) || 1;
  const hasNext = params.page < pages;
  const hasPrev = params.page > 1;
  const base = buildBaseUrl(req);

  return {
    data,
    pagination: {
      total,
      page: params.page,
      limit: params.limit,
      pages,
      hasNext,
      hasPrev,
      links: {
        self: `${base}page=${params.page}&limit=${params.limit}`,
        next: hasNext ? `${base}page=${params.page + 1}&limit=${params.limit}` : null,
        prev: hasPrev ? `${base}page=${params.page - 1}&limit=${params.limit}` : null,
        first: `${base}page=1&limit=${params.limit}`,
        last: `${base}page=${pages}&limit=${params.limit}`,
      },
    },
  };
}

/**
 * Build a cursor-paginated response.
 * Pass the raw items fetched with toCursorArgs (limit+1 items).
 * The extra item is used to detect hasNext and is stripped from the response.
 */
export function buildCursorResponse<T extends { id: string }>(
  req: Request,
  rawItems: T[],
  params: CursorParams,
): PaginatedResponse<T> {
  const hasNext = rawItems.length > params.limit;
  const data = hasNext ? rawItems.slice(0, params.limit) : rawItems;
  const nextCursor = hasNext ? data[data.length - 1].id : null;
  const base = buildBaseUrl(req);

  return {
    data,
    pagination: {
      limit: params.limit,
      hasNext,
      nextCursor,
      links: {
        self: `${base}limit=${params.limit}${params.cursor ? `&cursor=${params.cursor}` : ''}`,
        next: nextCursor ? `${base}limit=${params.limit}&cursor=${nextCursor}` : null,
      },
    },
  };
}

// ── Timestamp cursor encoding ─────────────────────────────────────────────────

export interface TimestampCursor {
  id: string;
  /** ISO timestamp — falls back to createdAt when updatedAt is null */
  timestamp: string;
}

/**
 * Encode a record into a base64 cursor string.
 * Uses `updatedAt` when available, falls back to `createdAt` to handle
 * records where `updatedAt` is null (fixes #669).
 */
export function encodeCursor(record: { id: string; updatedAt?: Date | null; createdAt: Date }): string {
  const timestamp = (record.updatedAt ?? record.createdAt).toISOString();
  return Buffer.from(JSON.stringify({ id: record.id, timestamp })).toString('base64');
}

/**
 * Thrown by decodeCursorOrThrow when the cursor cannot be parsed.
 */
export class InvalidCursorError extends Error {
  constructor(message = 'Invalid or tampered pagination cursor') {
    super(message);
    this.name = 'InvalidCursorError';
    Object.setPrototypeOf(this, InvalidCursorError.prototype);
  }
}

/**
 * Decode a base64 cursor string back to a TimestampCursor.
 * Returns null if the cursor is malformed.
 */
export function decodeCursor(cursor: string): TimestampCursor | null {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8')) as unknown;
    if (
      typeof decoded === 'object' &&
      decoded !== null &&
      'id' in decoded &&
      'timestamp' in decoded &&
      typeof (decoded as TimestampCursor).id === 'string' &&
      typeof (decoded as TimestampCursor).timestamp === 'string'
    ) {
      return decoded as TimestampCursor;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Decode a base64 cursor string back to a TimestampCursor.
 * Throws InvalidCursorError if the cursor is malformed or tampered.
 */
export function decodeCursorOrThrow(cursor: string): TimestampCursor {
  const result = decodeCursor(cursor);
  if (!result) {
    throw new InvalidCursorError();
  }
  return result;
}

/**
 * Validate that a cursor belongs to the requesting organization.
 * Queries the database to verify the record exists and belongs to activeOrgId.
 * 
 * @param cursor - The encoded cursor string
 * @param activeOrgId - The organization ID of the requesting user
 * @param prisma - Prisma client instance
 * @param tableName - The table to query (e.g., 'posts', 'comments')
 * @returns true if cursor is valid and belongs to the organization, false otherwise
 */
export async function validateCursorOrganization(
  cursor: string | undefined,
  activeOrgId: string,
  prisma: any,
  tableName: string
): Promise<boolean> {
  if (!cursor) {
    return true; // No cursor provided is valid
  }

  const decoded = decodeCursor(cursor);
  if (!decoded) {
    return false; // Malformed cursor
  }

  try {
    // Query the database to verify the record exists and belongs to the organization
    const record = await prisma[tableName].findUnique({
      where: { id: decoded.id },
      select: { organizationId: true },
    });

    if (!record) {
      return false; // Record not found
    }

    // Verify the record belongs to the requesting organization
    return record.organizationId === activeOrgId;
  } catch (error) {
    console.error(`Error validating cursor for ${tableName}:`, error);
    return false;
  }
}
