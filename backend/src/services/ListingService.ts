import { prisma } from '../lib/prisma';
import { replicaClient } from '../lib/readReplica';
import { PageLimitParams, toSkipTake } from '../utils/pagination';

export class ListingService {
  async createListing(
    data: { title: string; description: string; price?: number; isActive?: boolean; mentorId: string },
    orgId?: string,
  ) {
    return prisma.listing.create({
      data: { ...data, ...(orgId ? { organizationId: orgId } : {}) },
    } as any);
  }

  async findById(id: string, orgId?: string) {
    const listing = await replicaClient.listing.findUnique({ where: { id } } as any);
    if (!listing) return null;
    if (orgId && (listing as any).organizationId && (listing as any).organizationId !== orgId) {
      return null;
    }
    return listing;
  }

  async deleteListing(id: string, mentorId: string, orgId?: string) {
    const listing = await prisma.listing.findUnique({ where: { id } } as any);
    if (!listing) throw new Error('Listing not found');
    if ((listing as any).mentorId !== mentorId) throw new Error('Unauthorized');
    if (orgId && (listing as any).organizationId && (listing as any).organizationId !== orgId) {
      throw new Error('Listing not found');
    }
    return prisma.listing.delete({ where: { id } } as any);
  }

  async list(params: PageLimitParams, orgId?: string): Promise<{ data: any[]; total: number }> {
    const where = orgId ? { organizationId: orgId } : {};
    const [total, data] = await Promise.all([
      replicaClient.listing.count({ where } as any),
      replicaClient.listing.findMany({ where, ...toSkipTake(params) } as any),
    ]);
    return { data, total };
  }

  /**
   * Toggle the visibility of a listing
   * @param listingId ID of the listing
   * @param mentorId ID of the mentor (for authorization)
   * @param isActive Desired state
   * @param orgId Organization scope
   */
  async toggleVisibility(listingId: string, mentorId: string, isActive: boolean, orgId?: string) {
    // Write operation — use primary
    const listing = await prisma.listing.findUnique({ where: { id: listingId } });

    if (!listing) {
      throw new Error('Listing not found');
    }

    // Ensure only the mentor who owns the listing can toggle it
    if (listing.mentorId !== mentorId) {
      throw new Error('Unauthorized: You can only toggle your own listings');
    }

    return prisma.listing.update({
      where: { id: listingId },
      data: { isActive },
      ...(orgId ? { __orgId: orgId } : {}),
    } as any);
  }

  /**
   * Search listings, excluding hidden ones
   * @param query Search string
   * @param params Page/limit pagination params
   * @param orgId Organization scope
   */
  async searchListings(
    query: string = '',
    params: PageLimitParams,
    orgId?: string,
  ): Promise<{ data: any[]; total: number }> {
    // Read-only operation — use read replica
    const q = query.trim();
    const where = {
      isActive: true,
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' as const } },
              { description: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const baseArgs = { where, ...toSkipTake(params) };
    const orgArgs = orgId ? { ...baseArgs, __orgId: orgId } : baseArgs;

    const [total, data] = await Promise.all([
      replicaClient.listing.count(orgId ? ({ where, __orgId: orgId } as any) : { where }),
      replicaClient.listing.findMany(orgArgs as any),
    ]);

    return { data, total };
  }
}

export const listingService = new ListingService();
