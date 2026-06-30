import { Response } from 'express';
import { Readable } from 'stream';
import { replicaClient } from '../lib/readReplica';
import { paginatedQuery } from '../lib/paginatedQuery';

/** RFC 4180 — wrap in quotes and escape embedded quotes, commas, and newlines. */
function csvField(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

function makeStream(res: Response, headers: Record<string, string>): Readable {
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  // Use chunked transfer encoding — pre-calculated Content-Length is unreliable
  // because actual row sizes vary and can cause HTTP clients to truncate the response.
  res.setHeader('Transfer-Encoding', 'chunked');
  const stream = new Readable({ read() {} });
  stream.pipe(res);
  return stream;
}

async function pump<T extends { id: string }>(
  stream: Readable,
  findMany: Parameters<typeof paginatedQuery<T>>[0],
  serialize: (row: T) => string,
): Promise<void> {
  try {
    for await (const row of paginatedQuery(findMany)) {
      stream.push(serialize(row));
    }
    stream.push(null);
  } catch (err) {
    stream.destroy(err as Error);
  }
}

export const ExportService = {
  streamAnalyticsAsCSV: async (
    organizationId: string,
    startDate: Date,
    endDate: Date,
    res: Response,
  ): Promise<void> => {
    // Read-only operation — use read replica
    const where = { organizationId, recordedAt: { gte: startDate, lte: endDate } };
    const total = await replicaClient.analyticsEntry.count({ where });
    const header = 'id,organizationId,platform,metric,value,recordedAt\n';
    const stream = makeStream(res, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="analytics.csv"',
      'X-Total-Rows': String(total),
    });
    stream.push(header);
    await pump(stream, (args) => replicaClient.analyticsEntry.findMany({ where, ...args }), (row) =>
      `${csvField(row.id)},${csvField(row.organizationId)},${csvField(row.platform)},${csvField(row.metric)},${row.value},${csvField(row.recordedAt.toISOString())}\n`,
    );
  },

  streamAnalyticsAsJSON: async (
    organizationId: string,
    startDate: Date,
    endDate: Date,
    res: Response,
  ): Promise<void> => {
    // Read-only operation — use read replica
    const where = { organizationId, recordedAt: { gte: startDate, lte: endDate } };
    const total = await replicaClient.analyticsEntry.count({ where });
    const stream = makeStream(res, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': 'attachment; filename="analytics.jsonl"',
      'X-Total-Rows': String(total),
    });
    await pump(stream, (args) => replicaClient.analyticsEntry.findMany({ where, ...args }), (row) =>
      JSON.stringify(row) + '\n',
    );
  },

  streamPostsAsCSV: async (
    organizationId: string,
    startDate: Date,
    endDate: Date,
    res: Response,
  ): Promise<void> => {
    // Read-only operation — use read replica
    const where = { organizationId, createdAt: { gte: startDate, lte: endDate } };
    const total = await replicaClient.post.count({ where });
    const header = 'id,organizationId,content,platform,scheduledAt,createdAt\n';
    const stream = makeStream(res, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="posts.csv"',
      'X-Total-Rows': String(total),
    });
    stream.push(header);
    await pump(stream, (args) => replicaClient.post.findMany({ where, ...args }), (row) => {
      return `${csvField(row.id)},${csvField(row.organizationId)},${csvField(row.content)},${csvField(row.platform)},${csvField(row.scheduledAt?.toISOString() || '')},${csvField(row.createdAt.toISOString())}\n`;
    });
  },

  streamPostsAsJSON: async (
    organizationId: string,
    startDate: Date,
    endDate: Date,
    res: Response,
  ): Promise<void> => {
    // Read-only operation — use read replica
    const where = { organizationId, createdAt: { gte: startDate, lte: endDate } };
    const total = await replicaClient.post.count({ where });
    const stream = makeStream(res, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': 'attachment; filename="posts.jsonl"',
      'X-Total-Rows': String(total),
    });
    await pump(stream, (args) => replicaClient.post.findMany({ where, ...args }), (row) =>
      JSON.stringify(row) + '\n',
    );
  },
};
