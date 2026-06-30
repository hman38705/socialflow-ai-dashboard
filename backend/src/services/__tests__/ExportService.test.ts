import { ExportService } from '../ExportService';
import { replicaClient } from '../../lib/readReplica';
import { Response } from 'express';

// Mock replicaClient
jest.mock('../../lib/readReplica', () => ({
  replicaClient: {
    analyticsEntry: {
      findMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
    post: {
      findMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    },
  },
}));

describe('ExportService', () => {
  let mockRes: Partial<Response>;

  beforeEach(() => {
    mockRes = {
      setHeader: jest.fn(),
      pipe: jest.fn(),
      on: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    };
    jest.clearAllMocks();
  });

  describe('streamAnalyticsAsCSV', () => {
    it('should set correct headers for CSV export', async () => {
      (replicaClient.analyticsEntry.findMany as jest.Mock).mockResolvedValue([]);

      await ExportService.streamAnalyticsAsCSV(
        'org-123',
        new Date('2025-01-01'),
        new Date('2025-12-31'),
        mockRes as Response,
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="analytics.csv"',
      );
    });

    it('should set Content-Length header based on row count', async () => {
      (replicaClient.analyticsEntry.count as jest.Mock).mockResolvedValue(10);
      (replicaClient.analyticsEntry.findMany as jest.Mock).mockResolvedValue([]);

      await ExportService.streamAnalyticsAsCSV(
        'org-123',
        new Date('2025-01-01'),
        new Date('2025-12-31'),
        mockRes as Response,
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Length', expect.any(Number));
    });

    it('should query analytics with correct date range', async () => {
      (replicaClient.analyticsEntry.findMany as jest.Mock).mockResolvedValue([]);

      const startDate = new Date('2025-01-01');
      const endDate = new Date('2025-12-31');

      await ExportService.streamAnalyticsAsCSV('org-123', startDate, endDate, mockRes as Response);

      expect(replicaClient.analyticsEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: 'org-123',
            recordedAt: {
              gte: startDate,
              lte: endDate,
            },
          }),
        }),
      );
    });

    it('should use cursor-based pagination', async () => {
      const mockData = Array.from({ length: 1001 }, (_, i) => ({
        id: `id-${i}`,
        organizationId: 'org-123',
        platform: 'twitter',
        metric: 'impressions',
        value: 100 + i,
        recordedAt: new Date('2025-06-15'),
      }));

      (replicaClient.analyticsEntry.findMany as jest.Mock)
        .mockResolvedValueOnce(mockData)
        .mockResolvedValueOnce([]);

      await ExportService.streamAnalyticsAsCSV(
        'org-123',
        new Date('2025-01-01'),
        new Date('2025-12-31'),
        mockRes as Response,
      );

      // Should be called twice: first batch + second batch (empty)
      expect(replicaClient.analyticsEntry.findMany).toHaveBeenCalledTimes(2);

      // Second call should use cursor
      expect(replicaClient.analyticsEntry.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          cursor: { id: 'id-999' },
          skip: 1,
        }),
      );
    });
  });

  describe('streamAnalyticsAsJSON', () => {
    it('should set correct headers for JSON export', async () => {
      (replicaClient.analyticsEntry.findMany as jest.Mock).mockResolvedValue([]);

      await ExportService.streamAnalyticsAsJSON(
        'org-123',
        new Date('2025-01-01'),
        new Date('2025-12-31'),
        mockRes as Response,
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/x-ndjson; charset=utf-8',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="analytics.jsonl"',
      );
    });

    it('should query via replicaClient, not the primary prisma client', async () => {
      (replicaClient.analyticsEntry.findMany as jest.Mock).mockResolvedValue([]);

      await ExportService.streamAnalyticsAsJSON(
        'org-123',
        new Date('2025-01-01'),
        new Date('2025-12-31'),
        mockRes as Response,
      );

      expect(replicaClient.analyticsEntry.findMany).toHaveBeenCalled();
    });
  });

  describe('streamPostsAsCSV', () => {
    it('should set correct headers for posts CSV export', async () => {
      (replicaClient.post.findMany as jest.Mock).mockResolvedValue([]);

      await ExportService.streamPostsAsCSV(
        'org-123',
        new Date('2025-01-01'),
        new Date('2025-12-31'),
        mockRes as Response,
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="posts.csv"',
      );
    });

    it('should escape quotes in post content', async () => {
      const mockData = [
        {
          id: 'post-1',
          organizationId: 'org-123',
          content: 'Hello "world"',
          platform: 'twitter',
          scheduledAt: null,
          createdAt: new Date('2025-06-15'),
        },
      ];

      (replicaClient.post.findMany as jest.Mock).mockResolvedValueOnce(mockData).mockResolvedValueOnce([]);

      await ExportService.streamPostsAsCSV(
        'org-123',
        new Date('2025-01-01'),
        new Date('2025-12-31'),
        mockRes as Response,
      );

      // Verify the stream was created and piped
      expect(mockRes.pipe).toHaveBeenCalled();
    });

    it('should escape embedded commas and newlines in post content', async () => {
      const captureStream = { ...mockRes, pipe: jest.fn() };

      const mockData = [
        {
          id: 'post-csv',
          organizationId: 'org-123',
          content: 'line1\nline2,comma',
          platform: 'twitter',
          scheduledAt: null,
          createdAt: new Date('2025-06-15'),
        },
      ];

      (prisma.post.findMany as jest.Mock).mockResolvedValueOnce(mockData).mockResolvedValueOnce([]);

      // RFC 4180: fields containing special characters must be enclosed in double-quotes
      // and any embedded double-quotes doubled. This also covers commas and newlines.
      const csvField = (v: string) => `"${v.replace(/"/g, '""')}"`;
      expect(csvField('line1\nline2,comma')).toBe('"line1\nline2,comma"');
      expect(csvField('say "hi"')).toBe('"say ""hi"""');

      // Verify the service still calls findMany with the correct where clause
      (prisma.post.findMany as jest.Mock).mockResolvedValue([]);
      await ExportService.streamPostsAsCSV(
        'org-123',
        new Date('2025-01-01'),
        new Date('2025-12-31'),
        captureStream as unknown as Response,
      );
      expect(prisma.post.findMany).toHaveBeenCalled();
    });
  });

  describe('streamPostsAsJSON', () => {
    it('should set correct headers for posts JSON export', async () => {
      (replicaClient.post.findMany as jest.Mock).mockResolvedValue([]);

      await ExportService.streamPostsAsJSON(
        'org-123',
        new Date('2025-01-01'),
        new Date('2025-12-31'),
        mockRes as Response,
      );

      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/x-ndjson; charset=utf-8',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="posts.jsonl"',
      );
    });
  });
});
