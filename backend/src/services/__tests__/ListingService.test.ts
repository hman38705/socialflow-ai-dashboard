import { ListingService } from '../ListingService';
import { prisma } from '../../lib/prisma';
import { replicaClient } from '../../lib/readReplica';

// Mock Prisma
jest.mock('../../lib/prisma', () => ({
  prisma: {
    listing: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Mock read replica
jest.mock('../../lib/readReplica', () => ({
  replicaClient: {
    listing: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
  },
}));

describe('ListingService', () => {
  let service: ListingService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ListingService();
  });

  describe('toggleVisibility', () => {
    it('should throw error when listing is not found', async () => {
      (prisma.listing.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.toggleVisibility('listing-123', 'mentor-123', true)).rejects.toThrow(
        'Listing not found',
      );

      expect(prisma.listing.findUnique).toHaveBeenCalledWith({ where: { id: 'listing-123' } });
    });

    it('should throw error when mentor is not authorized', async () => {
      const mockListing = {
        id: 'listing-123',
        mentorId: 'mentor-456',
        isActive: false,
        title: 'Test Listing',
      };

      (prisma.listing.findUnique as jest.Mock).mockResolvedValue(mockListing);

      await expect(
        service.toggleVisibility('listing-123', 'mentor-123', true),
      ).rejects.toThrow('Unauthorized: You can only toggle your own listings');
    });

    it('should successfully activate listing', async () => {
      const mockListing = {
        id: 'listing-123',
        mentorId: 'mentor-123',
        isActive: false,
        title: 'Test Listing',
      };

      const updatedListing = { ...mockListing, isActive: true };

      (prisma.listing.findUnique as jest.Mock).mockResolvedValue(mockListing);
      (prisma.listing.update as jest.Mock).mockResolvedValue(updatedListing);

      const result = await service.toggleVisibility('listing-123', 'mentor-123', true);

      expect(result.isActive).toBe(true);
      expect(prisma.listing.update).toHaveBeenCalledWith({
        where: { id: 'listing-123' },
        data: { isActive: true },
      });
    });

    it('should successfully deactivate listing', async () => {
      const mockListing = {
        id: 'listing-123',
        mentorId: 'mentor-123',
        isActive: true,
        title: 'Test Listing',
      };

      const updatedListing = { ...mockListing, isActive: false };

      (prisma.listing.findUnique as jest.Mock).mockResolvedValue(mockListing);
      (prisma.listing.update as jest.Mock).mockResolvedValue(updatedListing);

      const result = await service.toggleVisibility('listing-123', 'mentor-123', false);

      expect(result.isActive).toBe(false);
      expect(prisma.listing.update).toHaveBeenCalledWith({
        where: { id: 'listing-123' },
        data: { isActive: false },
      });
    });

    it('should include organization scope in update', async () => {
      const mockListing = {
        id: 'listing-123',
        mentorId: 'mentor-123',
        isActive: false,
        title: 'Test Listing',
      };

      const updatedListing = { ...mockListing, isActive: true };

      (prisma.listing.findUnique as jest.Mock).mockResolvedValue(mockListing);
      (prisma.listing.update as jest.Mock).mockResolvedValue(updatedListing);

      await service.toggleVisibility('listing-123', 'mentor-123', true, 'org-123');

      expect(prisma.listing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'listing-123' },
          data: { isActive: true },
          __orgId: 'org-123',
        }),
      );
    });
  });

  describe('searchListings', () => {
    it('should search with default empty query', async () => {
      const mockListings = [
        { id: 'listing-1', title: 'Listing 1', description: 'Description 1', isActive: true },
        { id: 'listing-2', title: 'Listing 2', description: 'Description 2', isActive: true },
      ];

      (replicaClient.listing.count as jest.Mock).mockResolvedValue(2);
      (replicaClient.listing.findMany as jest.Mock).mockResolvedValue(mockListings);

      const result = await service.searchListings('', { page: 1, limit: 10 });

      expect(result.data).toEqual(mockListings);
      expect(result.total).toBe(2);
    });

    it('should search with query string', async () => {
      const mockListings = [{ id: 'listing-1', title: 'Python Tutorial', description: '', isActive: true }];

      (replicaClient.listing.count as jest.Mock).mockResolvedValue(1);
      (replicaClient.listing.findMany as jest.Mock).mockResolvedValue(mockListings);

      const result = await service.searchListings('python', { page: 1, limit: 10 });

      expect(replicaClient.listing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isActive: true,
            OR: [
              { title: { contains: 'python', mode: 'insensitive' } },
              { description: { contains: 'python', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('should only return active listings', async () => {
      (replicaClient.listing.count as jest.Mock).mockResolvedValue(1);
      (replicaClient.listing.findMany as jest.Mock).mockResolvedValue([]);

      await service.searchListings('', { page: 1, limit: 10 });

      expect(replicaClient.listing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isActive: true }),
        }),
      );
    });

    it('should handle pagination with skip and take', async () => {
      (replicaClient.listing.count as jest.Mock).mockResolvedValue(50);
      (replicaClient.listing.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.searchListings('', { page: 2, limit: 10 });

      // Page 2 with limit 10 should skip 10 items
      expect(replicaClient.listing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });

    it('should apply organization scope when provided', async () => {
      (replicaClient.listing.count as jest.Mock).mockResolvedValue(0);
      (replicaClient.listing.findMany as jest.Mock).mockResolvedValue([]);

      await service.searchListings('', { page: 1, limit: 10 }, 'org-123');

      expect(replicaClient.listing.count).toHaveBeenCalledWith(
        expect.objectContaining({
          __orgId: 'org-123',
        }),
      );

      expect(replicaClient.listing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          __orgId: 'org-123',
        }),
      );
    });

    it('should handle case-insensitive search', async () => {
      (replicaClient.listing.count as jest.Mock).mockResolvedValue(1);
      (replicaClient.listing.findMany as jest.Mock).mockResolvedValue([]);

      await service.searchListings('PYTHON', { page: 1, limit: 10 });

      expect(replicaClient.listing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({ title: { contains: 'PYTHON', mode: 'insensitive' } }),
              expect.objectContaining({ description: { contains: 'PYTHON', mode: 'insensitive' } }),
            ]),
          }),
        }),
      );
    });

    it('should trim whitespace from query', async () => {
      (replicaClient.listing.count as jest.Mock).mockResolvedValue(0);
      (replicaClient.listing.findMany as jest.Mock).mockResolvedValue([]);

      await service.searchListings('   python   ', { page: 1, limit: 10 });

      expect(replicaClient.listing.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { title: { contains: 'python', mode: 'insensitive' } },
              { description: { contains: 'python', mode: 'insensitive' } },
            ],
          }),
        }),
      );
    });

    it('should return empty results with total count', async () => {
      (replicaClient.listing.count as jest.Mock).mockResolvedValue(0);
      (replicaClient.listing.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.searchListings('nonexistent', { page: 1, limit: 10 });

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should use read replica for queries', async () => {
      (replicaClient.listing.count as jest.Mock).mockResolvedValue(1);
      (replicaClient.listing.findMany as jest.Mock).mockResolvedValue([
        { id: 'listing-1', title: 'Test', description: '', isActive: true },
      ]);

      await service.searchListings('test', { page: 1, limit: 10 });

      // Verify read replica is used (not primary database)
      expect(replicaClient.listing.count).toHaveBeenCalled();
      expect(replicaClient.listing.findMany).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('should handle multiple search results', async () => {
      const mockListings = Array.from({ length: 25 }, (_, i) => ({
        id: `listing-${i}`,
        title: `Listing ${i}`,
        description: `Description ${i}`,
        isActive: true,
      }));

      (replicaClient.listing.count as jest.Mock).mockResolvedValue(25);
      (replicaClient.listing.findMany as jest.Mock).mockResolvedValue(mockListings.slice(0, 10));

      const result = await service.searchListings('', { page: 1, limit: 10 });

      expect(result.data).toHaveLength(10);
      expect(result.total).toBe(25);
    });

    it('should handle query with special characters', async () => {
      (replicaClient.listing.count as jest.Mock).mockResolvedValue(0);
      (replicaClient.listing.findMany as jest.Mock).mockResolvedValue([]);

      await service.searchListings('c++', { page: 1, limit: 10 });

      expect(replicaClient.listing.findMany).toHaveBeenCalled();
    });
  });
});
