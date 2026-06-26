import { encodeCursor, decodeCursor, validateCursorOrganization } from '../pagination';

describe('pagination cursor validation', () => {
  const mockPrisma = {
    posts: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateCursorOrganization', () => {
    it('should return true when no cursor is provided', async () => {
      const result = await validateCursorOrganization(
        undefined,
        'org-123',
        mockPrisma,
        'posts'
      );
      expect(result).toBe(true);
    });

    it('should return false for malformed cursor', async () => {
      const result = await validateCursorOrganization(
        'invalid-base64!!!',
        'org-123',
        mockPrisma,
        'posts'
      );
      expect(result).toBe(false);
    });

    it('should return false when record not found', async () => {
      mockPrisma.posts.findUnique.mockResolvedValue(null);

      const cursor = encodeCursor({
        id: 'post-123',
        createdAt: new Date(),
      });

      const result = await validateCursorOrganization(
        cursor,
        'org-123',
        mockPrisma,
        'posts'
      );

      expect(result).toBe(false);
      expect(mockPrisma.posts.findUnique).toHaveBeenCalledWith({
        where: { id: 'post-123' },
        select: { organizationId: true },
      });
    });

    it('should return false when cursor belongs to different organization', async () => {
      mockPrisma.posts.findUnique.mockResolvedValue({
        organizationId: 'org-456',
      });

      const cursor = encodeCursor({
        id: 'post-123',
        createdAt: new Date(),
      });

      const result = await validateCursorOrganization(
        cursor,
        'org-123',
        mockPrisma,
        'posts'
      );

      expect(result).toBe(false);
    });

    it('should return true when cursor belongs to requesting organization', async () => {
      mockPrisma.posts.findUnique.mockResolvedValue({
        organizationId: 'org-123',
      });

      const cursor = encodeCursor({
        id: 'post-123',
        createdAt: new Date(),
      });

      const result = await validateCursorOrganization(
        cursor,
        'org-123',
        mockPrisma,
        'posts'
      );

      expect(result).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      mockPrisma.posts.findUnique.mockRejectedValue(
        new Error('Database connection failed')
      );

      const cursor = encodeCursor({
        id: 'post-123',
        createdAt: new Date(),
      });

      const result = await validateCursorOrganization(
        cursor,
        'org-123',
        mockPrisma,
        'posts'
      );

      expect(result).toBe(false);
    });
  });

  describe('cursor encoding/decoding', () => {
    it('should encode and decode cursor correctly', () => {
      const record = {
        id: 'post-123',
        createdAt: new Date('2026-05-28T14:43:03.130Z'),
      };

      const encoded = encodeCursor(record);
      const decoded = decodeCursor(encoded);

      expect(decoded).not.toBeNull();
      expect(decoded?.id).toBe('post-123');
      expect(decoded?.timestamp).toBe('2026-05-28T14:43:03.130Z');
    });

    it('should use updatedAt when available', () => {
      const record = {
        id: 'post-123',
        createdAt: new Date('2026-05-28T10:00:00.000Z'),
        updatedAt: new Date('2026-05-28T14:43:03.130Z'),
      };

      const encoded = encodeCursor(record);
      const decoded = decodeCursor(encoded);

      expect(decoded?.timestamp).toBe('2026-05-28T14:43:03.130Z');
    });

    it('should fall back to createdAt when updatedAt is null', () => {
      const record = {
        id: 'post-123',
        createdAt: new Date('2026-05-28T10:00:00.000Z'),
        updatedAt: null,
      };

      const encoded = encodeCursor(record);
      const decoded = decodeCursor(encoded);

      expect(decoded?.timestamp).toBe('2026-05-28T10:00:00.000Z');
    });
  });
});
